import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findLmStudioListeningPort,
  launchLmStudio,
  waitForLmStudioServer,
  LM_STUDIO_DEFAULT_PORT
} from '../utils/backendDetector';
import type { InferenceLogger } from '../utils/inferenceLogger';
import { createInferenceLogger } from '../utils/inferenceLogger';

const DEFAULT_START_TIMEOUT_MS = 120_000;
const LMS_START_RETRY = 2;

/** CLI shipped alongside LM Studio; see https://lmstudio.ai/blog — `lms server start`. */
export function resolveLmsCliPath(): string | null {
  const home = os.homedir();
  if (!home) return null;
  const binName = process.platform === 'win32' ? 'lms.exe' : 'lms';
  const primary = path.join(home, '.lmstudio', 'bin', binName);
  if (fs.existsSync(primary)) {
    return primary;
  }
  return null;
}

export interface LmStudioStartOptions {
  /** Path to LM Studio.app / LM Studio.exe (GUI fallback). */
  lmStudioExePath?: string | null;
  timeoutMs?: number;
  log?: InferenceLogger;
}

/**
 * Starts LM Studio's local OpenAI-compatible server when possible using the `lms` CLI
 * (`lms server start`). Falls back to launching the desktop app if the CLI is missing.
 * Waits until `/v1/models` responds on a discovered port.
 */
export class LmStudioManager {
  private static lmsChild: ChildProcess | null = null;

  static getLmsChild(): ChildProcess | null {
    return LmStudioManager.lmsChild;
  }

  /**
   * Ensures the LM Studio API server is reachable: probes existing listeners first,
   * then tries `lms server start`, then GUI launch + wait.
   */
  static async ensureLocalServerRunning(options: LmStudioStartOptions = {}): Promise<boolean> {
    const log = options.log ?? createInferenceLogger('LmStudioManager');
    const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;

    const existing = await findLmStudioListeningPort();
    if (existing != null) {
      log.info('LM Studio server already listening', {
        port: existing.port,
        scheme: existing.scheme
      });
      return true;
    }

    const lmsPath = resolveLmsCliPath();
    if (lmsPath) {
      log.info('Starting LM Studio server via CLI', { lmsPath });
      for (let attempt = 0; attempt < LMS_START_RETRY; attempt++) {
        const ok = await LmStudioManager.tryStartViaLms(lmsPath, log, timeoutMs);
        if (ok) {
          return true;
        }
        log.warn('lms server start did not become ready; retrying', { attempt: attempt + 1 });
      }
    } else {
      log.warn('lms CLI not found under ~/.lmstudio/bin; run LM Studio once, then run bootstrap.', {
        hint: 'https://lmstudio.ai/blog/lms'
      });
    }

    if (options.lmStudioExePath && fs.existsSync(options.lmStudioExePath)) {
      log.info('Falling back to launching LM Studio GUI (server may need enabling in app)');
      launchLmStudio(options.lmStudioExePath);
      const ok = await waitForLmStudioServer(LM_STUDIO_DEFAULT_PORT, timeoutMs);
      if (ok) {
        log.info('LM Studio server became reachable after GUI launch');
        return true;
      }
      log.error('LM Studio server did not respond in time after GUI launch');
      return false;
    }

    log.error('Could not start LM Studio: no lms CLI and no LM Studio executable path');
    return false;
  }

  private static tryStartViaLms(
    lmsPath: string,
    log: InferenceLogger,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      const child = spawn(lmsPath, ['server', 'start'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      LmStudioManager.lmsChild = child;

      const onChunk = (buf: Buffer, stream: string) => {
        const text = buf.toString();
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            log.debug(`lms ${stream}: ${line.trim()}`);
          }
        }
      };
      child.stdout?.on('data', d => onChunk(d, 'stdout'));
      child.stderr?.on('data', d => onChunk(d, 'stderr'));

      child.on('error', err => {
        log.error('lms spawn failed', { message: err.message });
        finish(false);
      });

      child.on('close', (code, signal) => {
        log.info('lms server start process exited', { code, signal });
        LmStudioManager.lmsChild = null;
      });

      void (async () => {
        const up = await waitForLmStudioServer(LM_STUDIO_DEFAULT_PORT, timeoutMs);
        finish(up);
      })();
    });
  }
}
