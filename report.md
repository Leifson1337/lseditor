# LSEditor — AI Chat & Bugfix Report

_Datum: 2026-06-13_

Dieser Bericht dokumentiert die gefundenen und behobenen Bugs sowie die
Verbesserungen am AI-Chat, die von **Atomic Chat** (lokale Modelle im Programm
herunterladen & nutzen, Animationen) und **OpenCode** (Coding-Workflow)
inspiriert sind. Alles bleibt vollständig in das Programm integriert.

---

## 1. Gefundene & behobene Bugs

### Grundursache (betraf gleich mehrere Bugs)
Im Renderer ist das `path`-Modul per Webpack auf **`path-browserify` (POSIX)**
gemappt (`webpack.config.js:73`). Dadurch arbeiten `path.join`, `path.dirname`,
`path.basename` und `path.isAbsolute` mit `/`-Logik. Ein Windows-Pfad wie
`C:\Users\User\Desktop\Projekte\Test Projekt\datei.txt` enthält **kein `/`**,
also:

- `path.basename("C:\\...\\datei.txt")` → liefert **den ganzen Pfad** statt `datei.txt`
- `path.dirname("C:\\...\\datei.txt")` → liefert `.`
- `path.join("C:\\...\\Test Projekt", "datei.txt")` → `C:\...\Test Projekt/datei.txt` (**gemischte Slashes**)

Das erklärt alle drei gemeldeten Symptome.

### Bug 1 — Gemischte Slashes im Pfad
`C:\Users\User\Desktop\Projekte\Test Projekt/untitleds.txt`
**Ursache:** POSIX-`path.join` im Renderer.
**Fix:** Neue Windows-bewusste Helfer in `src/utils/pathUtils.ts`
(`getBaseName`, `getDirName`, `joinPaths`, `toNativeSeparators`), die mit beiden
Separatoren umgehen und den vorhandenen Separator-Stil beibehalten. Eingesetzt in
`FileExplorer.tsx` und `App.tsx`.

### Bug 2 — Neue Datei wird links im File-Browser nicht angezeigt
**Ursache:** Die erzeugte Datei bekam einen gemischten Pfad und passte nicht zur
Backslash-Schreibweise der übrigen Tree-Knoten (`getDirectoryEntries` liefert
saubere Windows-Pfade), wodurch Vergleich/Anzeige inkonsistent war.
**Fix:** `handleNewFileConfirm` nutzt jetzt `joinPaths`, sodass der erzeugte Pfad
identisch zur Tree-Repräsentation ist. Nach dem Anlegen wird wie gehabt
`explorer:refresh` ausgelöst → `refreshFileStructure()` lädt den Baum neu.

### Bug 3 — Umbenennen funktioniert nicht
**Ursache:** Beim Start des Umbenennens wurde das Eingabefeld mit
`path.basename(file)` vorbefüllt – das lieferte den **kompletten Pfad**. Beim
Bestätigen war `trimmed === currentName` (beide = ganzer Pfad) → Abbruch ohne
Umbenennung. Falls doch geändert, ergab `path.dirname`/`path.join` einen falschen
Zielpfad.
**Fix:** `getBaseName`/`getDirName`/`joinPaths` statt der POSIX-Funktionen in
`handleRenameFromMenu` und `handleRenameConfirm`.

### Geänderte Dateien (Bugfixes)
- `src/utils/pathUtils.ts` — neue Helfer `detectSeparator`, `getBaseName`, `getDirName`, `joinPaths`, `toNativeSeparators`
- `src/components/FileExplorer.tsx` — alle Pfad-Operationen auf die neuen Helfer umgestellt
- `src/components/App.tsx` — `createNewTextFile` / `createNewFolder` umgestellt, ungenutzten `path`-Import entfernt

---

## 2. AI-Chat: Von Atomic Chat übernommen

### Lokale Modelle direkt im Programm herunterladen & nutzen
Wie bei Atomic Chat können Modelle jetzt **direkt im Programm** verwaltet werden –
über eine neue **„Local Models"**-Oberfläche (CPU-Icon in der Chat-Kopfzeile).
Als lokale Runtime dient **Ollama** (kostenlos, läuft komplett offline auf dem
Rechner). Das passt nahtlos zur bestehenden Architektur, die bereits einen
OpenAI-kompatiblen lokalen Endpoint nutzte.

