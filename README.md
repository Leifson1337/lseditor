# 🧠 lseditor – Die freie Alternative zu Cursor AI

> **Cursor AI ist großartig – aber auch teuer, cloudbasiert und begrenzt.**  
> lseditor ist die **Open-Source-, lokale und kostenlose Alternative**, die du auf deinem eigenen System mit deinen eigenen KI-Modellen betreiben kannst – ohne API-Limits, ohne Datenschutzprobleme, ohne laufende Kosten.

---

## ✨ Warum lseditor?

- **Kostenlos und Open Source**
- **Offline-fähig** – läuft komplett lokal, auch ohne Internetverbindung
- **Eigene KI-Modelle nutzbar** – z. B. GPT-4 via LM Studio, Ollama, OpenRouter, oobabooga etc.
- **Keine Begrenzungen** – keine Tokenlimits, keine Paywalls, kein Tracking
- **Modularer Aufbau** – leicht erweiterbar und anpassbar
- **Community-Projekt** – werde Teil einer aktiven Entwicklergemeinschaft

---

## 📦 Features (bereits implementiert)

- 🔧 **VSCode-ähnlicher Editor** mit Tabs, Sidebar, Dateiexplorer (via Monaco Editor)
- 💬 **AI-Chat-Panel** mit Markdown-Unterstützung und Codeformatierung
- 🧠 **Inline AI-Prompts** – z. B. „Erkläre diesen Code“, „Refactore“, „Kommentiere“
- 🪄 **Code-Injection & Replacement** per Knopfdruck (Accept/Reject/Insert)
- 🧩 Unterstützung für:
  - Lokale LLMs über HTTP/REST (OpenAI-kompatibel)
  - Custom Endpoints (konfigurierbar)
  - Tokenizer-optimierte Prompts
- 🧪 Vorschau auf Codevervollständigung
- 🎨 Themes: Dark, Light, Dracula, Monokai, etc.
- 💡 Kontextbezogene Tooltips, Docs & Linting-Overlay
- ⚙️ Einstellbare Model-Konfiguration, Prompt-Tuning und Rollen

---

## 🚀 Geplante Features (Community-Mitwirkung erwünscht!)

- ✅ Git-Integration (Commit-Vorschläge, Diff-Analyse)
- ✅ AI-gestützte Code-Tests & Testgenerierung
- ✅ Plugin-System für eigene Tools & Commands
- ✅ AI-Sitzungsspeicher + Chatverlauf
- ✅ Open Source Plugin Marketplace
- ✅ AI-Autocompletion per Hintergrundmodell
- ✅ Workspace-übergreifende Refactorings
- ✅ Voice-Command Support (Speech-to-Code)
- ✅ Docker-Build + Portable-Version

---

## 🔧 Installation

### Voraussetzungen

- Node.js (v18+ empfohlen)
- npm oder pnpm
- Empfohlen: lokaler LLM-Server wie z. B. [Ollama](https://ollama.com/) oder [LM Studio](https://lmstudio.ai/)

### Schritt für Schritt

```bash
# 1. Repository klonen
git clone https://github.com/dein-user/open-cursor.git
cd open-cursor

# 2. Abhängigkeiten installieren
npm install

# 3. Lokalen Dev-Server starten
npm run dev
````
English:

# 🧠 lseditor - The free alternative to Cursor AI

> **Cursor AI is great - but also expensive, cloud-based and limited.** 
> lseditor is the **open-source, local and free alternative** that you can run on your own system with your own AI models - no API limits, no privacy issues, no ongoing costs.

---

## ✨ Why lseditor?

- **Free and open source**
- **Offline-capable** - runs completely locally, even without an internet connection
- **Your own AI models can be used** - e.g. GPT-4 via LM Studio, Ollama, OpenRouter, oobabooga etc.
- **No limits** - no token limits, no paywalls, no tracking
- **Modular structure** - easily expandable and customizable
- **Community project** - become part of an active developer community

---

## 📦 Features (already implemented)

- 🔧 **VSCode-like editor** with tabs, sidebar, file explorer (via Monaco Editor)
- 💬 **AI-Chat-Panel** with Markdown support and code formatting
- 🧠 **Inline AI-Prompts** - e.g. “Explain this code”. e.g. “Explain this code”, ‘Refactore’, “Comment”
- 🪄 **Code injection & replacement** at the touch of a button (Accept/Reject/Insert)
- 🧩 Support for:
  - Local LLMs via HTTP/REST (OpenAI-compatible)
 - Custom endpoints (configurable)
 - Tokenizer-optimized prompts
- 🧪 Preview of code completion
- 🎨 Themes: Dark, Light, Dracula, Monokai, etc.
- 💡 Context-sensitive tooltips, docs & linting overlay
- ⚙️ Adjustable model configuration, prompt tuning and roles

---

## 🚀 Planned features (community participation welcome! )

- ✅ Git integration (commit suggestions, diff analysis)
- ✅ AI-supported code tests & test generation
- ✅ Plugin system for own tools & commands
- ✅ AI session memory + chat history
- ✅ Open Source Plugin Marketplace
- ✅ AI- Autocompletion via background model
- ✅ Workspace-spanning refactorings
- ✅ Voice-Command Support (Speech-to-Code)
- ✅ Docker-Build + Portable-Version

---

## 🔧 Installation

### Requirements

- Node. js (v18+ recommended)
- npm or pnpm
- Recommended: local LLM server such as [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/)

### Step by step

```bash
# 1. clone repository
git clone https://github.com/dein-user/open-cursor.git
cd open-cursor

# 2. install dependencies
npm install

# 3. start local dev server
npm run dev
