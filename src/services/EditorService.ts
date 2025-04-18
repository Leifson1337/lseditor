import { EventEmitter } from 'events';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { GitService } from './GitService';
import { PerformanceService } from './PerformanceService';
import { GitDiff, GitDiffChange, GitStatus } from '../types/GitTypes';

export interface EditorConfig extends Omit<monaco.editor.IStandaloneEditorConstructionOptions, 'autoSave' | 'cursorSmoothCaretAnimation' | 'hover' | 'parameterHints' | 'quickSuggestions'> {
  formatOnSave?: boolean;
  autoSave?: 'off' | 'afterDelay';
  autoSaveDelay?: number;
  cursorSmoothCaretAnimation?: 'on' | 'off' | 'explicit';
  hover?: { enabled: boolean };
  parameterHints?: { enabled: boolean };
  quickSuggestions?: { other: boolean; comments: boolean; strings: boolean } | boolean;
}

export interface EditorState {
  id: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export class EditorService extends EventEmitter {
  private editors: Map<string, monaco.editor.IStandaloneCodeEditor> = new Map();
  private states: Map<string, EditorState> = new Map();
  private config: EditorConfig;
  private gitDiffs: Map<string, GitDiff> = new Map();
  private activeEditor: string | null = null;
  private disposables: monaco.IDisposable[] = [];
  private gitService: GitService;
  private performanceService: PerformanceService;

  constructor(config: Partial<EditorConfig>, gitService: GitService, performanceService: PerformanceService) {
    super();
    this.config = { ...this.getDefaultConfig(), ...config };
    this.gitService = gitService;
    this.performanceService = performanceService;
    this.initialize();
  }

  private initialize(): void {
    this.setupEventListeners();
    this.setupGitIntegration();
  }

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

  private setupGitIntegration(): void {
    this.gitService.on('statusChanged', () => {
      this.updateGitDecorations();
    });
  }

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

  public getEditor(editorId: string): monaco.editor.IStandaloneCodeEditor | undefined {
    return this.editors.get(editorId);
  }

  public getActiveEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    if (!this.activeEditor) return undefined;
    return this.editors.get(this.activeEditor);
  }

  public setActiveEditor(editorId: string): void {
    if (this.editors.has(editorId)) {
      this.activeEditor = editorId;
      this.emit('activeEditorChanged', editorId);
    }
  }

  public closeEditor(editorId: string): void {
    const editor = this.editors.get(editorId);
    if (editor) {
      editor.dispose();
      this.editors.delete(editorId);
      this.states.delete(editorId);
      this.emit('editorClosed', editorId);
    }
  }

  public updateConfig(config: Partial<EditorConfig>): void {
    this.config = { ...this.config, ...config };
    this.editors.forEach(editor => {
      editor.updateOptions(config);
    });
    this.emit('configChanged', this.config);
  }
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

  public dispose(): void {
    this.editors.forEach(editor => editor.dispose());
    this.editors.clear();
    this.states.clear();
    this.gitDiffs.clear();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.removeAllListeners();
  }

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