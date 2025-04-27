import { EventEmitter } from '../utils/EventEmitter';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { GitService } from './GitService';
import { PerformanceService } from './PerformanceService';
import { GitDiff, GitDiffChange, GitStatus } from '../types/GitTypes';

// EditorConfig defines configuration options for the code editor
export interface EditorConfig extends Omit<monaco.editor.IStandaloneEditorConstructionOptions, 'autoSave' | 'cursorSmoothCaretAnimation' | 'hover' | 'parameterHints' | 'quickSuggestions'> {
  formatOnSave?: boolean;       // Whether to format on save
  autoSave?: 'off' | 'afterDelay'; // Auto-save mode
  autoSaveDelay?: number;       // Delay before auto-saving (ms)
  cursorSmoothCaretAnimation?: 'on' | 'off' | 'explicit'; // Caret animation
  hover?: { enabled: boolean }; // Hover tooltip settings
  parameterHints?: { enabled: boolean }; // Parameter hints settings
  quickSuggestions?: { other: boolean; comments: boolean; strings: boolean } | boolean; // Quick suggestions
}

// EditorState represents the state of an editor instance
export interface EditorState {
  id: string;                  // Unique editor ID
  content: string;             // Editor content
  language: string;            // Language mode
  isDirty: boolean;            // Whether the content has unsaved changes
}

// EditorService manages editor instances, state, configuration, and git integration
export class EditorService extends EventEmitter {
  private editors: Map<string, monaco.editor.IStandaloneCodeEditor> = new Map(); // All editor instances
  private states: Map<string, EditorState> = new Map();                          // State for each editor
  private config: EditorConfig;                                                  // Editor configuration
  private gitDiffs: Map<string, GitDiff> = new Map();                            // Git diffs for files
  private activeEditor: string | null = null;                                    // Currently active editor ID
  private disposables: monaco.IDisposable[] = [];                                // Disposables for cleanup
  private gitService: GitService;                                                // Git service instance
  private performanceService: PerformanceService;                                // Performance service instance

  /**
   * Constructor for the EditorService class.
   * @param config Editor configuration options
   * @param gitService Git service instance
   * @param performanceService Performance service instance
   */
  constructor(config: Partial<EditorConfig>, gitService: GitService, performanceService: PerformanceService) {
    super();
    this.config = { ...this.getDefaultConfig(), ...config };
    this.gitService = gitService;
    this.performanceService = performanceService;
    this.initialize();
  }

  // Initialize the editor service
  private initialize(): void {
    this.setupEventListeners();
    this.setupGitIntegration();
  }

  // Set up listeners for editor-related events
  private setupEventListeners(): void {
    this.on('editorCreated', (editorId: string) => {
      this.performanceService.startBackgroundTask('editorCreated');
    });
    this.on('editorClosed', (editorId: string) => {
      this.performanceService.startBackgroundTask('editorClosed');
    });
    this.on('contentChanged', (editorId: string) => {
      this.performanceService.startBackgroundTask('contentChanged');
    });
  }

  // Set up git integration and listen for git status changes
  private setupGitIntegration(): void {
    this.gitService.on('statusChanged', () => {
      this.updateGitDecorations();
    });
  }

