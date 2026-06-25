// main.ts
// Main Electron process script for lseditor. Handles app lifecycle, window creation, and main process logic.

/**
 * The main Electron process script is responsible for initializing the application,
 * managing the main window, handling IPC, and integrating with OS-level features.
 */

import { app, BrowserWindow, dialog, ipcMain, MessageBoxOptions, nativeImage, shell, Notification } from 'electron';
import * as path from 'path';
import { AIService } from './services/AIService';
import { UIService } from './services/UIService';
import { AIConfig } from './types/AITypes';
import 'prismjs';
import 'prismjs/themes/prism.css';
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { spawn as spawnProcess, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import * as https from 'https';
import * as http from 'http';

// Main window and service instances
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashShownAt = 0;
const MIN_SPLASH_MS = 4000;
let aiService: AIService;
let uiService: UIService | undefined = undefined;
const allowedWorkspaceRoots = new Set<string>();

interface TerminalSession {
  id: string;
  process: ChildProcessWithoutNullStreams;
  webContents: Electron.WebContents;
}

const terminalSessions = new Map<string, TerminalSession>();
const aiCommandProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const fsWatchers = new Map<string, fs.FSWatcher>();

// A single changelog entry. In DATA the `changelog` field may be:
//   • a string (treated as the notes/body of one entry),
//   • one object like this, or
//   • an array of these objects (one per release).
interface ChangelogEntry {
  version?: string;
  title?: string;
  date?: string;
  highlights?: string[];
  notes?: string;
}

interface RemoteVersionResponse {
  program?: {
    name?: string;
    version?: string;
    description?: string;
    maintainers?: string[];
    repository?: {
      type?: string;
      url?: string;
    };
    license?: {
      type?: string;
      url?: string;
    };
  };
  // Optional "What's new" content shown on the first launch after an update.
  changelog?: string | ChangelogEntry | ChangelogEntry[];
}

const VERSION_ENDPOINT = 'https://raw.githubusercontent.com/Bauvater/lseditor-version/refs/heads/main/DATA';
let cachedRemoteVersion: RemoteVersionResponse | null = null;
let lastVersionFetch = 0;
let aboutWindow: BrowserWindow | null = null;
let whatsNewWindow: BrowserWindow | null = null;
const APP_STATE_FILE = 'app-state.json';
const DEFAULT_BASE_PROMPT_PATH = path.join(process.cwd(), 'config', 'base-prompt.md');
const APP_ICON_FILENAME = 'logo.png';

if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.lseditor.app');
  } catch (error) {
    console.warn('Failed to set AppUserModelID:', error);
  }
}

// --- GPU / HARDWARE-ACCELERATION RESILIENCE ---------------------------------
// Some machines cannot run a GPU-accelerated Chromium window out of the box:
// older integrated GPUs (e.g. Intel UHD Graphics) that Chromium blocklists,
// virtual machines, remote desktops, or systems without a discrete (Nvidia)
// GPU. On those the GPU process can crash on launch and the window stays blank
// or the app never shows. We make startup robust by:
//   1. allowing a software (SwiftShader) fallback so WebGL never hard-fails,
//   2. ignoring Chromium's GPU blocklist so capable-but-unlisted iGPUs work,
//   3. persisting a "disable hardware acceleration" flag the first time the GPU
//      process crashes and relaunching once, so the next start is fully
//      software-rendered and therefore always usable.
const GPU_PREFS_FILE = 'gpu-preferences.json';

function getGpuPrefsPath(): string {
  return path.join(app.getPath('userData'), GPU_PREFS_FILE);
}

function readGpuPrefs(): { disableHardwareAcceleration?: boolean } {
  try {
    return JSON.parse(fs.readFileSync(getGpuPrefsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeGpuPrefs(prefs: { disableHardwareAcceleration?: boolean }): void {
  try {
    fs.mkdirSync(path.dirname(getGpuPrefsPath()), { recursive: true });
    fs.writeFileSync(getGpuPrefsPath(), JSON.stringify(prefs));
  } catch (error) {
    console.warn('Failed to persist GPU preferences:', error);
  }
}

// These switches and the disable call MUST be applied before app "ready".
try {
  // Let WebGL/WebGPU fall back to software rendering instead of failing outright.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  // Use the GPU even when Chromium's blocklist flags the driver (old Intel UHD).
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  const forceDisable = process.env.LSEDITOR_DISABLE_GPU === '1';
  if (forceDisable || readGpuPrefs().disableHardwareAcceleration) {
    app.disableHardwareAcceleration();
  }
} catch (error) {
  console.warn('Failed to apply GPU startup switches:', error);
}

let gpuCrashHandled = false;
// When the GPU process dies abnormally, drop to software rendering and relaunch
// once so the editor is usable on this machine from then on.
app.on('child-process-gone', (_event, details) => {
  if (
    details.type === 'GPU' &&
    details.reason !== 'clean-exit' &&
    details.reason !== 'killed'
  ) {
    console.warn('GPU process gone:', details.reason);
    if (!gpuCrashHandled && !readGpuPrefs().disableHardwareAcceleration) {
      gpuCrashHandled = true;
      writeGpuPrefs({ disableHardwareAcceleration: true });
      try {
        app.relaunch();
        app.exit(0);
      } catch (error) {
        console.warn('Failed to relaunch after GPU crash:', error);
      }
    }
  }
});

// --- SECURITY UTILITIES ---

/**
 * Improved path normalization for Windows and cross-platform consistency.
 */
const normalizeFsPath = (candidate: string) => {
  if (!candidate) return '';
  let resolved = path.resolve(candidate);
  if (process.platform === 'win32') {
    resolved = resolved.replace(/\//g, '\\');
    const drivePattern = /^([a-zA-Z]:\\)\1/;
    if (drivePattern.test(resolved)) resolved = resolved.replace(drivePattern, '$1');
  }
  return path.normalize(resolved);
};

const registerAllowedRoot = (candidate?: string | null) => {
  if (!candidate) return;
  const normalized = normalizeFsPath(candidate);
  if (normalized) {
    allowedWorkspaceRoots.add(normalized);
  }
};

const getStaticAllowedRoots = () => {
  const roots = new Set<string>();
  try { roots.add(normalizeFsPath(process.cwd())); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('home'))); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('desktop'))); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('documents'))); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('downloads'))); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('userData'))); } catch {}
  try { roots.add(normalizeFsPath(app.getPath('temp'))); } catch {}
  try { roots.add(normalizeFsPath(resolveBasePromptPath())); } catch {}
  try { roots.add(normalizeFsPath(resolveAppIconPath())); } catch {}
  return Array.from(roots);
};

