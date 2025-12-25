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
import { spawn as spawnProcess, exec as execProcess, ExecException, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import * as https from 'https';

// Main window and service instances
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashShownAt = 0;
const MIN_SPLASH_MS = 4000;
let aiService: AIService;
let uiService: UIService | undefined = undefined;

interface TerminalSession {
  id: string;
  process: ChildProcessWithoutNullStreams;
  webContents: Electron.WebContents;
}

const terminalSessions = new Map<string, TerminalSession>();

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
}

const VERSION_ENDPOINT = 'https://raw.githubusercontent.com/Bauvater/lseditor-version/refs/heads/main/DATA';
let cachedRemoteVersion: RemoteVersionResponse | null = null;
let lastVersionFetch = 0;
let aboutWindow: BrowserWindow | null = null;
const DEFAULT_BASE_PROMPT_PATH = path.join(process.cwd(), 'config', 'base-prompt.md');
const APP_ICON_FILENAME = 'logo.png';

if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.lseditor.app');
  } catch (error) {
    console.warn('Failed to set AppUserModelID:', error);
  }
}

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
      const stats = fs.statSync(requested);
      if (stats.isDirectory()) {
        return requested;
      }
    } catch {
      // Ignore invalid paths and fall back to process.cwd()
    }
  }
  return process.cwd();
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

async function openAboutWindow(): Promise<void> {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  const remoteVersion = await fetchRemoteVersion();
  const programInfo = remoteVersion?.program ?? {};
  const version = programInfo.version || app.getVersion();
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

  const latestVersion = programInfo.version || remoteVersion?.program?.version || version;
  const lastCheckedLabel = lastVersionFetch ? new Date(lastVersionFetch).toLocaleString() : 'Nie';
  const updateBadge = latestVersion && latestVersion !== version ? 'Update verfuegbar' : 'Aktuell';

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
  try {
    await fs.promises.access(pathToCheck, fs.constants.F_OK);
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

ipcMain.handle('exec', async (_event, command: unknown, options?: { cwd?: string }) => {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Ungültiger Befehl');
  }

  const cwd = typeof options?.cwd === 'string' && options.cwd.trim().length
    ? options.cwd
    : process.cwd();

  return new Promise((resolve, reject) => {
    try {
      execProcess(
        command,
        { cwd, windowsHide: true },
        (error: ExecException | null, stdout = '', stderr = '') => {
          if (error) {
            reject({
              stdout,
              stderr,
              code: error.code ?? 1,
              message: error.message ?? 'Command failed'
            });
            return;
          }
          resolve({
            stdout,
            stderr,
            code: 0
          });
        }
      );
    } catch (error) {
      reject(error);
    }
  });
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
      preload: path.join(__dirname, 'preload.js')
    }
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
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.getCodeCompletion(filePath, position);
  });

  // IPC handler for explaining code
  ipcMain.handle('explain-code', async (event, filePath: string, selection: any) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.explainCode(filePath, selection);
  });

  // IPC handler for refactoring code
  ipcMain.handle('refactor-code', async (event, filePath: string, selection: any, refactorType: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.refactorCode(filePath, selection, refactorType);
  });
}

/**
 * Sets up IPC handlers for file system operations, including reading directories, files, and writing files.
 */
