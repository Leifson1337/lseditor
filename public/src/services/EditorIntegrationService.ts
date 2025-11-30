import * as fs from 'fs';
import { TerminalService } from './TerminalService';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

// CommandSuggestion represents a suggested command for the user
export interface CommandSuggestion {
  command: string;         // The command string (e.g., 'git status')
  description: string;     // Description of what the command does
  category: string;        // Category of the command (e.g., 'git', 'npm')
}

// EditorIntegrationService provides integration between the editor and terminal/command features
export class EditorIntegrationService {
  private editor: monaco.editor.IStandaloneCodeEditor | null = null; // Monaco editor instance
  private filePath: string | null = null;                            // Currently loaded file path
  private activeSessionId: string | null = null;                     // Current terminal session ID
  private terminal: TerminalService;                                 // Terminal service instance
  private suggestions: CommandSuggestion[] = [];                     // List of command suggestions

  /**
   * Constructor for the EditorIntegrationService class.
   * Initializes the terminal service and command suggestions.
   * @param terminal Terminal service instance
   */
  constructor(terminal: TerminalService) {
    this.terminal = terminal;
    this.initializeSuggestions();
  }

  // Initialize the list of command suggestions
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

  // Set the Monaco editor instance
  public setEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    this.editor = editor;
  }

  // Set the currently loaded file path and optionally load the file
  public setFilePath(path: string | null): void {
    this.filePath = path;
    if (path !== null) {
      this.loadFile(path);
    }
  }

  // Set the active terminal session ID
  public setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  // Show command suggestions in the terminal for the active session
  public showCommandSuggestions(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'ls\n');
  }

  // Show a search dialog in the terminal for the active session
  public showSearchDialog(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'grep -r "" .\n');
  }

  // Show the file explorer in the terminal for the active session
  public showFileExplorer(): void {
    if (!this.activeSessionId) return;
    this.terminal.writeToSession(this.activeSessionId, 'tree\n');
  }

  // Show a context menu at the specified coordinates in the editor
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

    // Create a context menu element
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    // Populate the context menu with items
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

    // Add the context menu to the document body
    document.body.appendChild(contextMenu);

    // Remove the context menu when the user clicks outside of it
    document.addEventListener('click', () => contextMenu.remove(), { once: true });
  }

  // Dispose of the editor instance
  public dispose(): void {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  // Load the contents of a file into the editor
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

  // Filter command suggestions based on the input string
  private filterSuggestions(input: string): CommandSuggestion[] {
    if (!input) return this.suggestions;

    return this.suggestions.filter(suggestion =>
      suggestion.command.toLowerCase().includes(input.toLowerCase()) ||
      suggestion.description.toLowerCase().includes(input.toLowerCase())
    );
  }

  // Add a custom command suggestion
  public addCustomSuggestion(suggestion: CommandSuggestion) {
    this.suggestions.push(suggestion);
  }

  // Get the active session ID
  private getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
}