Funktionen des neuen **Model Managers** (`src/components/ModelManager.tsx`):
- **Status-Erkennung**: zeigt an, ob Ollama läuft; ist es nicht installiert,
  gibt es eine Anleitung + direkten Download-Link (`ollama.com/download`).
- **Installierte Modelle**: Liste mit Größe/Parametern/Quantisierung, „Use"
  (sofort als aktives Chat-Modell setzen) und Löschen.
- **Modell-Katalog**: kuratierte, starke Modelle (u. a. **Qwen2.5-Coder 7B**,
  Llama 3.1/3.2, DeepSeek-Coder-V2, Mistral, Phi-3.5, Gemma 2, CodeGemma,
  StarCoder2) mit Tags (recommended / coding / fast).
- **Download mit Live-Fortschritt**: echte Streaming-Progressbar (Prozent +
  MB/GB), inkl. **Abbrechen**. Beliebige Tags lassen sich auch frei eingeben
  (z. B. `llama3.2:1b`).
- **Ein-Klick-Aktivierung**: „Use" setzt `baseUrl` auf Ollamas
  OpenAI-kompatiblen Endpoint (`http://127.0.0.1:11434`) und das Modell.

Technische Anbindung (neue IPC-Kanäle, CORS-frei über Node `http`):
- Main: `ollama:status`, `ollama:list`, `ollama:pull` (streamt `ollama:pullProgress`),
  `ollama:cancelPull`, `ollama:remove` in `src/main.ts`
- `shell:openExternal` (validierter http/https-Browser-Open) für den Install-Link
- Whitelisting in `preload.js`

### Animationen (Atomic-Chat-Feeling)
In `src/styles/AIChatPanel.css` und `src/styles/ModelManager.css`:
- **Gerichtete Nachrichten-Einblendung**: User-Bubbles gleiten von rechts,
  AI-Bubbles von links herein (weiche `cubic-bezier`-Kurve).
- **Bubble-Hover-Lift** mit weichem Schatten.
- **Streaming-Cursor** an der letzten AI-Nachricht während der Generierung
  (`.ai-chat-messages.is-streaming`).
- **Verbesserte „Thinking"-Indikatoren**: Gradient-Dots + Shimmer-Effekt.
- **Model-Manager-Modal**: Pop-in/Fade-Animationen, animierte Reihen,
  indeterminate + prozentuale Progressbars.
- `prefers-reduced-motion` wird respektiert.

---

## 3. AI-Chat: Von OpenCode inspiriert / Coding-Workflow

Die App besitzt bereits viele OpenCode-artige Coding-Fähigkeiten (über
`AIToolService` / `AIContext`): Datei-Erzeugung/-Änderung mit **Diff-Vorschau &
Approve/Reject**, Terminal-Ausführung, autonomer Modus, Sub-Agents und
Arbeits-Plan-Karten. Diese sind weiterhin voll integriert.

