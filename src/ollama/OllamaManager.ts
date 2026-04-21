import { spawn, ChildProcess, execSync } from 'child_process';
import axios from 'axios';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { app } from 'electron';

const DEFAULT_MODEL = 'phi3:mini';
const READY_ATTEMPTS = 80;
const READY_INTERVAL_MS = 250;

/** Windows uses `ollama.exe`; Linux/macOS use the extensionless `ollama` binary. */
function ollamaBinaryName(): string {
  return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
}

export interface OllamaStartOptions {
  modelsDir: string;
  onLogLine?: (line: string) => void;
  onPortParsed?: (port: number) => void;
}

export interface PullProgressEvent {
  status: string;
  percent: number | null;
  completed?: number;
  total?: number;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object' && addr.port > 0) {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not allocate a free port')));
      }
    });
  });
}

/** Exported for unit tests — parses Ollama serve log output for a listening port. */
export function parsePortFromOllamaLog(chunk: string): number | null {
  const patterns = [
    /Listening on (?:https?:\/\/)?([\d.]+):(\d+)/i,
    /:\s*(\d{2,5})\s*$/m,
    /127\.0\.0\.1:(\d{2,5})/,
    /localhost:(\d{2,5})/i
  ];
  for (const re of patterns) {
    const m = chunk.match(re);
    if (m) {
      const g = m[m.length - 1];
      const p = parseInt(g, 10);
      if (p > 0 && p < 65536) return p;
    }
  }
  return null;
}

export class OllamaManager {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private logBuffer = '';
  private exePath: string | null = null;
  private attachedToExternalInstance = false;