function setupFsIpcHandlers() {
  // Improved path normalization for Windows
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

  // File system: read directory
  ipcMain.handle('fs:readDir', async (event, dirPath) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory()
      }));
    } catch (err) {
      return [];
    }
  });

  // File system: read file
  ipcMain.handle('fs:readFile', async (_event, filePath) => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        throw new Error('Ungueltiger Dateipfad');
      }
      const normalizedPath = normalizeFsPath(filePath);
      return await fs.promises.readFile(normalizedPath, 'utf-8');
    } catch (error) {
      console.error('Failed to read file:', error);
      throw error;
    }
  });

  // File system: write file
  ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
    try {
      if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        throw new Error('Invalid file path');
      }
      const targetPath = normalizeFsPath(filePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const data = typeof content === 'string' ? content : String(content ?? '');
      await fs.promises.writeFile(targetPath, data, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error writing file:', error);
      return false;
    }
  });

  // File system: check if path exists
  ipcMain.handle('fs:exists', async (event, pathToCheck) => {
    try {
      const normalized = normalizeFsPath(pathToCheck);
      await fs.promises.access(normalized);
      return true;
    } catch (error) {
      return false;
    }
  });

  // File system: check if path exists and is directory
  ipcMain.handle('fs:checkPathExistsAndIsDirectory', async (event, path) => {
    try {
      const normalized = normalizeFsPath(path);
      const stats = await fs.promises.stat(normalized);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  });

  // File system: create directory recursively
  ipcMain.handle('fs:createDirectory', async (event, dirPath) => {
    try {
      const normalized = normalizeFsPath(dirPath);
      await fs.promises.mkdir(normalized, { recursive: true });
      return true;
    } catch (error) {
      console.error('Error creating directory:', error);
      return false;
    }
  });

  // File system: delete file
  ipcMain.handle('fs:deleteFile', async (event, filePath) => {
    try {
      const normalized = normalizeFsPath(filePath);
      await fs.promises.unlink(normalized);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  });

  // File system: delete directory recursively
  ipcMain.handle('fs:deleteDirectory', async (event, dirPath) => {
    try {
      const normalized = normalizeFsPath(dirPath);
      await fs.promises.rm(normalized, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Error deleting directory:', error);
      return false;
    }
  });

  // File system: rename file or directory
  ipcMain.handle('fs:renameFile', async (event, oldPath, newPath) => {
    try {
      const sourcePath = normalizeFsPath(String(oldPath ?? ''));
      let targetPath = typeof newPath === 'string' && newPath.trim().length ? newPath.trim() : '';
      if (!targetPath) {
        throw new Error('Neuer Dateiname fehlt.');
      }
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join(path.dirname(sourcePath), targetPath);
      }
      targetPath = normalizeFsPath(targetPath);
      await fs.promises.rename(sourcePath, targetPath);
      return true;
    } catch (error) {
      console.error('Error renaming file:', error);
      return false;
    }
  });

  // Extension system: search marketplace
  ipcMain.handle('extension:search', async (event, query) => {
    return new Promise((resolve) => {
      const url = `https://open-vsx.org/api/-/search?q=${encodeURIComponent(query)}`;
      https.get(url, (res) => {
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
      const tempPath = path.join(app.getPath('temp'), fileName);
      const targetPath = normalizeFsPath(targetDir);

      // Ensure target directory exists
      await fs.promises.mkdir(targetPath, { recursive: true });

      // Download the file
      const file = fs.createWriteStream(tempPath);
      await new Promise<void>((resolve, reject) => {
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            // Handle redirect
            https.get(response.headers.location!, (res2) => {
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
            const fullTargetPath = path.join(targetPath, targetEntryPath);
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
}

// --- Fehlende IPC-Handler für Renderer-Kommunikation ---
ipcMain.handle('getDirectoryEntries', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: path.join(dirPath, entry.name)
    }));
  } catch (error) {
    return { error: String(error) };
  }
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
  const win = mainWindow;
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openDirectory']
  };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths.length) return null;
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

ipcMain.handle('shell:openPath', async (_event, targetPath: unknown) => {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return false;
  }

  try {
    const normalized = path.resolve(targetPath);
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

ipcMain.handle('app:newWindow', async () => {
  await createWindow();
});

ipcMain.handle('app:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow!.webContents.send('file:open', result.filePaths[0]);
  }
});

ipcMain.handle('app:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
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
  const results = [];

  for (const file of files) {
    try {
      await fs.promises.writeFile(file.path, file.content, 'utf-8');
      results.push({ path: file.path, success: true });
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
  if (!mainWindow) return { success: false, error: 'No active window' };

  try {
    // Recursive search in files
    const files = await getAllFilesRecursive(searchPath);
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

function setupTerminalIpcHandlers() {
  ipcMain.handle('terminal:create', async (event, rawOptions: TerminalCreateOptions = {}) => {
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
  await initializeServices();
  createSplashWindow();
  await createWindow();
  setupIpcHandlers();
  setupFsIpcHandlers();
  setupTerminalIpcHandlers();

  // Check for updates
  const remoteVersion = await fetchRemoteVersion();
  if (remoteVersion && remoteVersion.program && remoteVersion.program.version) {
    const currentVersion = app.getVersion();
    if (remoteVersion.program.version > currentVersion) {
      const notification = new Notification({
        title: 'Update available',
        body: `A new version (${remoteVersion.program.version}) is available.`,
      });
      notification.show();
      notification.on('click', () => {
        if (remoteVersion.program?.repository?.url) {
          shell.openExternal(remoteVersion.program.repository.url);
        }
      });
    }
  }
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
});

/**
 * Helper function for recursively listing all files in a directory.
 */
function getAllFilesRecursive(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const results: string[] = [];
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
          // Skip node_modules and .git
          if (entry.name === 'node_modules' || entry.name === '.git') {
            if (--pending === 0) {
              resolve(results);
            }
            continue;
          }

          getAllFilesRecursive(fullPath).then(files => {
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
