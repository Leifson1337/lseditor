Ollama for Windows (portable build)
===================================

Before running `npm run dist`, copy the official executable here:

  ollama.exe

How to obtain it:
  - Download the Windows build from: https://ollama.com/download
  - Or from the Ollama project’s GitHub releases (Windows).

Expected path after build:
  resources/ollama/ollama.exe  →  in the installed app: resources/ollama/ollama.exe

Note: Some Windows Ollama distributions ship multiple files next to ollama.exe.
If a single file fails to start, copy the entire folder extracted by the Ollama installer
and adjust the path in OllamaManager.resolveBundledOllamaPath() to point to the executable.

Models downloaded automatically are stored in the app’s userData folder (not this directory).
