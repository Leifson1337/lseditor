/**
 * Structured logging for local inference startup, detection, and health checks.
 * Prefixes messages for grep-friendly diagnostics across Ollama and LM Studio paths.
 */

export type InferenceLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface InferenceLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return '';
  }
}

export function createInferenceLogger(scope: string, sink?: (line: string) => void): InferenceLogger {
  const emit = (level: InferenceLogLevel, msg: string, meta?: Record<string, unknown>) => {
    const line = `[${scope}] [${level}] ${msg}${formatMeta(meta)}`;
    if (sink) {
      sink(line);
    } else {
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }
  };

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta)
  };
}