  // Get the default editor configuration
  private getDefaultConfig(): EditorConfig {
    return {
      language: 'plaintext',
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      lineHeight: 1.5,
      wordWrap: 'on',
      tabSize: 4,
      formatOnSave: true,
      autoSave: 'afterDelay',
      autoSaveDelay: 1000,
      minimap: {
        enabled: true,
        maxColumn: 120,
        renderCharacters: true,
        showSlider: 'mouseover'
      },
      lineNumbers: 'on',
      renderWhitespace: 'none',
      formatOnType: true,
      formatOnPaste: true,
      folding: true,
      autoClosingBrackets: 'languageDefined',
      autoClosingQuotes: 'languageDefined',
      autoIndent: 'advanced',
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      acceptSuggestionOnCommitCharacter: true,
      snippetSuggestions: 'inline',
      quickSuggestions: { other: true, comments: true, strings: true },
      parameterHints: { enabled: true },
      hover: { enabled: true },
      links: true,
      contextmenu: true,
      multiCursorModifier: 'alt',
      dragAndDrop: true,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      cursorStyle: 'line',
      cursorWidth: 1,
      renderControlCharacters: false,
      renderLineHighlight: 'all',
      scrollBeyondLastLine: true,
      scrollBeyondLastColumn: 5,
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        useShadows: true,
        verticalHasArrows: false,
        horizontalHasArrows: false,
        handleMouseWheel: true,
        horizontalScrollbarSize: 10,
        verticalScrollbarSize: 14,
        verticalSliderSize: 14,
        horizontalSliderSize: 10,
        arrowSize: 11
      },
      glyphMargin: true,
      foldingStrategy: 'auto',
      matchBrackets: 'always',
      wordBasedSuggestions: 'currentDocument',
      suggestSelection: 'first',
      suggest: {
        filterGraceful: true,
        snippetsPreventQuickSuggestions: false,
        localityBonus: true,
        shareSuggestSelections: true,
        showIcons: true
      },
      inlayHints: {
        enabled: 'on'
      },
      guides: {
        bracketPairs: true,
        bracketPairsHorizontal: true,
        highlightActiveBracketPair: true,
        indentation: true
      },
      unicodeHighlight: {
        ambiguousCharacters: true,
        invisibleCharacters: true,
        nonBasicASCII: true
      }
    };
  }

  /**
   * Create a new editor instance.
   * @param container The container element for the editor
   * @param options Editor configuration options
   * @returns The ID of the created editor instance
   */
  public createEditor(container: HTMLElement, options: Partial<EditorConfig> = {}): string {
    const editorId = Math.random().toString(36).substr(2, 9);
    const config = { ...this.config, ...options };

    const editor = monaco.editor.create(container, {
      value: '',
      ...config,
      language: config.language || 'plaintext'
    });

    this.editors.set(editorId, editor);
    this.states.set(editorId, {
      id: editorId,
      content: '',
      language: config.language || 'plaintext',
      isDirty: false
    });

    this.setupEditorListeners(editorId, editor);
    this.emit('editorCreated', editorId);

    return editorId;
  }

  // Set up listeners for a specific editor instance
  private setupEditorListeners(editorId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
    const model = editor.getModel();
    if (!model) return;

    const disposable = model.onDidChangeContent(() => {
      const state = this.states.get(editorId);
      if (state) {
        state.content = model.getValue();
        state.isDirty = true;
        this.emit('contentChanged', editorId);
      }
    });

    this.disposables.push(disposable);
  }

  /**
   * Get an editor instance by its ID.
   * @param editorId The ID of the editor instance
   * @returns The editor instance, or undefined if not found
   */
  public getEditor(editorId: string): monaco.editor.IStandaloneCodeEditor | undefined {
    return this.editors.get(editorId);
  }

  /**
   * Get the currently active editor instance.
   * @returns The active editor instance, or undefined if not found
   */
  public getActiveEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    if (!this.activeEditor) return undefined;
    return this.editors.get(this.activeEditor);
  }

  /**
   * Set the active editor instance.
   * @param editorId The ID of the editor instance to set as active
   */
  public setActiveEditor(editorId: string): void {
    if (this.editors.has(editorId)) {
      this.activeEditor = editorId;
      this.emit('activeEditorChanged', editorId);
    }
  }

  /**
   * Close an editor instance.
   * @param editorId The ID of the editor instance to close
   */
  public closeEditor(editorId: string): void {
    const editor = this.editors.get(editorId);
    if (editor) {
      editor.dispose();
      this.editors.delete(editorId);
      this.states.delete(editorId);
      this.emit('editorClosed', editorId);
    }
  }

  /**
   * Update the editor configuration.
   * @param config The updated configuration options
   */
  public updateConfig(config: Partial<EditorConfig>): void {
    this.config = { ...this.config, ...config };
    this.editors.forEach(editor => {
      editor.updateOptions(config);
    });
    this.emit('configChanged', this.config);
  }

  // Update git decorations for all editors
  private async updateGitDecorations(): Promise<void> {
    const status = await this.gitService.getStatus();
    if (!status) return;

    this.editors.forEach((editor, editorId) => {
      const model = editor.getModel();
      if (!model) return;

      const filePath = model.uri.path;
      const decorations: monaco.editor.IModelDeltaDecoration[] = [];

      if (status.modified.includes(filePath)) {
        decorations.push({
          range: new monaco.Range(1, 1, 1, 1),
          options: {
            isWholeLine: true,
            className: 'git-modified-line',
            glyphMarginClassName: 'git-modified-glyph'
          }
        });
      }

      if (status.staged.includes(filePath)) {
        decorations.push({
          range: new monaco.Range(1, 1, 1, 1),
          options: {
            isWholeLine: true,
            className: 'git-staged-line',
            glyphMarginClassName: 'git-staged-glyph'
          }
        });
      }

      model.deltaDecorations([], decorations);
    });
  }

  /**
   * Dispose of all editor instances and resources.
   */
  public dispose(): void {
    this.editors.forEach(editor => editor.dispose());
    this.editors.clear();
    this.states.clear();
    this.gitDiffs.clear();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.removeAllListeners();
  }

  /**
   * Get the current git status.
   * @returns The current git status
   */
  public async getGitStatus(): Promise<GitStatus> {
    const status = await this.gitService.getStatus();
    return {
      current: status.branch,
      staged: status.staged,
      not_added: status.modified,
      modified: status.modified,
      deleted: status.deleted,
      renamed: [],
      untracked: status.untracked
    };
  }
}