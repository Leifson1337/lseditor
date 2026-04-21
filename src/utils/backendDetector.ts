import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import * as https from 'https';
import { shell } from 'electron';
import { detectGPU, downloadBackend, installOllamaSilent } from './gpuDetector';
import type { GPUDetectionResult } from './gpuDetector';

const execFileAsync = promisify(execFile);

const OLLAMA_DEFAULT_PORT = 11434;

const localLmStudioHttpsAgent = new https.Agent({ rejectUnauthorized: false });

async function checkOllamaApi(port: number, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await axios.get(`http://127.0.0.1:${port}/api/tags`, {
      timeout: timeoutMs,
      validateStatus: s => s === 200
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** GET http://127.0.0.1:{port}/api/tags — used by unit tests and diagnostics. */
export async function probeOllamaPort(port: number, timeoutMs = 2500): Promise<boolean> {
  return checkOllamaApi(port, timeoutMs);
}

/** Parses `OLLAMA_HOST` (e.g. `127.0.0.1:11434` or `[::1]:11434`) for a port number. */
function parsePortFromOllamaHostEnv(): number | null {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (!raw) return null;
  const s = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const m = s.match(/:(\d{2,5})\s*$/);
  if (!m) return null;
  const p = parseInt(m[1], 10);
  return p >= 1 && p <= 65535 ? p : null;
}

/**
 * Finds a port on localhost where Ollama responds to GET /api/tags.
 * Order: `OLLAMA_HOST` port, default 11434, then 11435–11466 (parallel probe).
 * Bundled Ollama on an arbitrary port is resolved in the main process (see OllamaManager).
 */
export async function findOllamaListeningPort(): Promise<number | null> {
  const envPort = parsePortFromOllamaHostEnv();
  if (envPort != null && (await checkOllamaApi(envPort, 1200))) {
    return envPort;
  }

  if (await checkOllamaApi(OLLAMA_DEFAULT_PORT, 1200)) {
    return OLLAMA_DEFAULT_PORT;
  }

  const candidates = Array.from({ length: 32 }, (_, i) => 11435 + i);
  const hits = await Promise.all(
    candidates.map(async p => ((await checkOllamaApi(p, 800)) ? p : null))
  );
  return hits.find(x => x !== null) ?? null;
}

const LM_STUDIO_DEFAULT_PORT = 1234;
const DEFAULT_PULL_MODEL = 'phi3:mini';

export interface BackendInfo {
  type: 'ollama' | 'lmstudio' | 'none';
  installed: boolean;
  running: boolean;
  port?: number;
  baseURL?: string;
  models?: string[];
  gpuInfo?: {
    hasDedicatedGPU: boolean;
    name: string;
    vramGB: number;
    vramMB: number;
  };
  /** True when ollama.exe is present or on PATH */
  ollamaInstalled?: boolean;
  /** True when LM Studio install folders exist */
  lmStudioInstalled?: boolean;
  ollamaExePath?: string | null;
  lmStudioExePath?: string | null;
}

async function fetchOllamaModelNames(port: number): Promise<string[]> {
  try {
    const res = await axios.get(`http://127.0.0.1:${port}/api/tags`, { timeout: 8000 });
    const data = res.data as { models?: { name?: string }[] };
    return (data.models ?? []).map(m => m.name).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

/**
 * Runs `ollama list` when possible (supplement to /api/tags).
 */
export async function runOllamaList(ollamaExe: string | null): Promise<string[]> {
  const exe = ollamaExe;
  if (!exe || !fs.existsSync(exe)) {
    return [];
  }
  return await new Promise(resolve => {
    const child = spawn(exe, ['list'], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('close', () => {
      const lines = out.split(/\r?\n/).filter(l => l.trim());
      const models: string[] = [];
      for (const line of lines) {
        if (/^NAME\s+/i.test(line) || /^──/.test(line)) continue;
        const name = line.trim().split(/\s+/)[0];
        if (name && name !== 'NAME') models.push(name);
      }
      resolve(models);
    });
    child.on('error', () => resolve([]));
  });
}

export async function findOllamaExecutable(): Promise<string | null> {
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const candidates = [
      path.join(programFiles, 'Ollama', 'ollama.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }
    try {
      const { stdout } = await execFileAsync('where', ['ollama'], { encoding: 'utf8' });
      const first = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) {
        return first;
      }
    } catch {
      // not on PATH
    }
  } else {
    try {
      const { stdout } = await execFileAsync('which', ['ollama'], { encoding: 'utf8' });
      const p = stdout.trim().split('\n')[0]?.trim();
      if (p && fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function directoryLooksLikeLmStudio(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const exe = path.join(dir, 'LM Studio.exe');
    if (fs.existsSync(exe)) return true;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && /lm\s*studio/i.test(e.name));
  } catch {
    return false;
  }
}

export async function findLmStudioExecutable(): Promise<string | null> {
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA;
    if (!la) return null;
    const dirs = [
      path.join(la, 'Programs', 'LM Studio'),
      path.join(la, 'LM Studio')
    ];
    for (const d of dirs) {
      const exe = path.join(d, 'LM Studio.exe');
      if (fs.existsSync(exe)) {
        return exe;
      }
    }
    for (const d of dirs) {
      if (!fs.existsSync(d)) continue;
      try {
        const stack: { dir: string; depth: number }[] = [{ dir: d, depth: 0 }];
        while (stack.length) {
          const { dir: cur, depth } = stack.pop()!;
          if (depth > 4) continue;
          const entries = fs.readdirSync(cur, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === 'LM Studio.exe') {
              return path.join(cur, e.name);
            }
            if (e.isDirectory()) stack.push({ dir: path.join(cur, e.name), depth: depth + 1 });
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const mac = '/Applications/LM Studio.app/Contents/MacOS/LM Studio';
    if (fs.existsSync(mac)) {
      return mac;
    }
    const home = os.homedir();
    const userApp = path.join(home, 'Applications', 'LM Studio.app', 'Contents', 'MacOS', 'LM Studio');
    if (fs.existsSync(userApp)) {
      return userApp;
    }
    return null;
  }

  const home = os.homedir();
  const linuxCandidates = [
    path.join(home, '.lmstudio', 'LM Studio'),
    path.join(home, '.local', 'share', 'LM Studio', 'LM Studio'),
    '/opt/LM Studio/LM Studio'
  ];
  for (const c of linuxCandidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  try {
    const { stdout } = await execFileAsync('which', ['lm-studio'], { encoding: 'utf8' });
    const p = stdout.trim().split('\n')[0]?.trim();
    if (p && fs.existsSync(p)) {
      return p;
    }
  } catch {
    // not on PATH
  }
  return null;
}

export function isLmStudioInstalled(): boolean {
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA;
    if (!la) return false;
    const dirs = [path.join(la, 'Programs', 'LM Studio'), path.join(la, 'LM Studio')];
    return dirs.some(d => directoryLooksLikeLmStudio(d));
  }
  if (process.platform === 'darwin') {
    return (
      fs.existsSync('/Applications/LM Studio.app') ||
      fs.existsSync(path.join(os.homedir(), 'Applications', 'LM Studio.app'))
    );
  }
  const home = os.homedir();
  const markers = [path.join(home, '.lmstudio'), path.join(home, '.local', 'share', 'lm-studio')];
  return markers.some(p => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/**
 * Filesystem-only check: whether Ollama and LM Studio appear installed (no port / HTTP probe).
 * Used by the AI UI to offer switching between local runtimes.
 */
export async function getLocalBackendInstallFlags(): Promise<{
  ollamaInstalled: boolean;
  lmStudioInstalled: boolean;
}> {
  const ollamaExe = await findOllamaExecutable();
  const lmExe = await findLmStudioExecutable();
  const lmStudioInstalled = Boolean(lmExe) || isLmStudioInstalled();
  return {
    ollamaInstalled: Boolean(ollamaExe),
    lmStudioInstalled
  };
}

async function checkLmStudioOpenAI(
  port: number,
  options?: { scheme?: 'http' | 'https'; timeoutMs?: number }
): Promise<boolean> {
  const scheme = options?.scheme ?? 'http';
  const timeout = options?.timeoutMs ?? 3000;
  const url = `${scheme}://127.0.0.1:${port}/v1/models`;
  try {
    const config: AxiosRequestConfig = {
      timeout,
      validateStatus: s => s >= 200 && s < 500
    };
    if (scheme === 'https') {
      config.httpsAgent = localLmStudioHttpsAgent;
    }
    const res = await axios.get(url, config);
    return res.status === 200;
  } catch {
    return false;
  }
}

/** GET /v1/models — exported for unit tests. */
export async function probeLmStudioModelsEndpoint(
  port: number,
  options?: { scheme?: 'http' | 'https'; timeoutMs?: number }
): Promise<boolean> {
  return checkLmStudioOpenAI(port, options);
}

/**
 * Finds LM Studio's local OpenAI-compatible server (http first, then https on the same ports).
 */
export async function findLmStudioListeningPort(): Promise<{
  port: number;
  scheme: 'http' | 'https';
} | null> {
  if (await checkLmStudioOpenAI(LM_STUDIO_DEFAULT_PORT, { scheme: 'http', timeoutMs: 1200 })) {
    return { port: LM_STUDIO_DEFAULT_PORT, scheme: 'http' };
  }
  const candidates = Array.from({ length: 24 }, (_, i) => 1235 + i);
  const httpHits = await Promise.all(
    candidates.map(async p =>
      (await checkLmStudioOpenAI(p, { scheme: 'http', timeoutMs: 800 })) ? p : null
    )
  );
  const httpPort = httpHits.find(x => x !== null);
  if (httpPort != null) {
    return { port: httpPort, scheme: 'http' };
  }

  const httpsPorts = [LM_STUDIO_DEFAULT_PORT, ...candidates];
  const httpsHits = await Promise.all(
    httpsPorts.map(async p =>
      (await checkLmStudioOpenAI(p, { scheme: 'https', timeoutMs: 800 })) ? p : null
    )
  );
  const httpsPort = httpsHits.find(x => x !== null);
  return httpsPort != null ? { port: httpsPort, scheme: 'https' } : null;
}

export async function fetchLmStudioFirstModelId(
  port: number = LM_STUDIO_DEFAULT_PORT,
  scheme: 'http' | 'https' = 'http'
): Promise<string | null> {
  try {
    const config: AxiosRequestConfig = { timeout: 5000 };
    if (scheme === 'https') {
      config.httpsAgent = localLmStudioHttpsAgent;
    }
    const res = await axios.get(`${scheme}://127.0.0.1:${port}/v1/models`, config);
    const data = res.data as { data?: { id?: string }[] };
    const id = data.data?.[0]?.id;
    return id ?? null;
  } catch {
    return null;
  }
}

function mapGpu(gpu: GPUDetectionResult): NonNullable<BackendInfo['gpuInfo']> {
  return {
    hasDedicatedGPU: gpu.hasDedicatedGPU,
    name: gpu.name || (gpu.hasDedicatedGPU ? 'GPU' : 'Integrated / unknown'),
    vramGB: gpu.vramGB,
    vramMB: gpu.vramMB
  };
}

export interface ParallelBackendSnapshot {
  ollama: {
    installed: boolean;
    running: boolean;
    port: number | null;
    baseURL: string | null;
    models: string[];
    exePath: string | null;
  };
  lmstudio: {
    installed: boolean;
    running: boolean;
    port: number | null;
    scheme: 'http' | 'https' | null;
    baseURL: string | null;
    exePath: string | null;
  };
  gpuInfo: NonNullable<BackendInfo['gpuInfo']>;
}

/**
 * Probes Ollama and LM Studio in parallel (health checks on standard and nearby ports).
 * Use for first-run wizards and dual-backend preference UI.
 */
export async function scanParallelBackends(): Promise<ParallelBackendSnapshot> {
  const gpu = await detectGPU();
  const gpuInfo = mapGpu(gpu);

  const [ollamaExe, discoveredOllamaPort, discoveredLm] = await Promise.all([
    findOllamaExecutable(),
    findOllamaListeningPort(),
    findLmStudioListeningPort()
  ]);

  let models: string[] = [];
  if (discoveredOllamaPort != null) {
    models = await fetchOllamaModelNames(discoveredOllamaPort);
    if (models.length === 0 && ollamaExe) {
      const cliModels = await runOllamaList(ollamaExe);
      if (cliModels.length) {
        models = cliModels;
      }
    }
  }

  const lmExe = await findLmStudioExecutable();
  const lmStudioInstalled = Boolean(lmExe) || isLmStudioInstalled();
  const ollamaInstalled = Boolean(ollamaExe);

  const ollamaBase =
    discoveredOllamaPort != null ? `http://127.0.0.1:${discoveredOllamaPort}/v1` : null;
  const lmBase =
    discoveredLm != null
      ? `${discoveredLm.scheme}://127.0.0.1:${discoveredLm.port}/v1`
      : null;

  return {
    ollama: {
      installed: ollamaInstalled,
      running: discoveredOllamaPort != null,
      port: discoveredOllamaPort,
      baseURL: ollamaBase,
      models,
      exePath: ollamaExe
    },
    lmstudio: {
      installed: lmStudioInstalled,
      running: discoveredLm != null,
      port: discoveredLm?.port ?? null,
      scheme: discoveredLm?.scheme ?? null,
      baseURL: lmBase,
      exePath: lmExe
    },
    gpuInfo
  };
}

export interface DetectBackendsOptions {
  /** When both backends respond on localhost, select which one drives `BackendInfo.type`. */
  prefer?: 'ollama' | 'lmstudio';
}

/**
 * Scans for Ollama / LM Studio installs, running services, and GPU (for recommendations).
 */
export async function detectBackends(options?: DetectBackendsOptions): Promise<BackendInfo> {
  const snap = await scanParallelBackends();
  const prefer = options?.prefer;

  const ollamaExe = snap.ollama.exePath;
  const lmExe = snap.lmstudio.exePath;
  const ollamaInstalled = snap.ollama.installed;
  const lmStudioInstalled = snap.lmstudio.installed;
  const gpuInfo = snap.gpuInfo;

  const discoveredOllamaPort = snap.ollama.port;
  const models = snap.ollama.models;
  const ollamaUp = snap.ollama.running && discoveredOllamaPort != null;
  const discoveredLm =
    snap.lmstudio.running && snap.lmstudio.port != null && snap.lmstudio.scheme != null
      ? { port: snap.lmstudio.port, scheme: snap.lmstudio.scheme }
      : null;
  const lmUp = discoveredLm != null;

  if (ollamaUp && lmUp && discoveredOllamaPort != null && discoveredLm) {
    if (prefer === 'lmstudio') {
      const { port: lmPort, scheme: lmScheme } = discoveredLm;
      const lmBaseURL = `${lmScheme}://127.0.0.1:${lmPort}/v1`;
      return {
        type: 'lmstudio',
        installed: lmStudioInstalled,
        running: true,
        port: lmPort,
        baseURL: lmBaseURL,
        gpuInfo,
        ollamaInstalled,
        lmStudioInstalled,
        ollamaExePath: ollamaExe,
        lmStudioExePath: lmExe
      };
    }
    return {
      type: 'ollama',
      installed: true,
      running: true,
      port: discoveredOllamaPort,
      baseURL: `http://127.0.0.1:${discoveredOllamaPort}/v1`,
      models,
      gpuInfo,
      ollamaInstalled,
      lmStudioInstalled,
      ollamaExePath: ollamaExe,
      lmStudioExePath: lmExe
    };
  }

  if (ollamaUp && discoveredOllamaPort != null) {
    return {
      type: 'ollama',
      installed: true,
      running: true,
      port: discoveredOllamaPort,
      baseURL: `http://127.0.0.1:${discoveredOllamaPort}/v1`,
      models,
      gpuInfo,
      ollamaInstalled,
      lmStudioInstalled,
      ollamaExePath: ollamaExe,
      lmStudioExePath: lmExe
    };
  }

  if (lmUp && discoveredLm) {
    const { port: lmPort, scheme: lmScheme } = discoveredLm;
    const lmBaseURL = `${lmScheme}://127.0.0.1:${lmPort}/v1`;
    return {
      type: 'lmstudio',
      installed: lmStudioInstalled,
      running: true,
      port: lmPort,
      baseURL: lmBaseURL,
      gpuInfo,
      ollamaInstalled,
      lmStudioInstalled,
      ollamaExePath: ollamaExe,
      lmStudioExePath: lmExe
    };
  }

  if (ollamaInstalled) {
    return {
      type: 'ollama',
      installed: true,
      running: false,
      port: OLLAMA_DEFAULT_PORT,
      baseURL: `http://127.0.0.1:${OLLAMA_DEFAULT_PORT}/v1`,
      gpuInfo,
      ollamaInstalled: true,
      lmStudioInstalled,
      ollamaExePath: ollamaExe,
      lmStudioExePath: lmExe
    };
  }

  if (lmStudioInstalled) {
    return {
      type: 'lmstudio',
      installed: true,
      running: false,
      port: LM_STUDIO_DEFAULT_PORT,
      baseURL: `http://127.0.0.1:${LM_STUDIO_DEFAULT_PORT}/v1`,
      gpuInfo,
      ollamaInstalled: false,
      lmStudioInstalled: true,
      ollamaExePath: null,
      lmStudioExePath: lmExe
    };
  }

  return {
    type: 'none',
    installed: false,
    running: false,
    gpuInfo,
    ollamaInstalled: false,
    lmStudioInstalled: false,
    ollamaExePath: null,
    lmStudioExePath: null
  };
}

export type PullProgressCb = (status: string, percent: number | null) => void;

/**
 * Pulls a model via Ollama HTTP API (system install on default port).
 */
export async function pullOllamaModel(
  port: number,
  modelName: string,
  onProgress?: PullProgressCb
): Promise<string> {
  const base = `http://127.0.0.1:${port}`;
  onProgress?.(`Downloading ${modelName}…`, null);

  const response = await axios.post(
    `${base}/api/pull`,
    { name: modelName, stream: true },
    {
      responseType: 'stream',
      timeout: 0,
      validateStatus: () => true
    }
  );

  if (response.status >= 400 || !response.data) {
    throw new Error(`Pull failed: HTTP ${response.status}`);
  }

  let buffer = '';
  await new Promise<void>((resolve, reject) => {
    response.data.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const j = JSON.parse(trimmed) as {
            status?: string;
            completed?: number;
            total?: number;
          };
          let percent: number | null = null;
          if (typeof j.completed === 'number' && typeof j.total === 'number' && j.total > 0) {
            percent = Math.min(100, Math.round((100 * j.completed) / j.total));
          }
          onProgress?.(j.status ?? 'Downloading…', percent);
        } catch {
          // ignore
        }
      }
    });
    response.data.on('end', () => resolve());
    response.data.on('error', (err: Error) => reject(err));
  });

  onProgress?.('Download complete.', 100);
  return modelName;
}

/**
 * Downloads OllamaSetup.exe and runs silent install (/S).
 */
export async function installOllama(): Promise<void> {
  const destDir = path.join(os.tmpdir(), 'lseditor-ollama-setup');
  const installerPath = await downloadBackend('ollama', destDir);
  await installOllamaSilent(installerPath);
}

/**
 * Downloads the LM Studio installer and reveals it in Explorer/Finder.
 */
export async function downloadLMStudioInstaller(): Promise<string> {
  const destDir = path.join(os.tmpdir(), 'lseditor-lm-setup');
  const p = await downloadBackend('lmstudio', destDir);
  shell.showItemInFolder(p);
  return p;
}

export async function waitForLmStudioServer(
  _port: number = LM_STUDIO_DEFAULT_PORT,
  timeoutMs = 90000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await findLmStudioListeningPort();
    if (found != null) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

/**
 * Tries to launch LM Studio (detached). User may still need to start the local server in the UI.
 */
export function launchLmStudio(exePath: string): void {
  if (!fs.existsSync(exePath)) return;
  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}

/** Starts the Ollama application (may enable the background service on Windows). */
export function launchOllamaApp(exePath: string): void {
  if (!fs.existsSync(exePath)) return;
  const child = spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}

function parseOpenAiCompatibleModelList(payload: unknown): string[] {
  if (payload == null || typeof payload !== 'object') return [];
  const p = payload as { data?: unknown[]; models?: unknown[] };
  const list = Array.isArray(p.data) ? p.data : Array.isArray(p.models) ? p.models : [];
  if (!Array.isArray(list)) return [];
  return list
    .map((item: unknown) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const o = item as { id?: string; name?: string; model?: string };
        return o.id || o.name || o.model;
      }
      return undefined;
    })
    .filter((x): x is string => Boolean(x));
}

/**
 * Lists models from a running local Ollama or LM Studio server (intended for the main process).
 * LM Studio uses axios with relaxed TLS for https://127.0.0.1 — renderer `fetch` often fails on self-signed certs.
 */
export async function listLocalModelsForProvider(
  provider: 'ollama' | 'lmstudio'
): Promise<{ models: string[]; baseUrl: string | null; error?: string }> {
  if (provider === 'ollama') {
    const port = await findOllamaListeningPort();
    if (port == null) {
      return { models: [], baseUrl: null, error: 'Ollama server not detected on localhost.' };
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const models = await fetchOllamaModelNames(port);
      return { models, baseUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { models: [], baseUrl, error: msg };
    }
  }

  const lm = await findLmStudioListeningPort();
  if (lm == null) {
    return { models: [], baseUrl: null, error: 'LM Studio server not detected on localhost.' };
  }
  const baseUrl = `${lm.scheme}://127.0.0.1:${lm.port}`;
  try {
    const config: AxiosRequestConfig = {
      timeout: 20000,
      validateStatus: (s: number) => s === 200
    };
    if (lm.scheme === 'https') {
      config.httpsAgent = localLmStudioHttpsAgent;
    }
    const res = await axios.get(`${baseUrl}/v1/models`, config);
    const models = parseOpenAiCompatibleModelList(res.data);
    return { models, baseUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { models: [], baseUrl, error: msg };
  }
}

export async function getOllamaModels(port: number = OLLAMA_DEFAULT_PORT): Promise<string[]> {
  return fetchOllamaModelNames(port);
}

export async function waitForOllamaServer(
  _port: number = OLLAMA_DEFAULT_PORT,
  timeoutMs = 120000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await findOllamaListeningPort();
    if (p != null) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export { OLLAMA_DEFAULT_PORT, LM_STUDIO_DEFAULT_PORT, DEFAULT_PULL_MODEL };
