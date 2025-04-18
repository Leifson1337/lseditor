import * as fs from 'fs';
import { TerminalService } from './TerminalService';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface CommandSuggestion {
  command: string;
  description: string;
  category: string;
}

export class EditorIntegrationService {
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private filePath: string | null = null;
  private activeSessionId: string | null = null;
  private terminal: TerminalService;
  private suggestions: CommandSuggestion[] = [];

  constructor(terminal: TerminalService) {
    this.terminal = terminal;
    this.initializeSuggestions();
  }

  private initializeSuggestions() {
    this.suggestions = [
      { command: 'git status', description: 'Show working tree status', category: 'git' },
      { command: 'git add .', description: 'Stage all changes', category: 'git' },
      { command: 'git commit -m ""', description: 'Commit staged changes', category: 'git' },
      { command: 'npm install', description: 'Install dependencies', category: 'npm' },
      { command: 'npm start', description: 'Start the application', category: 'npm' },
      { command: 'npm test', description: 'Run tests', category: 'npm' },
      { command: 'cd', description: 'Change directory', category: 'navigation' },
      { command: 'ls', description: 'List directory contents', category: 'navigation' },
      { command: 'mkdir', description: 'Create new directory', category: 'file' },
      { command: 'cp', description: 'Copy files or directories', category: 'file' },
      { command: 'mv', description: 'Move/rename files or directories', category: 'file' }
    ];
  }

  public setEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    this.editor = editor;
  }

  public setFilePath(path: string | null): void {
    this.filePath = path;
    if (path !== null) {
      this.loadFile(path);
    }
  }

  public setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  public showCommandSuggestions(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'ls\n');
  }

  public showSearchDialog(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'grep -r "" .\n');
  }

  public showFileExplorer(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'tree\n');
  }

  public showContextMenu(x: number, y: number): void {
    if (!this.editor) return;

    const menuItems = [
      { label: 'Clear', action: () => this.terminal.clearSession(this.activeSessionId || '') },
      { label: 'Copy', action: () => this.editor?.trigger('keyboard', 'editor.action.clipboardCopyAction', null) },
      { label: 'Paste', action: () => this.editor?.trigger('keyboard', 'editor.action.clipboardPasteAction', null) },
      { type: 'separator' },
      { label: 'Search...', action: () => this.showSearchDialog() },
      { type: 'separator' },
      { label: 'Command Suggestions', action: () => this.showCommandSuggestions() }
    ];

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    menuItems.forEach(item => {
      if (item.type === 'separator') {
        const separator = document.createElement('hr');
        contextMenu.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'menu-item';
        menuItem.textContent = item.label || '';
        menuItem.onclick = () => {
          if (item.action) {
            item.action();
          }
          contextMenu.remove();
        };
        contextMenu.appendChild(menuItem);
      }
    });

    document.body.appendChild(contextMenu);
    document.addEventListener('click', () => contextMenu.remove(), { once: true });
  }

  public dispose(): void {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  private async loadFile(path: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(path, 'utf-8');
      if (this.editor) {
        const model = this.editor.getModel();
        if (model) {
          model.setValue(content);
        }
      }
    } catch (error) {
      console.error('Failed to load file:', error);
    }
  }

  private filterSuggestions(input: string): CommandSuggestion[] {
    if (!input) return this.suggestions;

    return this.suggestions.filter(suggestion =>
      suggestion.command.toLowerCase().includes(input.toLowerCase()) ||
      suggestion.description.toLowerCase().includes(input.toLowerCase())
    );
  }

  public addCustomSuggestion(suggestion: CommandSuggestion) {
    this.suggestions.push(suggestion);
  }

  private getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
} 