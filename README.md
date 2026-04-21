# LS Editor

A lightweight desktop code editor (Electron + React + Monaco) with an integrated **AI chat**, terminal, and file tools. Run models **locally** with **Ollama** or **LM Studio**, or use any OpenAI-compatible API.

---

## Requirements

- **Node.js** 18+
- **npm** (bundled with Node)
- Optional: **[Ollama](https://ollama.com/)** or **[LM Studio](https://lmstudio.ai/)** for local inference

---

## Installation (development)

```bash
git clone <your-fork-or-repo-url> lseditor
cd lseditor
npm install
```

### Run the app

```bash
npm start
```

This runs `webpack` and starts Electron against `dist/`.

### Other scripts

| Command | Description |
|--------|-------------|
| `npm run build` | Production webpack build |
| `npm run postbuild` | Copies preload scripts (runs after build in your pipeline if configured) |
| `npm test` | Jest unit tests |
| `npm run lint` | ESLint |
| `npm run dist` | Build + Windows NSIS installer (see `package.json` / electron-builder) |

---

## Using AI backends

### Ollama (recommended for quick local setup)

1. Install [Ollama](https://ollama.com/) and start the service (default: `http://localhost:11434`).
2. Pull a model, e.g. `ollama pull phi3:mini` or `ollama pull llama3.2`.
3. In LS Editor, open **AI** settings (chat panel gear icon or **View → AI Settings**).
4. Set **Provider** to **Ollama**, **Base URL** `http://localhost:11434` (or your host), choose a **model** from the list.

The **first-time setup** wizard calls `GET http://localhost:11434/api/tags` to list models already on disk when Ollama is running.

### Preset URLs (provider defaults)

| Provider   | Default base URL |
|------------|------------------|
| Ollama     | `http://localhost:11434` |
| LM Studio  | `http://localhost:1234`  |
| Custom     | `http://localhost:1234`  |

Use the OpenAI-compatible path `/v1/chat/completions` on the same host (the app adds `/v1` when calling the API).

---

## Persistence

- **Chat history** and **active conversation id** are stored in **electron-store** (`aiChatState`) via the main process.
- **AI panel settings** (provider, temperature, model, `globalSystemPrompt`, etc.) are saved to **electron-store** (`aiPanelSettingsJson`) and mirrored in **localStorage** for fast startup.
- Workspace path and other app preferences use the same store where applicable (`src/main/appStore.ts`).

### LM Studio

1. Install [LM Studio](https://lmstudio.ai/), download a model, and start the **Local Server** (default is often `http://localhost:1234`).
2. In LS Editor AI settings, set **Provider** to **LM Studio** (or **Custom**) and **Base URL** to your LM Studio server URL (OpenAI-compatible `/v1`).
3. Pick the loaded model from the dropdown after refreshing models.

### Custom OpenAI-compatible API

Use **Custom** provider and set **Base URL** to your server root (e.g. `http://localhost:8000/v1` if your stack expects the `/v1` suffix—match what the app expects in the AI settings UI).

---

## Keyboard shortcuts

Global shortcuts are handled while the editor has focus (Monaco) unless noted.

| Shortcut | Action |
|----------|--------|
| **Ctrl+S** | Save active file |
| **Ctrl+L** | Open AI chat panel and focus the message input |
| **Ctrl+K** | Quick edit: insert current selection (or current line) into the chat as a “quick edit” prompt |
| **Ctrl+Shift+P** | Command palette (menu) |
| **Ctrl+Shift+F** | Search (sidebar) |
| **F11** | Toggle full screen (menu) |

On macOS, **Cmd** often works where **Ctrl** is documented for editor shortcuts; the app listens for both `ctrlKey` and `metaKey` for several shortcuts.

---

## Project layout (high level)

- `src/main.ts` — Electron main process
- `src/components/` — UI (editor shell, chat, first-time setup, …)
- `src/contexts/AIContext.tsx` — AI conversations, settings, tool approvals
- `src/services/AIToolService.ts` — Tool definitions and file/workspace helpers
- `src/ollama/OllamaManager.ts` — Optional bundled/local Ollama process management
- `public/` — Static HTML (e.g. first-time setup window)

---

## Testing

```bash
npm test
```

Unit tests live next to sources as `*.test.ts` (e.g. `OllamaManager.test.ts`, `AIToolService.test.ts`).

---

## License / contributing

See the repository’s license file and contribution guidelines if provided by the maintainers.