  /**
   * Bundled binary shipped with the app (platform-specific name, no hardcoded .exe on Unix).
   */
  static resolveBundledOllamaPath(): string | null {
    const bin = ollamaBinaryName();
    const candidates: string[] = [];
    try {
      if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'ollama', bin));
      }
    } catch {
      // ignore
    }
    try {
      candidates.push(path.join(app.getAppPath(), 'resources', 'ollama', bin));
    } catch {
      // ignore
    }
    candidates.push(path.join(__dirname, '..', 'resources', 'ollama', bin));
    candidates.push(path.join(process.cwd(), 'resources', 'ollama', bin));

    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c)) {
          return c;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Looks up `ollama` on PATH via `where` (Windows) or `which` (Unix).
   */
  static resolveSystemOllamaFromPath(): string | null {
    try {
      if (process.platform === 'win32') {
        const out = execSync('where ollama', {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        const first = out.trim().split(/\r?\n/)[0]?.trim();
        if (first && fs.existsSync(first)) {
          return first;
        }
      } else {
        const out = execSync('which ollama', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        });
        const p = out.trim().split('\n')[0]?.trim();
        if (p && fs.existsSync(p)) {
          return p;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Prefer a system binary from PATH first, and bundled binary only as fallback. */
  static resolveOllamaExecutable(): string | null {
    return OllamaManager.resolveSystemOllamaFromPath() ?? OllamaManager.resolveBundledOllamaPath();
  }

  /**
   * Returns true when the default local Ollama daemon already answers on 127.0.0.1:11434.
   */
  static async isDefaultOllamaRunning(): Promise<boolean> {
    try {
      const res = await axios.get('http://127.0.0.1:11434/api/tags', {
        timeout: 2000,
        validateStatus: () => true
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  isBundledExecutablePresent(): boolean {
    return Boolean(OllamaManager.resolveBundledOllamaPath());
  }

  getDefaultModelName(): string {
    return DEFAULT_MODEL;
  }

  getOpenAIBaseURL(): string | undefined {
    if (this.port === null) return undefined;
    return `http://127.0.0.1:${this.port}/v1`;
  }

  getBaseUrl(): string | undefined {
    if (this.port === null) return undefined;
    return `http://127.0.0.1:${this.port}`;
  }

  getPort(): number | null {
    return this.port;
  }

  async start(options: OllamaStartOptions): Promise<{ port: number; baseUrl: string }> {
    if (await OllamaManager.isDefaultOllamaRunning()) {
      this.attachedToExternalInstance = true;
      this.child = null;
      this.port = 11434;
      options.onLogLine?.('Using existing Ollama instance on http://127.0.0.1:11434');
      return { port: 11434, baseUrl: 'http://127.0.0.1:11434' };
    }

    this.exePath = OllamaManager.resolveOllamaExecutable();
    if (!this.exePath) {
      throw new Error(
        'ollama executable was not found. Install Ollama or place it in resources/ollama/ before building.'
      );
    }
    this.attachedToExternalInstance = false;

    const port = await getFreePort();
    this.port = port;
    const host = `127.0.0.1:${port}`;
    const modelsDir = options.modelsDir;
    fs.mkdirSync(modelsDir, { recursive: true });

    const env = {
      ...process.env,
      OLLAMA_HOST: host,
      OLLAMA_MODELS: modelsDir,
      OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE ?? '-1'
    };

    const child = spawn(this.exePath, ['serve'], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;

    const appendLog = (data: Buffer) => {
      const text = data.toString();
      this.logBuffer += text;
      if (this.logBuffer.length > 200_000) {
        this.logBuffer = this.logBuffer.slice(-100_000);
      }
      const parsed = parsePortFromOllamaLog(this.logBuffer);
      if (parsed && options.onPortParsed) {
        options.onPortParsed(parsed);
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) options.onLogLine?.(line);
      }
    };

    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      throw new Error('Could not pipe stdout/stderr for Ollama.');
    }
    stdout.on('data', appendLog);
    stderr.on('data', appendLog);

    child.on('error', err => {
      console.error('[OllamaManager] spawn error:', err);
    });

    child.on('close', (code, signal) => {
      console.warn('[OllamaManager] ollama serve exited', code, signal);
      this.child = null;
    });

    await this.waitForApiReady(port);
    const baseUrl = `http://127.0.0.1:${port}`;
    return { port, baseUrl };
  }

  private async waitForApiReady(expectedPort: number): Promise<void> {
    for (let i = 0; i < READY_ATTEMPTS; i++) {
      if (this.child && this.child.exitCode !== null) {
        throw new Error('The ollama process exited before it was ready.');
      }
      try {
        const res = await axios.get(`http://127.0.0.1:${expectedPort}/api/tags`, {
          timeout: 2000,
          validateStatus: () => true
        });
        if (res.status === 200) {
          return;
        }
      } catch {
        // retry
      }
      await new Promise(r => setTimeout(r, READY_INTERVAL_MS));
    }
    throw new Error('Ollama API did not respond in time. Check ollama and your firewall.');
  }

  async listModelNames(baseUrl: string): Promise<string[]> {
    const res = await axios.get(`${baseUrl}/api/tags`, { timeout: 15000 });
    const data = res.data as { models?: { name?: string }[] };
    return (data.models ?? []).map(m => m.name).filter(Boolean) as string[];
  }

  async ensureDefaultModel(
    onProgress: (ev: PullProgressEvent) => void,
    preferredModelName?: string
  ): Promise<string> {
    const base = this.getBaseUrl();
    if (!base) throw new Error('Ollama is not running.');

    const modelToPull = (preferredModelName?.trim() || DEFAULT_MODEL).trim();
    const names = await this.listModelNames(base);
    if (names.length > 0) {
      const preferredBase = modelToPull.split(':')[0]?.toLowerCase() ?? '';
      const matchPreferred = names.find(
        n => n.toLowerCase() === modelToPull.toLowerCase() || n.toLowerCase().startsWith(preferredBase + ':')
      );
      onProgress({ status: 'Model ready.', percent: 100 });
      return matchPreferred ?? names[0]!;
    }

    return await this.pullModel(modelToPull, onProgress);
  }

  async pullModel(modelName: string, onProgress: (ev: PullProgressEvent) => void): Promise<string> {
    const base = this.getBaseUrl();
    if (!base) throw new Error('Ollama is not running.');

    onProgress({ status: `Downloading ${modelName}…`, percent: null });

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
            const status = j.status ?? 'Downloading…';
            onProgress({ status, percent, completed: j.completed, total: j.total });
          } catch {
            // ignore non-json lines
          }
        }
      });
      response.data.on('end', () => resolve());
      response.data.on('error', (err: Error) => reject(err));
    });

    onProgress({ status: 'Download complete.', percent: 100 });
    return modelName;
  }

  async stop(): Promise<void> {
    if (this.attachedToExternalInstance) {
      this.attachedToExternalInstance = false;
      this.child = null;
      this.port = null;
      return;
    }
    if (!this.child || this.child.killed) {
      this.child = null;
      this.port = null;
      return;
    }
    try {
      if (process.platform === 'win32') {
        this.child.kill('SIGTERM');
      } else {
        this.child.kill('SIGTERM');
      }
    } catch (e) {
      console.warn('[OllamaManager] kill:', e);
    }
    this.child = null;
    this.port = null;
  }
}