const isWithinRoot = (candidate: string, root: string) => {
  const normalizedCandidate = normalizeFsPath(candidate).toLowerCase();
  const normalizedRoot = normalizeFsPath(root).toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`.toLowerCase());
};

const isPathAllowed = (candidate: string) => {
  const normalized = normalizeFsPath(candidate);
  const allowedRoots = [...getStaticAllowedRoots(), ...Array.from(allowedWorkspaceRoots)];
  return allowedRoots.some(root => isWithinRoot(normalized, root));
};

const assertTrustedSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (mainWindow && event.sender !== mainWindow.webContents) {
    throw new Error('Unauthorized IPC sender');
  }
};

/**
 * Checks if a path is safe to access (basic path traversal protection).
 */
const isPathSafe = (untrustedPath: string): boolean => {
  if (!untrustedPath) return false;
  const normalized = normalizeFsPath(untrustedPath);

  if (normalized.includes('\0')) return false;

  const blockedPaths = [
    'C:\\Windows',
    'C:\\System32',
    '/etc/passwd',
    '/etc/shadow'
  ];

  return !blockedPaths.some(p => normalized.toLowerCase().startsWith(p.toLowerCase()));
};

/**
 * Validates and normalizes a path. Throws if unsafe.
 */
const validatePath = (p: any): string => {
  if (typeof p !== 'string' || !p.trim()) throw new Error('Invalid path');
  const normalized = normalizeFsPath(p);
  if (!isPathSafe(normalized)) throw new Error(`Access denied: Path ${p} is outside allowed boundaries`);
  if (!isPathAllowed(normalized)) throw new Error(`Access denied: Path ${p} is not inside an allowed workspace`);
  return normalized;
};

interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
}

function resolveWorkingDirectory(requested?: string): string {
  if (requested && requested.trim().length > 0) {
    try {
      const normalized = validatePath(requested);
      const stats = fs.statSync(normalized);
      if (stats.isDirectory()) {
        return normalized;
      }
    } catch {
      // Ignore invalid paths and fall back to process.cwd()
    }
  }
  return process.cwd();
}

const SHELL_META_CHARS = /[;&|><`$(){}!#*?~]/;

function tokenizeCommand(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];

  const tokens = trimmed.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return tokens.map(token => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function needsShell(command: string): boolean {
  return SHELL_META_CHARS.test(command);
}

function runSafeCommand(
  command: string,
  cwd: string,
  options?: { requestId?: string }
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return new Promise((resolve, reject) => {
    try {
      const trimmed = command.trim();
      if (!trimmed) {
        throw new Error('Empty command');
      }

      let child;
      if (process.platform === 'win32') {
        // Run the WHOLE command line through cmd.exe via shell:true. Node invokes
        // `cmd.exe /d /s /c "<command>"` with verbatim arguments, so the original
        // quoting is preserved. This is the only reliable option on Windows:
        //   • quoted paths with spaces ("C:\...\Test Projekt\f.py") stay intact
        //     instead of being split on the space,
        //   • .cmd/.bat shims (npm, npx, git, tsc, yarn, the "py"/"python" launcher)
        //     resolve via PATHEXT instead of failing with ENOENT,
        //   • pipes, redirects and && chaining work like a real terminal.
        // Manually tokenizing + re-spawning (the old path) corrupted both quoted
        // arguments and cmd's own quote handling, which is what broke commands
        // like `python "C:\...\Test Projekt\gta6.py"`.
        child = spawnProcess(trimmed, {
          cwd,
          windowsHide: true,
          shell: true,
          env: process.env
        });
      } else if (needsShell(trimmed)) {
        // Route through the shell for commands that need pipes, redirects, chaining.
        const shellExe = process.env.SHELL || '/bin/bash';
        child = spawnProcess(shellExe, ['-c', trimmed], {
          cwd,
          shell: false,
          env: process.env
        });
      } else {
        const [file, ...args] = tokenizeCommand(trimmed);
        if (!file) {
          throw new Error('Empty command');
        }
        child = spawnProcess(file, args, {
          cwd,
          shell: false,
          env: process.env
        });
      }
      const requestId = options?.requestId?.trim();
      if (requestId) {
        aiCommandProcesses.set(requestId, child);
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', error => {
        resolve({
          stdout,
          stderr,
          code: 1,
          error: error.message
        });
      });
      child.on('close', code => {
        if (requestId) {
          aiCommandProcesses.delete(requestId);
        }
        resolve({
          stdout,
          stderr,
          code: typeof code === 'number' ? code : 0,
          error: typeof code === 'number' && code !== 0 ? `Command failed with exit code ${code}` : undefined
        });
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function resolveShellExecutable(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function resolveBasePromptPath(): string {
  const candidates: string[] = [];
  const envPath = process.env.LSEDITOR_BASE_PROMPT?.trim();
  if (envPath) {
    candidates.push(envPath);
  }

  candidates.push(DEFAULT_BASE_PROMPT_PATH);

  try {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'config', 'base-prompt.md'));
  } catch {
    // Ignore app path resolution errors, we will fall back to process.cwd()
  }

  try {
    candidates.push(path.join(process.resourcesPath, 'config', 'base-prompt.md'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'config', 'base-prompt.md'));
  } catch {
    // Ignore resources path resolution errors
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore invalid candidates
    }
  }

  return DEFAULT_BASE_PROMPT_PATH;
}

function resolveAppIconPath(): string {
  const distIcon = path.join(__dirname, APP_ICON_FILENAME);
  if (fs.existsSync(distIcon)) {
    return distIcon;
  }
  const projectIcon = path.join(process.cwd(), APP_ICON_FILENAME);
  if (fs.existsSync(projectIcon)) {
    return projectIcon;
  }
  return distIcon;
}

let cachedAppIconImage: Electron.NativeImage | null = null;
let cachedAppIconDataUrl: string | null = null;

function getAppIconImage(): Electron.NativeImage | null {
  if (cachedAppIconImage && !cachedAppIconImage.isEmpty()) {
    return cachedAppIconImage;
  }
  try {
    const iconPath = resolveAppIconPath();
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      cachedAppIconImage = image;
      return cachedAppIconImage;
    }
  } catch (error) {
    console.warn('Failed to load application icon:', error);
  }
  cachedAppIconImage = null;
  return null;
}

function getAppIconDataUrl(): string | null {
  if (cachedAppIconDataUrl !== null) {
    return cachedAppIconDataUrl;
  }
  try {
    const iconPath = resolveAppIconPath();
    const buffer = fs.readFileSync(iconPath);
    const ext = path.extname(iconPath).toLowerCase();
    let mime = 'image/png';
    if (ext === '.ico') mime = 'image/x-icon';
    else if (ext === '.icns') mime = 'image/icns';
    else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
    else if (ext === '.svg') mime = 'image/svg+xml';
    cachedAppIconDataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('Failed to generate icon data URL:', error);
    cachedAppIconDataUrl = null;
  }
  return cachedAppIconDataUrl;
}

function fetchRemoteVersion(): Promise<RemoteVersionResponse | null> {
  const shouldUseCache = cachedRemoteVersion && Date.now() - lastVersionFetch < 30 * 60 * 1000;
  if (shouldUseCache) {
    return Promise.resolve(cachedRemoteVersion);
  }

  return new Promise(resolve => {
    try {
      const request = https.get(VERSION_ENDPOINT, res => {
        if (!res || (res.statusCode && res.statusCode >= 400)) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', chunk => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            cachedRemoteVersion = parsed;
            lastVersionFetch = Date.now();
            resolve(parsed);
          } catch {
            resolve(null);
          }
        });
      });
      request.on('error', () => resolve(null));
      request.setTimeout(5000, () => {
        request.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Compares two dotted version strings semantically.
 * Returns > 0 if a is newer than b, < 0 if older, 0 if equal.
 * Handles differing segment counts ("1.0" vs "1.0.0"), a leading "v",
 * and ignores any pre-release suffix ("1.2.0-beta" → "1.2.0").
 */
function compareVersions(a: string, b: string): number {
  const normalize = (v: string) =>
    String(v ?? '')
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map(part => parseInt(part, 10) || 0);
  const pa = normalize(a);
  const pb = normalize(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/** Best-effort "releases" URL derived from the repository URL in the version feed. */
function deriveReleasesUrl(repoUrl?: string): string {
  const fallback = 'https://github.com/Leifson1337/lseditor/releases/latest';
  if (!repoUrl) return fallback;
  try {
    const parsed = new URL(repoUrl);
    const clean = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').replace(/\.git$/i, '');
    return `${clean}/releases/latest`;
  } catch {
    return fallback;
  }
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releasesUrl: string;
  repositoryUrl?: string;
  error?: string;
}

/**
 * Fetches the latest version from the LS Editor version repo (DATA feed) and
 * compares it to the installed version. Used by both the startup notification
 * and the manual "check for updates" IPC so the logic stays in one place.
 */
async function getUpdateInfo(): Promise<UpdateInfo> {
  const currentVersion = (() => {
    try { return app.getVersion(); } catch { return '0.0.0'; }
  })();
  const remote = await fetchRemoteVersion();
  const latestVersion = remote?.program?.version || currentVersion;
  const repositoryUrl = remote?.program?.repository?.url;
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releasesUrl: deriveReleasesUrl(repositoryUrl),
    repositoryUrl
  };
}

// ── Persisted app state (e.g. last-run version, used to detect updates) ──
function getAppStatePath(): string {
  return path.join(app.getPath('userData'), APP_STATE_FILE);
}

function readAppState(): { lastSeenVersion?: string } {
  try {
    return JSON.parse(fs.readFileSync(getAppStatePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeAppState(patch: { lastSeenVersion?: string }): void {
  try {
    const next = { ...readAppState(), ...patch };
    fs.mkdirSync(path.dirname(getAppStatePath()), { recursive: true });
    fs.writeFileSync(getAppStatePath(), JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to persist app state:', error);
  }
}

// Normalizes the flexible `changelog` field from DATA into a list of entries.
function normalizeChangelog(changelog: RemoteVersionResponse['changelog']): ChangelogEntry[] {
  if (!changelog) return [];
  if (typeof changelog === 'string') {
    const text = changelog.trim();
    return text ? [{ notes: text }] : [];
  }
  if (Array.isArray(changelog)) {
    return changelog.filter(entry => entry && typeof entry === 'object');
  }
  if (typeof changelog === 'object') {
    return [changelog];
  }
  return [];
}

// Picks the changelog entries to show after an update: everything newer than the
// previously-run version (so a user who skipped releases sees them all). If the
// entries carry no version info, the whole changelog is shown.
function selectChangelogForUpdate(
  entries: ChangelogEntry[],
  previousVersion: string | undefined,
  currentVersion: string
): ChangelogEntry[] {
  if (!entries.length) return [];
  const versioned = entries.filter(e => typeof e.version === 'string' && e.version.trim());
  if (!versioned.length || !previousVersion) {
    return entries;
  }
  const relevant = versioned.filter(
    e =>
      compareVersions(e.version as string, previousVersion) > 0 &&
      compareVersions(e.version as string, currentVersion) <= 0
  );
  return relevant.length ? relevant : versioned.filter(e => compareVersions(e.version as string, previousVersion) > 0);
}

const escapeHtml = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function openWhatsNewWindow(entries: ChangelogEntry[], headlineVersion: string): Promise<void> {
  if (whatsNewWindow) {
    whatsNewWindow.focus();
    return;
  }
  if (!entries.length) return;

  const logoDataUrl = getAppIconDataUrl();
  const windowIcon = getAppIconImage();
  const logoMarkup = logoDataUrl
    ? `<div class="brand"><img src="${logoDataUrl}" alt="LS Editor" /></div>`
    : `<div class="brand brand--ph">LS</div>`;

  const entriesMarkup = entries
    .map(entry => {
      const heading = entry.title || (entry.version ? `Version ${entry.version}` : 'What’s new');
      const dateBadge = entry.date ? `<span class="date">${escapeHtml(entry.date)}</span>` : '';
      const versionBadge = entry.version ? `<span class="ver">v${escapeHtml(entry.version)}</span>` : '';
      const highlights = Array.isArray(entry.highlights) && entry.highlights.length
        ? `<ul class="highlights">${entry.highlights.map(h => `<li>${escapeHtml(String(h))}</li>`).join('')}</ul>`
        : '';
      const notes = entry.notes
        ? `<div class="notes">${escapeHtml(entry.notes).replace(/\n/g, '<br/>')}</div>`
        : '';
      return `<section class="entry"><div class="entry-head"><h2>${escapeHtml(heading)}</h2>${versionBadge}${dateBadge}</div>${highlights}${notes}</section>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font-family: 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(circle at top, rgba(59,130,246,0.28), rgba(8,11,20,0.96)), #080b14;
    color: #eef2ff; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; gap: 14px; padding: 22px 26px 14px; }
  .brand { width: 52px; height: 52px; border-radius: 14px; overflow: hidden; flex: 0 0 auto;
    background: linear-gradient(145deg, #4f6fff, #5b9bff); display: flex; align-items: center; justify-content: center; }
  .brand img { width: 78%; height: 78%; object-fit: contain; }
  .brand--ph { font-weight: 700; }
  .head-text h1 { margin: 0; font-size: 20px; }
  .head-text p { margin: 3px 0 0; font-size: 12.5px; color: #aab4d4; }
  .scroll { flex: 1 1 auto; overflow: auto; padding: 8px 26px 16px; }
  .entry { padding: 14px 0; border-top: 1px solid rgba(255,255,255,0.07); }
  .entry:first-child { border-top: none; }
  .entry-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .entry-head h2 { margin: 0; font-size: 15.5px; }
  .ver { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: rgba(96,165,250,0.18); color: #93c5fd; }
  .date { font-size: 11px; color: #8b93b4; }
  ul.highlights { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
  ul.highlights li { position: relative; padding-left: 22px; font-size: 13px; line-height: 1.5; color: #d7ddf5; }
  ul.highlights li::before { content: ''; position: absolute; left: 4px; top: 7px; width: 7px; height: 7px;
    border-radius: 50%; background: linear-gradient(145deg, #34d399, #60a5fa); }
  .notes { margin-top: 10px; font-size: 12.5px; line-height: 1.55; color: #c3cbe8; }
  footer { padding: 12px 26px 18px; display: flex; justify-content: flex-end; }
  button { border: none; border-radius: 9px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
    background: linear-gradient(180deg, #3b82f6, #2563eb); color: #fff; }
  button:hover { filter: brightness(1.08); }
</style></head><body>
  <header>${logoMarkup}<div class="head-text"><h1>What’s new</h1><p>LS Editor ${escapeHtml(headlineVersion)}</p></div></header>
  <div class="scroll">${entriesMarkup}</div>
  <footer><button onclick="window.close()">Los geht’s</button></footer>
</body></html>`;

  whatsNewWindow = new BrowserWindow({
    width: 560,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: 'What’s new – LS Editor',
    icon: windowIcon ?? resolveAppIconPath(),
    modal: Boolean(mainWindow),
    parent: mainWindow ?? undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  whatsNewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  whatsNewWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  whatsNewWindow.on('closed', () => { whatsNewWindow = null; });
}

// On the first launch after an update, show the remote changelog ("What's new").
async function maybeShowWhatsNew(): Promise<void> {
  let currentVersion = '0.0.0';
  try { currentVersion = app.getVersion(); } catch { /* noop */ }

  const state = readAppState();
  const previousVersion = state.lastSeenVersion;

  // Always remember the version we ran so the next update is detected correctly.
  writeAppState({ lastSeenVersion: currentVersion });

  // First ever run (no record) — don't surface a changelog, just record.
  if (!previousVersion) return;
  // Not an upgrade (same or downgrade) — nothing to show.
  if (compareVersions(currentVersion, previousVersion) <= 0) return;

  try {
    const remote = await fetchRemoteVersion();
    const entries = selectChangelogForUpdate(
      normalizeChangelog(remote?.changelog),
      previousVersion,
      currentVersion
    );
    if (entries.length) {
      await openWhatsNewWindow(entries, currentVersion);
    }
  } catch (error) {
    console.warn('Failed to show changelog:', error);
  }
}

async function openAboutWindow(): Promise<void> {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  const remoteVersion = await fetchRemoteVersion();
  const programInfo = remoteVersion?.program ?? {};
  // The installed version must come from the app itself — not the remote feed,
  // otherwise the "current version" shown always equals the latest one.
  const version = (() => { try { return app.getVersion(); } catch { return programInfo.version || '0.0.0'; } })();
  const description = programInfo.description || 'A lightweight editor with integrated terminal.';
  const repoUrl = programInfo.repository?.url || 'https://github.com/Leifson1337/lseditor';
  const licenseUrl = programInfo.license?.url || 'https://github.com/Leifson1337/lseditor/blob/master/LICENSE';
  const repoLabel = (() => {
    try {
      const parsed = new URL(repoUrl);
      const normalized = `${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
      return normalized;
    } catch {
      return repoUrl;
    }
  })();

  const currentYear = new Date().getFullYear();
  const logoDataUrl = getAppIconDataUrl();
  const logoMarkup = logoDataUrl
    ? `<div class="brand-mark"><img src="${logoDataUrl}" alt="LS Editor Logo" /></div>`
    : `<div class="brand-mark brand-mark--placeholder">LS</div>`;
  const windowIcon = getAppIconImage();

  aboutWindow = new BrowserWindow({
    width: 520,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: 'About LS Editor',
    icon: windowIcon ?? resolveAppIconPath(),
    modal: Boolean(mainWindow),
    parent: mainWindow ?? undefined
  });

  const latestVersion = programInfo.version || version;
  const lastCheckedLabel = lastVersionFetch ? new Date(lastVersionFetch).toLocaleString() : 'Nie';
  const updateBadge = compareVersions(latestVersion, version) > 0 ? 'Update verfuegbar' : 'Aktuell';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background: radial-gradient(circle at top, rgba(64,87,214,0.3), rgba(7,8,16,0.95)), #080b14;
        color: #f4f6ff;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 32px;
        overflow: auto;
      }
      .card {
        width: 100%;
        max-width: 520px;
        background: rgba(11, 13, 22, 0.9);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 28px;
      }
      .brand-row {
        display: flex;
        align-items: center;
        gap: 20px;
        flex-wrap: wrap;
      }
      .brand-mark {
        width: 90px;
        height: 90px;
        border-radius: 28px;
        background: linear-gradient(145deg, rgba(79,111,255,0.95), rgba(91,155,255,0.85));
        box-shadow: 0 18px 30px rgba(29,46,128,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      .brand-mark img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        filter: drop-shadow(0 6px 12px rgba(0,0,0,0.4));
      }
      .brand-mark--placeholder {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: 0.08em;
        color: #fefefe;
      }
      h1 {
        font-size: 26px;
        margin: 0;
        color: #f7f8ff;
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }
      .version {
        font-size: 15px;
        color: #8ab4ff;
        font-weight: 500;
      }
      .badge {
        padding: 2px 10px;
        border-radius: 999px;
        background: rgba(138, 180, 255, 0.18);
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .tagline {
        margin: 6px 0 0;
        color: #c5cae9;
        line-height: 1.4;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }
      .meta-card {
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 12px;
        padding: 12px;
      }
      .meta-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #7d82b2;
      }
      .meta-value {
        font-size: 14px;
        color: #f1f3ff;
        margin-top: 4px;
        word-break: break-word;
      }
      .support-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .support-card h2 {
        margin: 0;
        font-size: 16px;
        color: #f7f8ff;
      }
      .support-card p {
        margin: 0;
        color: #c5cae9;
        line-height: 1.4;
      }
      .support-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .support-actions a {
        flex: 1 1 140px;
        text-align: center;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(150,150,255,0.35);
        color: #e1e5ff;
        text-decoration: none;
        font-weight: 500;
      }
      .support-actions a:hover {
        background: rgba(150,150,255,0.12);
      }
      footer {
        margin-top: 4px;
        padding-top: 12px;
        border-top: 1px solid rgba(255,255,255,0.06);
        font-size: 12px;
        color: #9ea3d9;
      }
      footer a {
        color: inherit;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand-row">
        ${logoMarkup}
        <div>
          <h1>LS Editor <span class="version">v${version}</span> <span class="badge">${updateBadge}</span></h1>
          <p class="tagline">${description}</p>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-card">
          <div class="meta-label">Maintainers</div>
          <div class="meta-value">${programInfo.maintainers?.join(' / ') || 'Leifson1337 / Bauvater'}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Repository</div>
          <div class="meta-value"><a href="${repoUrl}" target="_blank" rel="noreferrer">${repoLabel}</a></div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Neueste Version</div>
          <div class="meta-value">${latestVersion || 'unbekannt'}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Zuletzt geprueft</div>
          <div class="meta-value">${lastCheckedLabel}</div>
        </div>
      </div>
      <div class="support-card">
        <div>
          <h2>Help &amp; Support</h2>
          <p>Besuche die Dokumentation oder eroeffne ein Issue, wenn du Unterstuetzung brauchst.</p>
        </div>
        <div class="support-actions">
          <a href="${repoUrl}#readme" target="_blank" rel="noreferrer">Dokumentation</a>
          <a href="${repoUrl}/issues" target="_blank" rel="noreferrer">Issue erstellen</a>
          <a href="${licenseUrl}" target="_blank" rel="noreferrer">Lizenz</a>
        </div>
      </div>
      <footer>&copy; ${currentYear} LS Editor / MIT-Lizenz.</footer>
    </div>
  </body>
</html>`;

  aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  aboutWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (aboutWindow && url !== aboutWindow.webContents.getURL()) {
      shell.openExternal(url);
    }
  });

  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}
function buildShellCommand(shell: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    const lower = shell.toLowerCase();
    if (lower.includes('powershell')) {
      return { command: shell, args: ['-NoLogo'] };
    }
    return { command: shell, args: ['/K'] };
  }
  return { command: shell, args: ['-i'] };
}


function sendTerminalError(target: Electron.WebContents, sessionId: string | null, message: string): void {
  if (!target.isDestroyed()) {
    target.send('terminal:error', { sessionId, message });
  }
}

// --- SYSTEM BUTTONS ---
ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.maximize();
});
ipcMain.handle('window:unmaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.unmaximize();
});
ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// --- FS CHECK PATH EXISTS ---
ipcMain.handle('fs:checkPathExists', async (event, pathToCheck: string) => {
  assertTrustedSender(event);
  try {
    if (typeof pathToCheck !== 'string' || !pathToCheck.trim()) {
      return false;
    }
    const normalized = normalizeFsPath(pathToCheck);
    if (!isPathSafe(normalized)) {
      return false;
    }
    await fs.promises.access(normalized, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('ai:getBasePrompt', async () => {
  const promptPath = resolveBasePromptPath();
  try {
    return await fs.promises.readFile(promptPath, 'utf-8');
  } catch (error) {
    console.warn(`Failed to read base prompt at ${promptPath}:`, error);
    if (promptPath !== DEFAULT_BASE_PROMPT_PATH) {
      try {
        return await fs.promises.readFile(DEFAULT_BASE_PROMPT_PATH, 'utf-8');
      } catch (fallbackError) {
        console.warn('Failed to read default base prompt path:', fallbackError);
      }
    }
    return '';
  }
});

ipcMain.handle('exec', async (event, command: unknown, options?: { cwd?: string; requestId?: string }) => {
  assertTrustedSender(event);

  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Ungueltiger Befehl');
  }

  const cwd = typeof options?.cwd === 'string' && options.cwd.trim().length
    ? validatePath(options.cwd)
    : process.cwd();

  return new Promise((resolve, reject) => {
    try {
      runSafeCommand(command, cwd, { requestId: options?.requestId }).then(resolve).catch(reject);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
});

ipcMain.handle('exec:kill', async (event, requestId: unknown) => {
  assertTrustedSender(event);
  if (typeof requestId !== 'string' || !requestId.trim()) {
    return false;
  }

  const child = aiCommandProcesses.get(requestId);
  if (!child) {
    return false;
  }

  aiCommandProcesses.delete(requestId);
  try {
    child.kill('SIGTERM');
    return true;
  } catch (error) {
    console.warn(`Failed to kill AI command ${requestId}:`, error);
    return false;
  }
});

function createSplashWindow(): void {
  if (splashWindow) {
    return;
  }

  const logoDataUrl = getAppIconDataUrl();
  const logoMarkup = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="LS Editor" />`
    : `<div class="logo-fallback">LS</div>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        font-family: 'Segoe UI', system-ui, sans-serif;
        background: #0b0f18;
        overflow: hidden;
      }
      .splash {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        border-radius: 18px;
        background: radial-gradient(circle at top, rgba(56,189,248,0.35), rgba(245,158,11,0.25)), #0b0f18;
        color: #f8fafc;
        box-shadow: 0 20px 40px rgba(6, 10, 20, 0.45);
      }
      .logo {
        width: 88px;
        height: 88px;
        border-radius: 24px;
        background: rgba(15, 23, 42, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 18px 30px rgba(0, 0, 0, 0.35);
        overflow: hidden;
      }
      .logo img {
        width: 70%;
        height: 70%;
        object-fit: contain;
      }
      .logo-fallback {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 0.1em;
      }
      .title {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .subtitle {
        font-size: 12px;
        color: rgba(226, 232, 240, 0.7);
        letter-spacing: 0.15em;
        text-transform: uppercase;
      }
      .loader {
        width: 120px;
        height: 4px;
        background: rgba(148, 163, 184, 0.25);
        border-radius: 999px;
        overflow: hidden;
        position: relative;
      }
      .loader::after {
        content: '';
        position: absolute;
        top: 0;
        left: -40%;
        width: 40%;
        height: 100%;
        background: linear-gradient(90deg, rgba(245,158,11,0), rgba(245,158,11,0.9), rgba(56,189,248,0.8));
        animation: slide 1.4s infinite ease-in-out;
      }
      @keyframes slide {
        0% { left: -40%; }
        100% { left: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="splash">
      <div class="logo">${logoMarkup}</div>
      <div class="title">LS Editor</div>
      <div class="subtitle">Loading workspace</div>
      <div class="loader"></div>
    </div>
  </body>
</html>`;

  splashWindow = new BrowserWindow({
    width: 560,
    height: 380,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#0b0f18',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splashWindow.once('ready-to-show', () => {
    splashShownAt = Date.now();
    splashWindow?.show();
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/**
 * Creates the main application window with custom settings and loads the index.html file.
 */
async function createWindow() {
  // Create a new browser window with custom settings
  const windowIcon = getAppIconImage();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Custom Titlebar
    icon: windowIcon ?? resolveAppIconPath(),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    }
  });

  // SECURITY: Prevent navigation to outside URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // SECURITY: Redirect window.open to external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (splashWindow) {
    mainWindow.setSkipTaskbar(true);
  }

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      const elapsed = splashShownAt ? Date.now() - splashShownAt : MIN_SPLASH_MS;
      const delay = Math.max(0, MIN_SPLASH_MS - elapsed);
      setTimeout(() => {
        if (splashWindow) {
          splashWindow.close();
          splashWindow = null;
        }
        mainWindow?.setSkipTaskbar(false);
        mainWindow?.maximize();
        mainWindow?.show();
      }, delay);
      return;
    }
    mainWindow?.maximize();
    mainWindow?.show();
  });

  // Maximize the window (Moved to ready-to-show)

  // Listen for window maximize event and notify renderer
  mainWindow.on('maximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:maximized');
  });

  // Listen for window unmaximize event and notify renderer
  mainWindow.on('unmaximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:unmaximized');
  });

  // Load the index.html file into the window
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

/**
 * Initializes the main application services, including AIService and UIService.
 */
async function initializeServices() {
  try {
    // Initialize AIService with config
    const aiConfig: AIConfig = {
      useLocalModel: false,
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048,
      contextWindow: 4096,
      // Stop sequences must always be an array!
      stopSequences: ['\n\n', '```'],
      topP: 1,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2048
      }
    };

    aiService = AIService.getInstance(aiConfig);
    uiService = new UIService();
    await aiService.initialize();
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Sets up IPC handlers for AI code features, including code completion, explanation, and refactoring.
 */
function setupIpcHandlers() {
  // IPC handler for getting code completion
  ipcMain.handle('get-code-completion', async (event, filePath: string, position: any) => {
    assertTrustedSender(event);
    validatePath(filePath);
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.getCodeCompletion(filePath, position);
  });

  // IPC handler for explaining code
  ipcMain.handle('explain-code', async (event, filePath: string, selection: any) => {
    assertTrustedSender(event);
    validatePath(filePath);
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.explainCode(filePath, selection);
  });

  // IPC handler for refactoring code
  ipcMain.handle('refactor-code', async (event, filePath: string, selection: any, refactorType: string) => {
    assertTrustedSender(event);
    validatePath(filePath);
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.refactorCode(filePath, selection, refactorType);
  });
}

/**
 * Sets up IPC handlers for file system operations, including reading directories, files, and writing files.
 */
function setupFsIpcHandlers() {
  // File system: read directory
  ipcMain.handle('fs:readDir', async (event, dirPath) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(dirPath);
      const entries = await fs.promises.readdir(normalized, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory()
      }));
    } catch (err) {
      return [];
    }
  });

  // File system: read file
  ipcMain.handle('fs:readFile', async (event, filePath) => {
    assertTrustedSender(event);
    try {
      const normalizedPath = validatePath(filePath);
      return await fs.promises.readFile(normalizedPath, 'utf-8');
    } catch (error) {
      console.error('Failed to read file:', error);
      throw error;
    }
  });

  // File system: read file as base64 (for images)
  ipcMain.handle('fs:readFileBase64', async (event, filePath) => {
    assertTrustedSender(event);
    try {
      const normalizedPath = validatePath(filePath);
      const buffer = await fs.promises.readFile(normalizedPath);
      return buffer.toString('base64');
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.error('Failed to read file base64:', error);
      }
      return null;
    }
  });

  ipcMain.handle('fs:readFileBinary', async (event, filePath) => {
    assertTrustedSender(event);
    try {
      const normalizedPath = validatePath(filePath);
      const buffer = await fs.promises.readFile(normalizedPath);
      return buffer.toString('base64');
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.error('Failed to read binary file:', error);
      }
      return null;
    }
  });

  ipcMain.handle('fs:writeFileBinary', async (event, filePath, base64Content) => {
    assertTrustedSender(event);
    try {
      const targetPath = validatePath(filePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const buffer = Buffer.from(String(base64Content ?? ''), 'base64');
      await fs.promises.writeFile(targetPath, buffer);
      return true;
    } catch (error) {
      console.error('Error writing binary file:', error);
      return false;
    }
  });

  ipcMain.handle('fs:stat', async (event, filePath) => {
    assertTrustedSender(event);
    try {
      const normalizedPath = validatePath(filePath);
      const stats = await fs.promises.stat(normalizedPath);
      return {
        ctime: stats.ctimeMs,
        mtime: stats.mtimeMs,
        size: stats.size,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'unknown'
      };
    } catch (error) {
      return null;
    }
  });

  // File system: write file
  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    assertTrustedSender(event);
    try {
      const targetPath = validatePath(filePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const data = typeof content === 'string' ? content : String(content ?? '');
      await fs.promises.writeFile(targetPath, data, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error writing file:', error);
      return false;
    }
  });

  ipcMain.handle('fs:appendFile', async (event, filePath, content) => {
    assertTrustedSender(event);
    try {
      const targetPath = validatePath(filePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const data = typeof content === 'string' ? content : String(content ?? '');
      await fs.promises.appendFile(targetPath, data, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error appending file:', error);
      return false;
    }
  });

  // File system: check if path exists
  ipcMain.handle('fs:exists', async (event, pathToCheck) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(pathToCheck);
      await fs.promises.access(normalized);
      return true;
    } catch (error) {
      return false;
    }
  });

  // File system: check if path exists and is directory
  ipcMain.handle('fs:checkPathExistsAndIsDirectory', async (event, path) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(path);
      const stats = await fs.promises.stat(normalized);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  });

  // File system: create directory recursively
  ipcMain.handle('fs:createDirectory', async (event, dirPath) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(dirPath);
      await fs.promises.mkdir(normalized, { recursive: true });
      return true;
    } catch (error) {
      console.error('Error creating directory:', error);
      return false;
    }
  });

  // File system: delete file
  ipcMain.handle('fs:deleteFile', async (event, filePath) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(filePath);
      await fs.promises.unlink(normalized);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  });

  // File system: delete directory recursively
  ipcMain.handle('fs:deleteDirectory', async (event, dirPath) => {
    assertTrustedSender(event);
    try {
      const normalized = validatePath(dirPath);
      await fs.promises.rm(normalized, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Error deleting directory:', error);
      return false;
    }
  });

  // File system: rename file or directory
  ipcMain.handle('fs:renameFile', async (event, oldPath, newPath) => {
    assertTrustedSender(event);
    try {
      const sourcePath = validatePath(String(oldPath ?? ''));
      let targetPath = typeof newPath === 'string' && newPath.trim().length ? newPath.trim() : '';
      if (!targetPath) {
        throw new Error('Neuer Dateiname fehlt.');
      }
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join(path.dirname(sourcePath), targetPath);
      }
      targetPath = validatePath(targetPath);
      await fs.promises.rename(sourcePath, targetPath);
      return true;
    } catch (error) {
      console.error('Error renaming file:', error);
      return false;
    }
  });

  // Extension system: search marketplace
  ipcMain.handle('extension:search', async (event, query, offset = 0) => {
    return new Promise((resolve) => {
      const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=50&offset=${offset}`;
      console.log(`[ExtensionSearch] Searching Marketplace: ${url}`);
      const options = {
        headers: {
          'User-Agent': 'LSEditor/1.0.0'
        }
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) {
          console.error(`Open VSX search failed with status: ${res.statusCode}`);
          resolve({ extensions: [] });
          return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            console.error('Failed to parse Open VSX response:', e);
            resolve({ extensions: [] });
          }
        });
      }).on('error', (err) => {
        console.error('Open VSX search error:', err);
        resolve({ extensions: [] });
      });
    });
  });

  // Extension system: install extension from URL
  ipcMain.handle('extension:install', async (event, { url, fileName, targetDir }) => {
    try {
      assertTrustedSender(event);
      const parsedUrl = new URL(String(url));
      if (parsedUrl.protocol !== 'https:' || !/(^|\.)open-vsx\.org$/i.test(parsedUrl.hostname)) {
        throw new Error('Only HTTPS downloads from open-vsx.org are allowed.');
      }

      const safeFileName = path.basename(String(fileName || 'extension.vsix'));
      const tempPath = path.join(app.getPath('temp'), safeFileName);
      const targetPath = validatePath(targetDir);

      // Ensure target directory exists
      await fs.promises.mkdir(targetPath, { recursive: true });

      // Download the file
      const file = fs.createWriteStream(tempPath);
      await new Promise<void>((resolve, reject) => {
        https.get(parsedUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            // Handle redirect
            const redirectTarget = new URL(String(response.headers.location || ''), parsedUrl);
            if (redirectTarget.protocol !== 'https:' || !/(^|\.)open-vsx\.org$/i.test(redirectTarget.hostname)) {
              fs.unlink(tempPath, () => reject(new Error('Unsafe redirect target')));
              return;
            }
            https.get(redirectTarget, (res2) => {
              res2.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            }).on('error', (err) => {
              fs.unlink(tempPath, () => reject(err));
            });
          } else {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }
        }).on('error', (err) => {
          fs.unlink(tempPath, () => reject(err));
        });
      });

      // Extract the .vsix (which is a zip)
      const zip = new AdmZip(tempPath);
      // Open VSX/VS Code extensions usually have everything in a 'extension' folder inside the zip
      // We want to extract the contents of that folder.
      const zipEntries = zip.getEntries();
      for (const entry of zipEntries) {
        if (entry.entryName.startsWith('extension/')) {
          const targetEntryPath = entry.entryName.replace('extension/', '');
          if (targetEntryPath) {
            // Explicitly reject path traversal components before any path operations
            const normalizedEntry = targetEntryPath.replace(/\\/g, '/');
            if (
              normalizedEntry.split('/').some(part => part === '..') ||
              normalizedEntry.includes('\0')
            ) {
              throw new Error(`Unsafe extension entry path: ${entry.entryName}`);
            }
            const fullTargetPath = normalizeFsPath(path.join(targetPath, targetEntryPath));
            if (!isWithinRoot(fullTargetPath, targetPath)) {
              throw new Error(`Unsafe extension entry path: ${entry.entryName}`);
            }
            if (entry.isDirectory) {
              await fs.promises.mkdir(fullTargetPath, { recursive: true });
            } else {
              await fs.promises.mkdir(path.dirname(fullTargetPath), { recursive: true });
              await fs.promises.writeFile(fullTargetPath, entry.getData());
            }
          }
        }
      }

      // Clean up temp file
      await fs.promises.unlink(tempPath);

      return { success: true };
    } catch (error) {
      console.error('Failed to install extension:', error);
      return { success: false, error: String(error) };
    }
  });

  // Extension system: list installed extensions
  ipcMain.handle('extension:list', async () => {
    try {
      const extensionsDir = path.join(app.getPath('userData'), 'extensions');
      if (!fs.existsSync(extensionsDir)) {
        return [];
      }
      const entries = await fs.promises.readdir(extensionsDir, { withFileTypes: true });
      const extensions: any[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const extPath = path.join(extensionsDir, entry.name);
        const packageJsonPath = path.join(extPath, 'package.json');
        try {
          if (fs.existsSync(packageJsonPath)) {
            const content = await fs.promises.readFile(packageJsonPath, 'utf-8');
            const manifest = JSON.parse(content);
            extensions.push({
              id: entry.name,
              name: manifest.name || entry.name,
              displayName: manifest.displayName || manifest.name || entry.name,
              description: manifest.description || '',
              version: manifest.version || '0.0.0',
              publisher: manifest.publisher || 'local',
              path: extPath,
              contributes: manifest.contributes || {}
            });
          }
        } catch (e) {
          console.warn(`Failed to read extension manifest: ${entry.name}`, e);
        }
      }
      return extensions;
    } catch (error) {
      console.error('Failed to list extensions:', error);
      return [];
    }
  });

  // Extension system: uninstall extension
  ipcMain.handle('extension:uninstall', async (_event, extensionId: string) => {
    try {
      const extensionsDir = path.join(app.getPath('userData'), 'extensions');
      const extPath = path.join(extensionsDir, extensionId);
      const normalized = normalizeFsPath(extPath);

      if (!normalized.startsWith(normalizeFsPath(extensionsDir))) {
        return { success: false, error: 'Invalid extension path' };
      }

      if (!fs.existsSync(normalized)) {
        return { success: false, error: 'Extension not found' };
      }

      await fs.promises.rm(normalized, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      console.error('Failed to uninstall extension:', error);
      return { success: false, error: String(error) };
    }
  });
}

// --- Fehlende IPC-Handler für Renderer-Kommunikation ---
ipcMain.handle('getDirectoryEntries', async (event, dirPath) => {
  assertTrustedSender(event);
  try {
    const normalized = validatePath(dirPath);
    const entries = await fs.promises.readdir(normalized, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
      path: path.join(normalized, entry.name)
    }));
  } catch (error) {
    console.warn(`Failed to get directory entries for ${dirPath}:`, error);
    return [];
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Ollama local-model management (download & run models directly in-app).
// Talks to the local Ollama daemon (default http://127.0.0.1:11434) over HTTP so
// no CORS handling is needed in the renderer. Pull progress is streamed back to
// the renderer via the 'ollama:pullProgress' event channel.
// ─────────────────────────────────────────────────────────────────────────────
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const activeOllamaPulls = new Map<string, http.ClientRequest>();
// Once we learn the default registry (registry.ollama.ai) is blocked on this
// machine, route bare pulls straight to ollama.com to avoid a ~15s dead attempt.
let ollamaDefaultRegistryBlocked = false;

const ollamaRequest = (
  method: string,
  apiPath: string,
  body?: unknown,
  timeoutMs = 8000
): Promise<{ status: number; data: string }> => {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(apiPath, OLLAMA_HOST);
    } catch (error) {
      reject(error);
      return;
    }
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 11434,
        path: target.pathname + target.search,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : undefined
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Ollama request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
};

// Is the Ollama daemon reachable?
ipcMain.handle('ollama:status', async event => {
  assertTrustedSender(event);
  try {
    const res = await ollamaRequest('GET', '/api/version', undefined, 2500);
    if (res.status === 200) {
      let version = '';
      try { version = JSON.parse(res.data).version || ''; } catch {}
      return { running: true, version, host: OLLAMA_HOST };
    }
    return { running: false, host: OLLAMA_HOST };
  } catch {
    return { running: false, host: OLLAMA_HOST };
  }
});

// Is Ollama Cloud usable from here? Cloud models run on Ollama's servers and
// are proxied by the local daemon when the user is signed in. We report:
//   running   — the local daemon is up (required to proxy cloud models),
//   reachable — ollama.com is reachable (cloud needs internet),
//   available — both of the above (the "if available" gate for the UI).
// Whether the user is actually signed in can only be confirmed by trying to
// pull/run a cloud model, so an auth error there drives the sign-in hint.
ipcMain.handle('ollama:cloudStatus', async event => {
  assertTrustedSender(event);
  let running = false;
  try {
    const res = await ollamaRequest('GET', '/api/version', undefined, 2500);
    running = res.status === 200;
  } catch {
    running = false;
  }

  const reachable = await new Promise<boolean>(resolve => {
    try {
      const req = https.get('https://ollama.com/', { timeout: 4000 }, res => {
        res.resume();
        resolve((res.statusCode || 0) < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });

  return { running, reachable, available: running && reachable };
});

// List locally installed models.
ipcMain.handle('ollama:list', async event => {
  assertTrustedSender(event);
  try {
    const res = await ollamaRequest('GET', '/api/tags', undefined, 5000);
    if (res.status !== 200) return { models: [] };
    const parsed = JSON.parse(res.data || '{}');
    const models = Array.isArray(parsed.models)
      ? parsed.models.map((m: any) => ({
          name: m.name,
          size: m.size,
          parameterSize: m.details?.parameter_size,
          quantization: m.details?.quantization_level,
          family: m.details?.family,
          modified: m.modified_at
        }))
      : [];
    return { models };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
});

// Delete an installed model.
ipcMain.handle('ollama:remove', async (event, modelName: unknown) => {
  assertTrustedSender(event);
  const name = typeof modelName === 'string' ? modelName.trim() : '';
  if (!name) return { ok: false, error: 'Missing model name' };
  try {
    const res = await ollamaRequest('DELETE', '/api/delete', { name }, 10000);
    return { ok: res.status === 200, status: res.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Cancel an in-flight pull.
ipcMain.handle('ollama:cancelPull', async (event, modelName: unknown) => {
  assertTrustedSender(event);
  const name = typeof modelName === 'string' ? modelName.trim() : '';
  const req = activeOllamaPulls.get(name);
  if (req) {
    req.destroy(new Error('cancelled'));
    activeOllamaPulls.delete(name);
    return { ok: true };
  }
  return { ok: false };
});

// A registry/network failure looks like a manifest or connection problem rather
// than e.g. an unknown-model error. When the default registry (registry.ollama.ai)
// is blocked we transparently retry via the canonical ollama.com registry.
const isOllamaNetworkError = (msg?: string | null) =>
  !!msg && /manifest|connection|timed out|wsarecv|dial|refused|lookup|reset|EOF|registry|i\/o timeout|no route/i.test(msg);

interface PullResult { ok: boolean; error?: string; networkError?: boolean }

// Runs one /api/pull stream. Progress is emitted under `displayName` so the UI
// keeps tracking the card by the name the user clicked, even on a fallback pull.
const streamOllamaPull = (
  pullName: string,
  displayName: string,
  sender: Electron.WebContents
): Promise<PullResult> => {
  return new Promise(resolve => {
    let target: URL;
    try {
      target = new URL('/api/pull', OLLAMA_HOST);
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const payload = Buffer.from(JSON.stringify({ name: pullName, stream: true }));
    const emit = (data: Record<string, unknown>) => {
      if (!sender.isDestroyed()) sender.send('ollama:pullProgress', { model: displayName, ...data });
    };
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 11434,
        path: target.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
      },
      res => {
        let buffer = '';
        let sawError: string | null = null;
        res.on('data', chunk => {
          buffer += chunk.toString('utf-8');
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              // Ollama streams a single {"error": "..."} line on failure then closes.
              if (obj && typeof obj.error === 'string') {
                sawError = obj.error;
                if (!isOllamaNetworkError(obj.error)) {
                  emit({ status: 'error', error: obj.error, done: true });
                }
              } else {
                emit(obj);
              }
            } catch {
              /* ignore malformed line */
            }
          }
        });
        res.on('end', () => {
          activeOllamaPulls.delete(displayName);
          if (sawError) {
            resolve({ ok: false, error: sawError, networkError: isOllamaNetworkError(sawError) });
          } else {
            emit({ status: 'success', done: true });
            resolve({ ok: res.statusCode === 200 });
          }
        });
      }
    );
    req.on('error', error => {
      activeOllamaPulls.delete(displayName);
      resolve({ ok: false, error: error.message, networkError: isOllamaNetworkError(error.message) });
    });
    activeOllamaPulls.set(displayName, req);
    req.write(payload);
    req.end();
  });
};

// Copies a registry-prefixed model to a clean short name (e.g.
// ollama.com/library/qwen2.5-coder:1.5b → qwen2.5-coder:1.5b) and removes the
// prefixed copy. Ollama's OpenAI-compatible /v1 endpoint only serves clean names.
const normalizeOllamaModelName = async (
  source: string,
  destination: string,
  sender: Electron.WebContents
): Promise<void> => {
  try {
    const copyRes = await ollamaRequest('POST', '/api/copy', { source, destination }, 30000);
    if (copyRes.status === 200) {
      await ollamaRequest('DELETE', '/api/delete', { name: source }, 15000);
      // Nudge the renderer to reload the installed list with the clean name.
      if (!sender.isDestroyed()) {
        sender.send('ollama:pullProgress', { model: destination, status: 'success', done: true });
      }
    }
  } catch {
    /* best effort — if copy/delete fails the prefixed model still exists */
  }
};

// Pull (download) a model, streaming NDJSON progress back to the renderer.
// Falls back to the ollama.com registry if the default registry is unreachable.
ipcMain.handle('ollama:pull', async (event, modelName: unknown) => {
  assertTrustedSender(event);
  const name = typeof modelName === 'string' ? modelName.trim() : '';
  if (!name) return { ok: false, error: 'Missing model name' };
  const sender = event.sender;
  const emitErr = (error: string) => {
    if (!sender.isDestroyed()) sender.send('ollama:pullProgress', { model: name, status: 'error', error, done: true });
  };

  // Does the name already carry an explicit registry host? (contains a "/" in the
  // first segment with a dot, e.g. ollama.com/library/foo). If not, it's a bare
  // library name that we can re-route to the ollama.com registry on failure.
  const hasExplicitHost = /^[^/]+\.[^/]+\//.test(name);
  // Cloud models (e.g. "gpt-oss:120b-cloud") are not served from the public
  // "/library" registry, so the ollama.com library fallback must not apply.
  const isCloud = /-cloud$/i.test(name);
  const fallbackName = `ollama.com/library/${name.replace(/^library\//, '')}`;
  const canFallback = !hasExplicitHost && !isCloud;

  // If we already know the default registry is blocked, skip straight to ollama.com.
  if (canFallback && ollamaDefaultRegistryBlocked) {
    const direct = await streamOllamaPull(fallbackName, name, sender);
    if (!direct.ok && direct.error) emitErr(direct.error);
    return direct;
  }

  const first = await streamOllamaPull(name, name, sender);
  if (first.ok) return first;

  // Only retry when the failure looks like a blocked/unreachable registry and we
  // can safely re-route a bare library name through ollama.com.
  if (first.networkError && canFallback) {
    ollamaDefaultRegistryBlocked = true;
    if (!sender.isDestroyed()) {
      sender.send('ollama:pullProgress', { model: name, status: 'default registry blocked — retrying via ollama.com…' });
    }
    const second = await streamOllamaPull(fallbackName, name, sender);
    if (second.ok) {
      // The model installs under the prefixed name (ollama.com/library/...),
      // which Ollama's OpenAI /v1 endpoint cannot serve. Copy it to the clean
      // short name and drop the prefixed copy so chat + catalog matching work.
      await normalizeOllamaModelName(fallbackName, name, sender);
    } else if (second.error) {
      emitErr(second.error);
    }
    return second;
  }

  if (first.error) emitErr(first.error);
  return first;
});

ipcMain.handle('window:isMaximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.handle('app:getVersion', () => {
  try {
    return app.getVersion();
  } catch (error) {
    console.error('Failed to retrieve app version:', error);
    return '0.0.0';
  }
});

ipcMain.handle('app:getUserDataPath', () => {
  return app.getPath('userData');
});

// Manually open the "What's new" changelog window (e.g. from a menu/About link).
ipcMain.handle('app:showWhatsNew', async event => {
  assertTrustedSender(event);
  try {
    let currentVersion = '0.0.0';
    try { currentVersion = app.getVersion(); } catch { /* noop */ }
    const remote = await fetchRemoteVersion();
    const entries = normalizeChangelog(remote?.changelog);
    if (!entries.length) return false;
    await openWhatsNewWindow(entries, remote?.program?.version || currentVersion);
    return true;
  } catch (error) {
    console.warn('Failed to open What\'s new window:', error);
    return false;
  }
});

// Manual "check for updates" — queries the version feed and returns the result
// so the renderer can show an up-to-date / update-available state on demand.
ipcMain.handle('app:checkForUpdates', async event => {
  assertTrustedSender(event);
  try {
    return await getUpdateInfo();
  } catch (error) {
    const currentVersion = (() => { try { return app.getVersion(); } catch { return '0.0.0'; } })();
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releasesUrl: deriveReleasesUrl(),
      error: error instanceof Error ? error.message : String(error)
    } as UpdateInfo;
  }
});

ipcMain.handle('workspace:setRoot', (event, workspacePath: unknown) => {
  assertTrustedSender(event);
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    return false;
  }
  registerAllowedRoot(workspacePath);
  return true;
});

ipcMain.handle('app:getPath', (event, name) => {
  assertTrustedSender(event);
  return app.getPath(name as any);
});

ipcMain.handle('app:openAbout', async () => {
  try {
    await openAboutWindow();
    return true;
  } catch (error) {
    console.error('Failed to open about window:', error);
    return false;
  }
});

ipcMain.handle('dialog:openDirectory', async (event) => {
  assertTrustedSender(event);
  const win = mainWindow;
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openDirectory']
  };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths.length) return null;
  registerAllowedRoot(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('dialog:inputBox', async (event, options) => {
  const win = mainWindow;
  const msgBoxOptions: MessageBoxOptions = {
    type: 'question',
    title: options?.title || 'Input',
    message: options?.label || 'Please enter a value:',
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  };
  const result = win
    ? await dialog.showMessageBox(win, msgBoxOptions)
    : await dialog.showMessageBox(msgBoxOptions);
  return result.response === 0 ? (options?.value || '') : null;
});

// Generic message box (used e.g. for the "directory exists / overwrite?" prompt).
// Returns { response } so the renderer can branch on the clicked button index.
ipcMain.handle('dialog:showMessageBox', async (event, options) => {
  assertTrustedSender(event);
  const win = mainWindow;
  const msgBoxOptions: MessageBoxOptions = {
    type: options?.type || 'info',
    title: options?.title || '',
    message: options?.message || '',
    detail: options?.detail,
    buttons: Array.isArray(options?.buttons) && options.buttons.length ? options.buttons : ['OK'],
    defaultId: typeof options?.defaultId === 'number' ? options.defaultId : 0,
    cancelId: typeof options?.cancelId === 'number' ? options.cancelId : undefined
  };
  const result = win
    ? await dialog.showMessageBox(win, msgBoxOptions)
    : await dialog.showMessageBox(msgBoxOptions);
  return { response: result.response, checkboxChecked: result.checkboxChecked };
});

ipcMain.handle('shell:openPath', async (_event, targetPath: unknown) => {
  assertTrustedSender(_event);
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return false;
  }

  try {
    const normalized = validatePath(targetPath);
    await fs.promises.access(normalized, fs.constants.F_OK);
    const result = await shell.openPath(normalized);
    if (result) {
      console.warn('shell.openPath returned non-empty response:', result);
    }
    return true;
  } catch (error) {
    console.error('Failed to open path in shell:', error);
    return false;
  }
});

// Open an http/https URL in the user's default browser (safe external links only).
ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
  assertTrustedSender(_event);
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    console.warn('Blocked non-http(s) external open:', trimmed);
    return false;
  }
  try {
    await shell.openExternal(trimmed);
    return true;
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return false;
  }
});

ipcMain.handle('app:newWindow', async () => {
  await createWindow();
});

ipcMain.handle('app:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    registerAllowedRoot(path.dirname(result.filePaths[0]));
    mainWindow!.webContents.send('file:open', result.filePaths[0]);
  }
});

ipcMain.handle('app:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    registerAllowedRoot(result.filePaths[0]);
    mainWindow!.webContents.send('folder:open', result.filePaths[0]);
  }
});

ipcMain.handle('app:exit', () => {
  app.quit();
});

ipcMain.handle('edit:undo', () => {
  mainWindow!.webContents.undo();
});

ipcMain.handle('edit:redo', () => {
  mainWindow!.webContents.redo();
});

ipcMain.handle('edit:cut', () => {
  mainWindow!.webContents.cut();
});

ipcMain.handle('edit:copy', () => {
  mainWindow!.webContents.copy();
});

ipcMain.handle('edit:paste', () => {
  mainWindow!.webContents.paste();
});

ipcMain.handle('edit:find', () => {
  mainWindow!.webContents.send('edit:find');
});

ipcMain.handle('edit:replace', () => {
  mainWindow!.webContents.send('edit:replace');
});

ipcMain.handle('view:toggleFullScreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('view:reload', () => {
  if (mainWindow) {
    mainWindow.webContents.reload();
  }
});

ipcMain.handle('terminal:new', () => {
  if (mainWindow) {
    mainWindow.webContents.send('terminal:new');
  }
});

ipcMain.handle('terminal:runActiveFile', () => {
  if (mainWindow) {
    mainWindow.webContents.send('terminal:run-active-file');
  }
});

// IPC-Handler für system buttons (Fenstersteuerung)

ipcMain.handle('file:newTextFile', async () => {
  if (mainWindow) {
    mainWindow.webContents.send('create-new-text-file');
    return true;
  }
  return false;
});

/**
 * IPC handler for saving all open files.
 */
ipcMain.handle('file:saveAll', async (event, files) => {
  assertTrustedSender(event);
  const results = [];

  for (const file of files) {
    try {
      const targetPath = validatePath(file.path);
      await fs.promises.writeFile(targetPath, file.content, 'utf-8');
      results.push({ path: targetPath, success: true });
    } catch (error) {
      console.error(`Error saving file ${file.path}:`, error);
      results.push({ path: file.path, success: false, error: String(error) });
    }
  }

  return results;
});

/**
 * IPC handler for recursive search and replace in files.
 */
ipcMain.handle('editor:findInFiles', async (event, searchText, searchPath, options = {}) => {
  assertTrustedSender(event);
  if (!mainWindow) return { success: false, error: 'No active window' };

  try {
    // Recursive search in files
    const normalizedSearchPath = validatePath(searchPath);
    const files = await getAllFilesRecursive(normalizedSearchPath, { ignore: ['node_modules', '.git'] });
    const results = [];

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(searchText)) {
            results.push({
              file,
              line: i + 1,
              content: line,
              matchStart: line.indexOf(searchText),
              matchEnd: line.indexOf(searchText) + searchText.length
            });
          }
        }
      } catch (error) {
        console.error(`Error searching in file ${file}:`, error);
      }
    }

    mainWindow.webContents.send('editor:findInFilesResults', results);
    return { success: true, count: results.length };
  } catch (error) {
    console.error('Error searching in files:', error);
    return { success: false, error: String(error) };
  }
});

// File system: watch a path for changes (used by VS Code file service)
// Note: fs.watch with { recursive: true } is only fully supported on Windows and macOS.
ipcMain.handle('fs:watch', async (event, watchId: string, watchPath: string) => {
  assertTrustedSender(event);
  try {
    const normalized = validatePath(watchPath);
    // Close any previous watcher with the same id
    const existing = fsWatchers.get(watchId);
    if (existing) {
      try { existing.close(); } catch {}
      fsWatchers.delete(watchId);
    }
    // Skip non-existent paths silently — VS Code probes for config files
    // that may not exist yet; the caller will re-watch when files appear.
    if (!fs.existsSync(normalized)) {
      return true;
    }
    const watcher = fs.watch(normalized, { recursive: true, persistent: false }, (eventType, filename) => {
      if (!event.sender.isDestroyed()) {
        const changedPath = filename ? path.join(normalized, filename) : normalized;
        // Map to VS Code FileChangeType integers: UPDATED=0, ADDED=1, DELETED=2
        let type = 0; // UPDATED
        if (eventType === 'rename') {
          try {
            fs.accessSync(changedPath);
            type = 1; // ADDED
          } catch {
            type = 2; // DELETED
          }
        }
        event.sender.send('fs:watchEvent', { watchId, path: changedPath, type });
      }
    });
    watcher.on('error', () => {
      fsWatchers.delete(watchId);
    });
    fsWatchers.set(watchId, watcher);
    return true;
  } catch (error) {
    console.warn('fs:watch failed:', error);
    return false;
  }
});

// File system: stop watching a path
ipcMain.handle('fs:unwatch', async (event, watchId: string) => {
  assertTrustedSender(event);
  const watcher = fsWatchers.get(watchId);
  if (watcher) {
    try { watcher.close(); } catch {}
    fsWatchers.delete(watchId);
  }
  return true;
});

// File system: copy a file or directory
ipcMain.handle('fs:copy', async (event, sourcePath: string, targetPath: string, overwrite: boolean) => {
  assertTrustedSender(event);
  try {
    const normalizedSrc = validatePath(sourcePath);
    const normalizedDst = validatePath(targetPath);
    if (!overwrite) {
      const exists = fs.existsSync(normalizedDst);
      if (exists) throw new Error(`Target already exists: ${normalizedDst}`);
    }
    await fs.promises.cp(normalizedSrc, normalizedDst, { recursive: true, force: overwrite });
    return true;
  } catch (error) {
    console.error('fs:copy failed:', error);
    return false;
  }
});

// File system: list files recursively (used for extension registration)
ipcMain.handle('fs:listFilesRecursive', async (event, dirPath, options?: { ignore?: string[] }) => {
  assertTrustedSender(event);
  try {
    const normalized = validatePath(dirPath);
    return await getAllFilesRecursive(normalized, options);
  } catch (error) {
    console.error('Failed to list files recursively:', error);
    return [];
  }
});

function setupTerminalIpcHandlers() {
  ipcMain.handle('terminal:create', async (event, rawOptions: TerminalCreateOptions = {}) => {
    assertTrustedSender(event);
    const options = rawOptions ?? {};
    const cwd = resolveWorkingDirectory(options.cwd);
    const shell = resolveShellExecutable(options.shell);
    const env = typeof options.env === 'object' && options.env !== null ? options.env : undefined;
    const { command, args } = buildShellCommand(shell);

    try {
      const child = spawnProcess(command, args, {
        cwd,
        env: {
          ...process.env,
          ...(env ?? {})
        },
        stdio: 'pipe',
        windowsHide: process.platform === 'win32'
      });

      const sessionId = randomUUID();
      const session: TerminalSession = {
        id: sessionId,
        process: child,
        webContents: event.sender
      };

      terminalSessions.set(sessionId, session);

      const handleData = (chunk: string | Buffer) => {
        if (!session.webContents.isDestroyed()) {
          session.webContents.send('terminal:data', { sessionId, data: chunk.toString() });
        }
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('error', error => {
        const message = error instanceof Error ? error.message : String(error);
        sendTerminalError(session.webContents, sessionId, `Terminalfehler: ${message}`);
      });

      child.on('close', (code, signal) => {
        if (!session.webContents.isDestroyed()) {
          session.webContents.send('terminal:exit', {
            sessionId,
            exitCode: typeof code === 'number' ? code : 0,
            signal: typeof signal === 'number' ? signal : 0
          });
        }
        terminalSessions.delete(sessionId);
      });

      session.webContents.once('destroyed', () => {
        if (terminalSessions.delete(sessionId)) {
          try {
            child.kill();
          } catch (error) {
            console.warn('Failed to kill terminal session after renderer destruction:', error);
          }
        }
      });

      if (process.platform === 'win32') {
        try {
          child.stdin.write('\r');
        } catch (error) {
          console.warn('Failed to prime Windows terminal prompt:', error);
        }
      }

      return { sessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendTerminalError(event.sender, null, `Terminal konnte nicht gestartet werden: ${message}`);
      throw error;
    }
  });

  ipcMain.on('terminal:write', (event, payload) => {
    try {
      assertTrustedSender(event);
    } catch {
      return;
    }
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
    const data = typeof payload?.data === 'string' ? payload.data : undefined;
    if (!sessionId || data === undefined) {
      return;
    }

    const session = terminalSessions.get(sessionId);
    if (!session || session.webContents.id !== event.sender.id) {
      sendTerminalError(event.sender, sessionId ?? null, 'Terminal-Sitzung nicht gefunden.');
      return;
    }

    try {
      if (session.process.stdin.writable) {
        session.process.stdin.write(data);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendTerminalError(session.webContents, sessionId, `Schreiben fehlgeschlagen: ${message}`);
    }
  });

  ipcMain.on('terminal:resize', (event, payload) => {
    try {
      assertTrustedSender(event);
    } catch {
      return;
    }
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
    if (!sessionId) {
      return;
    }

    const session = terminalSessions.get(sessionId);
    if (!session || session.webContents.id !== event.sender.id) {
      return;
    }
  });

  ipcMain.handle('terminal:dispose', async (event, payload) => {
    assertTrustedSender(event);
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
    if (!sessionId) {
      return false;
    }

    const session = terminalSessions.get(sessionId);
    if (!session || session.webContents.id !== event.sender.id) {
      return false;
    }

    terminalSessions.delete(sessionId);

    try {
      session.process.kill();
    } catch (error) {
      console.warn('Failed to kill terminal session:', error);
    }

    return true;
  });
}
// Export services for use in other parts of the application
export {
  aiService,
  uiService
};

// Electron Lifecycle: Services und Fenster nach App-Start initialisieren
app.whenReady().then(async () => {
  // A failure to initialize optional services (e.g. AI) must never stop the
  // editor itself from opening — log it and continue so the window still shows.
  try {
    await initializeServices();
  } catch (error) {
    console.error('Service initialization failed, continuing without it:', error);
  }
  setupIpcHandlers();
  setupFsIpcHandlers();
  setupTerminalIpcHandlers();
  createSplashWindow();
  await createWindow();

  // Check for updates against the LS Editor version repo (DATA feed).
  try {
    const update = await getUpdateInfo();
    if (update.updateAvailable) {
      const notification = new Notification({
        title: 'Update available',
        body: `LS Editor ${update.latestVersion} is available (you have ${update.currentVersion}). Click to download.`,
      });
      notification.show();
      notification.on('click', () => {
        shell.openExternal(update.releasesUrl);
      });
      // Let the renderer surface an in-app update banner as well.
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('app:updateAvailable', update);
      }
    }
  } catch (error) {
    console.warn('Update check failed:', error);
  }

  // First launch after an update → show the "What's new" changelog, once the
  // main window is visible (so it doesn't pop over the splash screen).
  const showWhatsNewWhenReady = () => {
    if (!mainWindow) {
      void maybeShowWhatsNew();
      return;
    }
    if (mainWindow.isVisible()) {
      void maybeShowWhatsNew();
    } else {
      mainWindow.once('show', () => { void maybeShowWhatsNew(); });
    }
  };
  showWhatsNewWhenReady();
});

app.on('before-quit', () => {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
  terminalSessions.forEach(session => {
    try {
      session.process.kill();
    } catch (error) {
      console.warn('Failed to kill terminal session during shutdown:', error);
    }
  });
  terminalSessions.clear();
  fsWatchers.forEach(watcher => {
    try { watcher.close(); } catch {}
  });
  fsWatchers.clear();
});

/**
 * Helper function for recursively listing all files in a directory.
 */
function getAllFilesRecursive(dir: string, options?: { ignore?: string[] }): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const results: string[] = [];
    const ignore = new Set((options?.ignore ?? []).map(entry => entry.toLowerCase()));
    fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
      if (err) {
        return reject(err);
      }

      let pending = entries.length;
      if (!pending) {
        return resolve(results);
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (ignore.has(entry.name.toLowerCase())) {
            if (--pending === 0) {
              resolve(results);
            }
            continue;
          }

          getAllFilesRecursive(fullPath, options).then(files => {
            results.push(...files);
            if (--pending === 0) {
              resolve(results);
            }
          }).catch(reject);
        } else {
          results.push(fullPath);
          if (--pending === 0) {
            resolve(results);
          }
        }
      }
    });
  });
}
