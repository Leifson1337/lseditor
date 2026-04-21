# Local inference: Ollama and LM Studio

This document describes how LS Editor detects local AI backends, starts them when possible, and stores your preferences.

## Ports and health checks

| Backend   | Default port | Health check |
|----------|--------------|--------------|
| Ollama   | 11434        | `GET http://127.0.0.1:{port}/api/tags` → HTTP 200 |
| LM Studio | 1234 (HTTP) or HTTPS on same port range | `GET {scheme}://127.0.0.1:{port}/v1/models` → HTTP 200 |

If the default port is busy, the app probes nearby ports (Ollama: 11435–11466; LM Studio: 1235–1258 and HTTPS variants).

## LM Studio CLI (`lms`)

LM Studio ships a CLI under `~/.lmstudio/bin/lms` (macOS/Linux) or `%USERPROFILE%\.lmstudio\bin\lms.exe` (Windows). After running LM Studio once, you can run `lms bootstrap` (see [LM Studio blog](https://lmstudio.ai/blog)).

To start the API server without using the GUI:

```bash
lms server start
```

LS Editor uses this command when it needs to bring the LM Studio server online and the GUI fallback is available if `lms` is missing.

## Stored settings

- `preferredLocalBackend`: `'ollama' | 'lmstudio'` — used when both products are installed to avoid starting two servers and to pick URLs for autodetection.
- `backendChoice` and `localOpenAIBaseURL` — align with the chosen stack.
- Changing **AI → Provider** to Ollama or LM Studio updates `preferredLocalBackend` for the next launch.

## Troubleshooting

1. **Nothing connects**  
   Confirm the backend process is running and the URL in AI settings matches the listening port (check LM Studio’s “Server” tab or `ollama list` / `curl http://127.0.0.1:11434/api/tags`).

2. **`lms` not found**  
   Install LM Studio, open it once, then run `lms bootstrap` in a new terminal and retry.

3. **Firewall / VPN**  
   Localhost should not be blocked; disable VPN split-tunnel issues if `127.0.0.1` fails.

4. **Both Ollama and LM Studio installed**  
   On first launch you’ll be asked which backend to prefer. You can change this later in AI settings (provider).

## Tests

See `src/utils/backendDetector.test.ts`, `src/lmstudio/LmStudioManager.test.ts`, and `src/utils/localInference.integration.test.ts`.
