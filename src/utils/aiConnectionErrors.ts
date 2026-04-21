/**
 * User-facing message when the local OpenAI-compatible server is unreachable.
 * Covers: process not listening, wrong port/URL, firewall, VPN, and Chromium "Failed to fetch"
 * (not only literal ECONNREFUSED).
 */
export const AI_SERVER_NOT_RUNNING_MESSAGE =
  'Could not connect to the AI server. Check: (1) Ollama or LM Studio is running; (2) in AI settings, the URL and port match your server (Ollama is often http://localhost:11434, LM Studio http://localhost:1234); (3) if you use a custom port, set that base URL; (4) firewall/VPN is not blocking localhost.';

/**
 * Detects rate-limit responses (HTTP 429 / "Too Many Requests") from any provider.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error == null) return false;
  const msg = String((error as { message?: string }).message ?? error);
  return /rate.?limit|too many requests|429|tokens? per minute|tpm|quota exceeded/i.test(msg);
}

/**
 * Returns a friendly rate-limit message, or null if it's not a rate-limit error.
 */
export function mapRateLimitError(error: unknown): string | null {
  if (!isRateLimitError(error)) return null;
  const msg = String((error as { message?: string }).message ?? error);
  // Try to extract the "try again in Xs" hint from the raw API message
  const waitMatch = msg.match(/try again in ([\d.]+s)/i);
  const waitHint = waitMatch ? ` Try again in ${waitMatch[1]}.` : ' Please wait a moment before retrying.';
  // Try to extract token info
  const tpmMatch = msg.match(/Limit (\d+), Used (\d+), Requested (\d+)/i);
  const tpmHint = tpmMatch
    ? ` (limit: ${tpmMatch[1]} TPM, used: ${tpmMatch[2]}, requested: ${tpmMatch[3]})`
    : '';
  return `Rate limit reached${tpmHint}.${waitHint} If this happens often, reduce Max Tokens in Advanced settings or use a paid/higher-tier API plan.`;
}

function hasCode(obj: unknown, code: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  return (obj as { code?: string }).code === code;
}

/**
 * Detects connection refused / unreachable local AI backends (axios, fetch, Node).
 */
export function isConnectionRefusedError(error: unknown): boolean {
  if (error == null) return false;

  if (hasCode(error, 'ECONNREFUSED') || hasCode(error, 'ERR_CONNECTION_REFUSED')) {
    return true;
  }

  const any = error as {
    cause?: unknown;
    errors?: unknown[];
    message?: string;
    code?: string;
  };

  if (any.cause && isConnectionRefusedError(any.cause)) return true;

  if (Array.isArray(any.errors)) {
    for (const e of any.errors) {
      if (isConnectionRefusedError(e)) return true;
    }
  }

  const msg = String(any.message ?? error);
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(msg)) return true;

  /**
   * Chromium often reports a dead/wrong host as TypeError: Failed to fetch.
   * refreshModels wraps that in `new Error("Failed to fetch")` — match both.
   * Not 100% specific to "server down" (CORS/network can also fail), but for a local
   * desktop app pointing at localhost this is almost always unreachable service.
   */
  if (/failed to fetch/i.test(msg)) {
    return true;
  }

  return false;
}

/**
 * Returns the friendly message if this is a connection-refused case; otherwise null.
 */
export function mapAiConnectionError(error: unknown): string | null {
  return isConnectionRefusedError(error) ? AI_SERVER_NOT_RUNNING_MESSAGE : null;
}
