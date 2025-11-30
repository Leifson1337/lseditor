# Contributing to lseditor

Vielen Dank für dein Interesse an einem Beitrag zu diesem Projekt! Mit deiner Hilfe können wir lseditor weiter verbessern. Bitte beachte die folgenden Richtlinien, um einen reibungslosen Ablauf zu gewährleisten.

## Projektüberblick
lseditor ist ein auf TypeScript und React basierender Editor mit umfangreichen Komponenten, Services und einer modernen UI. Die Entwicklung erfolgt modular und testgetrieben.

## Voraussetzungen
- Node.js (empfohlen: aktuelle LTS-Version)
- npm (wird mit Node.js installiert)
- Optional: ein Editor wie VSCode oder PyCharm

## Setup
1. Repository klonen:
   ```bash
   git clone https://github.com/Leifson1337/lseditor.git
   cd lseditor
   ```
2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
3. Entwicklungsserver starten:
   ```bash
   npm start
   ```
## Coding Style
- TypeScript und React (Functional Components)
- ESLint wird verwendet (siehe `.eslintrc.json`)
- CSS/SCSS für Styles (siehe `src/styles` und Komponenten-spezifische CSS-Dateien)
- Halte dich an die bestehende Struktur in `src/components`, `src/services`, etc.
- Schreibe sprechende Commits und Kommentare.

## Branching & Pull Requests
- Arbeite auf einem eigenen Branch (z.B. `feature/<feature-name>` oder `bugfix/<issue>`)
- Beschreibe im Pull Request klar, was geändert wurde und warum
- Verlinke relevante Issues
- Stelle sicher, dass der Branch mit `main`/`master` aktuell ist
- Lasse alle Checks (Linting, ggf. Tests) durchlaufen

## Issues & Feature Requests
- Prüfe, ob das Thema schon existiert
- Beschreibe Bug Reports möglichst genau (Schritte, Erwartung, Verhalten, ggf. Screenshots)
- Feature Requests: Beschreibe Motivation und Nutzen

## Testen
- Stelle sicher, dass deine Änderungen keine bestehenden Funktionen brechen
- Falls vorhanden: Füge neue oder angepasste Tests hinzu

## Sonstiges
- Respektiere Code Reviews und Feedback
- Bei Fragen: Stelle sie als Kommentar im Pull Request oder Issue

---

Danke für deinen Beitrag! Gemeinsam machen wir lseditor besser.


# Contributing to lseditor

Thank you for your interest in contributing to this project! With your help we can continue to improve lseditor. Please follow the guidelines below to ensure a smooth process.

## Project overview
lseditor is an editor based on TypeScript and React with extensive components, services and a modern UI. The development is modular and test-driven.

## Requirements
- Node.js (recommended: current LTS version)
- npm (is installed with Node.js)
- Optional: an editor such as VSCode or PyCharm

## Setup
1. Clone repository:
 ```bash
 git clone https://github.com/Leifson1337/lseditor.git
 cd lseditor
 ```
2. Install dependencies:
 ```bash
 npm install
 ```
3. Start the development server:
 ```bash
 npm start
 ```
## Coding Style
- TypeScript and React (Functional Components)
- ESLint is used (see `.eslintrc.json`)
- CSS/SCSS for styles (see `src/styles` and component-specific CSS files)
- Stick to the existing structure in `src/components`, `src/services`, etc.
- Write speaking commits and comments.

## Branching & Pull Requests
- Work on a separate branch (e.g. `feature/<feature-name>` or `bugfix/<issue>`)
- Describe clearly in the pull request what was changed and why
- Link relevant issues
- Make sure that the branch with `main`/`master` is up to date
- Run all checks (linting, tests if necessary) run all checks (linting, tests if necessary)

## Issues & feature requests
- Check whether the issue already exists
- Describe bug reports as precisely as possible (steps, expectation, behavior, screenshots if necessary)
- Feature requests: Describe motivation and benefits

## Testing
- Make sure that your changes do not break any existing functions
- If available: Add new or customized tests

## Other
- Respect code reviews and feedback
- If you have questions: Post them as comments in the pull request or issue

---

Thanks for your contribution! Together we make lseditor better.