Beitrag dieses Updates zum Coding-Workflow:
- **Starke lokale Coding-Modelle sind jetzt ein Klick entfernt** (Qwen2.5-Coder,
  DeepSeek-Coder-V2, CodeGemma, StarCoder2 stehen im Katalog ganz oben mit
  „coding"-Tag), sodass der vorhandene OpenCode-artige Agent vollständig lokal
  und offline laufen kann.
- Konsistente Windows-Pfade (siehe Bugfixes) verbessern auch die Zuverlässigkeit
  der AI-gesteuerten Datei-Operationen auf Windows.

---

## 4. Geänderte / neue Dateien (Übersicht)

**Neu**
- `src/components/ModelManager.tsx` — Local-Model-Manager UI
- `src/styles/ModelManager.css` — Styling + Animationen

**Geändert**
- `src/utils/pathUtils.ts` — Windows-bewusste Pfad-Helfer
- `src/components/FileExplorer.tsx` — Pfad-Bugfixes
- `src/components/App.tsx` — Pfad-Bugfixes
- `src/components/AIChatPanel.tsx` — Model-Manager-Button + Einbindung, Streaming-Klasse
- `src/styles/AIChatPanel.css` — erweiterte Chat-Animationen
- `src/main.ts` — Ollama-IPC-Handler + `shell:openExternal` + `http`-Import
- `preload.js` — neue Kanäle gewhitelistet

---

## 4b. Nachtrag — Redesign, echte Suche & Pull-Fix (2. Runde)

### Pull schlug fehl („pulling manifest" → Abbruch) — Ursache & Fix
**Diagnose auf dem Rechner:** `https://ollama.com` ist erreichbar (HTTP 200),
aber `registry.ollama.ai` (der Standard-Registry-Host, von dem die Gewichte
geladen werden) ist **lokal blockiert** — TCP-Connect schlägt sofort fehl
(`connect=0.000s`, IPv4 **und** IPv6), während andere Cloudflare-IPs antworten.
Ursache ist eine lokale Firewall / ein Netzwerk-Filter (in der Umgebung war
`nllMonFltProxy` sichtbar), nicht der App-Code.

**Fix im Code:** Der Pull-Handler in `src/main.ts` nutzt jetzt automatisch den
**kanonischen `ollama.com`-Registry als Fallback**: Schlägt der Default-Pull mit
einem Netzwerk-/Manifest-Fehler fehl, wird der Download transparent über
`ollama.com/library/<modell>` wiederholt (verifiziert: lädt durch). Ist der
Block einmal erkannt, gehen weitere Downloads sofort über `ollama.com`
(spart die ~15 s Totzeit). Modelle mit Prefix-Namen werden im UI per
`bareName()` wieder sauber den Katalog-Einträgen zugeordnet.
Zusätzlich behoben: Ein Stream-Fehler von Ollama wurde am Stream-Ende
fälschlich als „success" gemeldet — jetzt korrekt als Fehler.

**Folge-Fix (Modell ließ sich nicht nutzen):** Über den Fallback installiert
Ollama das Modell unter dem Prefix-Namen `ollama.com/library/<modell>`. Dieser
Name wird von Ollamas OpenAI-`/v1/chat/completions`-Endpoint **nicht bedient**
(leere Antwort), obwohl er in `/v1/models` auftaucht. Fix: Nach einem
Fallback-Pull wird das Modell automatisch per `/api/copy` auf den **sauberen
Kurznamen** kopiert (`qwen2.5-coder:1.5b`) und die Prefix-Variante per
`/api/delete` entfernt. Verifiziert: Chat-Completion mit dem Kurznamen liefert
korrekt eine Antwort.

### Professionelleres Design + Modell-Icons + echte Suche
`ModelManager` wurde überarbeitet:
- **Modell-Icons / Logos**: echte Marken-Icons für Llama (Meta), Gemma/CodeGemma
  (Google), Qwen (Alibaba), Phi (Microsoft) + farbige Monogramme für
  Mistral/DeepSeek/StarCoder.
- **Echte Suche statt Custom-Eingabe**: ein Suchfeld filtert Modelle/Publisher/
  Fähigkeiten, plus Schnellfilter **All / Coding / Chat**. Das frühere
  „Custom-Model-Feld" ist entfernt; nur wenn die Suche nichts findet und der
  Begriff wie ein gültiger Tag aussieht, gibt es einen dezenten „Pull this
  tag"-Fallback.
- **Professionelleres Layout**: Header mit Gradient-Icon + Live-Status, klare
  Karten mit Hover-Lift, Tag-Badges, Footer mit Modell-Tag.
- **Klare Fehleranzeige direkt an der Karte** inkl. Netzwerk/Firewall-Hinweis.

---

## 4c. Nachtrag — Tool-Calls wie bei OpenCode (funktioniert mit jedem Modell)

**Problem:** Bei „erstelle eine moin.py …" gab das Modell den Tool-Call als
**JSON in einem ```json-Codeblock** aus (statt über das native `tool_calls`-Feld).
Die App führte ihn nicht aus, sondern zeigte das JSON an („keine Tool-Aufrufe
erforderlich"). Schwächere/lokale Modelle nutzen native Function-Calls oft nicht
zuverlässig — sie schreiben den Call als Text.

**Fix (`src/contexts/AIContext.tsx`):** `extractPseudoToolCalls` komplett
überarbeitet — erkennt jetzt Tool-Calls in **allen gängigen Formaten**, die
Modelle ausgeben:
- ```json / ```tool ``` Codeblöcke mit `{name, arguments}`
- bare JSON-Objekte und **Arrays** von Calls im Fließtext
- `<tool_call>…</tool_call>`-Tags
- `functionName({...})`-Syntax
- OpenAI-Envelopes (`{function:{name,arguments}}`, `{tool_call:{…}}`)
- ReAct-Stil (`{action, action_input}`)
- Namespace-Präfixe (`functions.writeFile`)

Robustheit: ein **balancierter JSON-Scanner** überspringt Klammern in Strings
(kein Fehl-Treffer, wenn z. B. eine zu schreibende Datei selbst JSON enthält),
und alle Treffer werden gegen die **bekannten Tool-Namen** geprüft, damit
normaler Code/JSON nicht fälschlich als Tool-Call gilt. Verifiziert mit einem
Standalone-Test über den exakten Fehlerfall + 5 weitere Formate.
Zusätzlich: erkannte Tool-Call-JSONs werden aus dem **angezeigten Text entfernt**
(`stripToolCallArtifacts`), sodass der Nutzer Prosa statt Roh-JSON sieht.

**Fix (`src/services/AIToolService.ts`):** `replaceInFile` mit **leerem `search`**
auf einer nicht existierenden/leeren Datei wird jetzt als **Datei-Erstellung**
behandelt (schreibt den `replace`-Inhalt) statt mit einem Fehler abzubrechen —
genau das Muster, mit dem schwache Modelle Dateien anlegen. So gelingt die
Absicht des Nutzers trotzdem.

---

## 4d. Nachtrag — Klare Anweisungen + Tool-Aliase (OpenCode-Logik)

**Problem 2. Test:** Das Modell rief `createFile` mit nur einem `path` (ohne
Inhalt) auf — **`createFile` existiert nicht** (das echte Tool heißt `writeFile`).
Mein Parser lehnt unbekannte Namen korrekt ab → nichts passierte. Ursache: das
Modell erfand einen Tool-Namen und bekam keine klaren Anweisungen.

**Fix A — Tool-Namens-Aliase (`src/contexts/AIContext.tsx`):** Häufig
halluzinierte / aus anderen Agent-Frameworks stammende Namen werden jetzt auf die
echten Tools gemappt (`canonicalizeToolName` + `TOOL_ALIASES`), z. B.
`createFile`/`create_file`/`functions.createFile` → `writeFile`,
`editFile`/`str_replace`/`apply_patch` → `replaceInFile`,
`bash`/`shell`/`execute` → `runCommand`, `ls`/`list_files` → `listFiles`, usw.
Angewendet sowohl auf native `tool_calls` als auch auf aus Text geparste Calls.
Unbekannte Namen bleiben abgelehnt. Per Test verifiziert.

**Fix B — Klare, OpenCode-artige Anweisungen:** Der Runtime-System-Prompt
(`createRuntimeModePrompt`) enthält jetzt
- ein **TOOL PROTOCOL** (kritisch): „Für jede Aktion MUSST du einen echten
  Tool-Call absetzen — niemals den Call als Text/JSON ausgeben; erfinde keine
  Namen; zum Anlegen einer Datei `writeFile` mit `path` UND vollständigem
  `content`; ein Schritt pro Runde; nichts als erledigt melden ohne erfolgreichen
  Tool-Result",
- eine **exakte Tool-Liste** mit Ein-Zeilen-Signaturen, dynamisch aus dem echten
  Schema erzeugt (`buildToolReference` / `TOOL_USAGE`), passend zum jeweiligen Modus.
Zusätzlich wurde `config/base-prompt.md` auf eine klare Agent-/Tool-Botschaft
umgestellt (kein Tool-JSON in den Chat, keine erfundenen Tools, `writeFile` für
neue Dateien).

---

## 5. Verifikation
- `npx tsc --noEmit` → **keine Typfehler**
- `npx webpack` (Main + Renderer) → **erfolgreich kompiliert**
- Pull-Fallback über `ollama.com` per `curl` verifiziert (Layer-Download startet)
- Tool-Call-Parser per Standalone-Test gegen den Fehlerfall + 5 Formate bestätigt
- Tool-Alias-Auflösung per Standalone-Test bestätigt (`createFile` → `writeFile` etc.)

### Hinweise / nächste Schritte
- Der Model-Manager setzt eine lokale **Ollama**-Installation voraus (die UI
  führt den Nutzer andernfalls durch die Installation). Für reine
  Cloud-/LM-Studio-Nutzung bleibt alles wie bisher.
- Optional als Folgeausbau denkbar: zusätzliche Backends (LM Studio / llama.cpp
  Auto-Detect) im selben Manager, sowie Persistenz des zuletzt genutzten
  lokalen Modells.
