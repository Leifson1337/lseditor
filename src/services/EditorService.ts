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

// Monaco Uri type
type MonacoUri = monaco.Uri;

// Define the structure for an open tab
export interface OpenTab {
  id: string;
  filePath: string;
  title: string;
  language: string;
  isDirty: boolean;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState | null; // Allow null
}

// EditorConfig remains largely the same, adjust if needed
export interface EditorConfig extends Omit<monaco.editor.IStandaloneEditorConstructionOptions, 'model'> { // Omit 'model' as it's per-tab
  formatOnSave?: boolean;
  autoSave?: 'off' | 'afterDelay';
  autoSaveDelay?: number;
}


// EditorService manages editor instances, state, configuration, and git integration
export class EditorService extends EventEmitter {
  // Removed: private editors: Map<string, monaco.editor.IStandaloneCodeEditor> = new Map();
  // Removed: private states: Map<string, EditorState> = new Map();
  private openTabs: OpenTab[] = [];
  private activeTabId: string | null = null;
  private primaryEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  private modelListeners: Map<string, monaco.IDisposable> = new Map();

  private config: EditorConfig;
  private gitDiffs: Map<string, GitDiff> = new Map(); // Retained if used for diffing features
  // Removed: private activeEditor: string | null = null; // Replaced by activeTabId
  private disposables: monaco.IDisposable[] = []; // Retained for general disposables

  private projectService: ProjectService; // Added
  private gitService: GitService;
  private performanceService: PerformanceService;

  /**
   * Constructor for the EditorService class.
   * @param config Editor configuration options
   * @param projectService Project service instance for file operations
   * @param gitService Git service instance
   * @param performanceService Performance service instance
   */
  constructor(
    config: Partial<EditorConfig>,
    projectService: ProjectService, // Added
    gitService: GitService,
    performanceService: PerformanceService
  ) {
    super();
    this.config = { ...this.getDefaultConfig(), ...config };
    this.projectService = projectService; // Added
    this.gitService = gitService;
    this.performanceService = performanceService;
    // Removed: this.initialize(); // Initialization of primary editor is now explicit via createPrimaryEditor
    // Basic setup can still happen here if needed, e.g. event listeners not tied to editor instance
    this.setupGeneralEventListeners(); // Renamed for clarity
    this.setupGitIntegration(); // If git integration is general and not editor-specific
  }

  // Initialize the editor service - now more for general setup
  private setupGeneralEventListeners(): void { // Renamed from initialize and setupEventListeners
    // Example: if you had general service events not tied to a specific editor instance
    // this.on('someServiceEvent', () => { /* handle */ });
    // Performance related events for service actions can remain if applicable
    this.on('fileOpened', (filePath: string) => { // Example new event
        this.performanceService.recordEvent('fileOpened', {filePath});
    });
  }

  // Set up git integration and listen for git status changes
  private setupGitIntegration(): void {
    // This might need to be adapted if decorations are applied to specific models/tabs
    // For now, assuming it might trigger a general refresh or is handled per model later.
    if (this.gitService) {
        this.gitService.on('statusChanged', () => {
            // This would now need to iterate openTabs and update decorations on their models
            this.updateAllOpenTabDecorations();
        });
    }
  }
  
  private async updateAllOpenTabDecorations(): Promise<void> {
    // Placeholder for logic to update decorations on all open tabs
    // This would involve getting status from gitService and iterating this.openTabs
    // For each tab, get its model and apply decorations.
  }

  /**
   * Creates the single primary editor instance.
   * This should be called by the UI layer (e.g., EditorLayout) once the container is available.
   */
  public createPrimaryEditor(container: HTMLElement, options?: Partial<EditorConfig>): void {
    if (this.primaryEditor) {
      console.warn("Primary editor already created.");
      // Optionally re-configure or focus
      return;
    }
    const editorOptions = { ...this.config, ...options, model: null }; // Start with no model
    this.primaryEditor = monaco.editor.create(container, editorOptions);
    this.emit('primaryEditorCreated', this.primaryEditor);

    // If there's an active tab, set its model
    if (this.activeTabId) {
      const activeTab = this.openTabs.find(t => t.id === this.activeTabId);
      if (activeTab) {
        this.primaryEditor.setModel(activeTab.model);
        this.primaryEditor.restoreViewState(activeTab.viewState || null);
      }
    }
  }

  public getPrimaryEditor(): monaco.editor.IStandaloneCodeEditor | null {
    return this.primaryEditor;
  }
  
  private getLanguageFromPath(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    // Basic language detection, can be expanded
    switch (extension) {
        case 'js': return 'javascript';
        case 'ts': return 'typescript';
        case 'json': return 'json';
        case 'css': return 'css';
        case 'html': return 'html';
        case 'md': return 'markdown';
        default: return 'plaintext';
    }
  }

  public async openFile(filePath: string): Promise<string> {
    this.performanceService.startBackgroundTask('openFile');
    let tab = this.openTabs.find(t => t.filePath === filePath);

    if (tab) {
      this.setActiveTabById(tab.id);
      this.performanceService.endBackgroundTask('openFile');
      return tab.id;
    }

    try {
      const content = await this.projectService.getFileContent(filePath);
      const language = this.getLanguageFromPath(filePath); // Helper to determine language
      const model = monaco.editor.createModel(content, language, monaco.Uri.file(filePath));
      
      const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const title = filePath.split(/[\\/]/).pop() || filePath;

      tab = {
        id: tabId,
        filePath,
        title,
        language,
        isDirty: false,
        model,
        viewState: null,
      };
      this.openTabs.push(tab);

      const listener = model.onDidChangeContent(() => {
        const currentTab = this.openTabs.find(t => t.id === tabId);
        if (currentTab && !currentTab.isDirty) {
          currentTab.isDirty = true;
          this.emit('tabDirtyStateChanged', { tabId: currentTab.id, isDirty: true });
          this.emit('tabsChanged', this.getOpenTabsSummary()); // Also emit general tabs changed
        }
        // Also emit that content has changed for this specific tab/model
        if (currentTab) {
            this.emit('modelContentChanged', { tabId: currentTab.id, newContent: currentTab.model.getValue() });
        }
      });
      this.modelListeners.set(tabId, listener);

      this.setActiveTabById(tabId); // This will also emit tabsChanged and activeTabChanged
      
      this.performanceService.endBackgroundTask('openFile');
      this.emit('fileOpened', filePath); // Emit general fileOpened event
      return tabId;
    } catch (error) {
      console.error(`Error opening file ${filePath}:`, error);
      this.emit('error', `Failed to open file: ${filePath}`);
      this.performanceService.endBackgroundTask('openFile', false);
      throw error;
    }
  }

  /**
   * Opens a new tab with the given content, typically for new or unsaved files.
   * The filePath provided is a hint for saving and language detection, but the content isn't read from disk.
   */
  public async openFileWithContent(filePath: string, content: string, language?: string): Promise<string | null> {
    this.performanceService.startBackgroundTask('openFileWithContent');
    let tab = this.openTabs.find(t => t.filePath === filePath && !t.isDirty); // Avoid opening if already open and clean with same path

    if (tab) {
      // If a clean tab with the same path exists, maybe it's better to create a new "Untitled" one
      // or simply activate and overwrite content? For now, let's activate and overwrite.
      this.setActiveTabById(tab.id);
      if (tab.model) {
        tab.model.setValue(content); // This will trigger onDidChangeContent
        if (!tab.isDirty) { // If it wasn't dirty, setValue makes it dirty.
            tab.isDirty = true;
            this.emit('tabDirtyStateChanged', { tabId: tab.id, isDirty: true });
            this.emit('tabsChanged', this.getOpenTabsSummary());
        }
      }
      this.performanceService.endBackgroundTask('openFileWithContent');
      return tab.id;
    }

    try {
      const effectiveLanguage = language || this.getLanguageFromPath(filePath);
      const model = monaco.editor.createModel(content, effectiveLanguage, monaco.Uri.file(filePath));
      
      const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const title = filePath.split(/[\\/]/).pop() || `Untitled-${this.openTabs.length + 1}`;

      tab = {
        id: tabId,
        filePath, // This filePath might be a suggested path for a new file
        title,
        language: effectiveLanguage,
        isDirty: true, // New content is considered dirty until saved
        model,
        viewState: null,
      };
      this.openTabs.push(tab);

      const listener = model.onDidChangeContent(() => {
        const currentTab = this.openTabs.find(t => t.id === tabId);
        // The handleModelContentChange method in EditorService will be called by EditorLayout
        // This listener is primarily for internal state management if needed,
        // but the main isDirty logic is now in handleModelContentChange.
        if (currentTab) {
            this.handleModelContentChange(currentTab.id);
        }
      });
      this.modelListeners.set(tabId, listener);

      this.setActiveTabById(tabId);
      
      this.performanceService.endBackgroundTask('openFileWithContent');
      this.emit('fileOpened', filePath); // Or a different event like 'newTabWithContentOpened'
      return tabId;
    } catch (error) {
      console.error(`Error opening file with content for ${filePath}:`, error);
      this.emit('error', `Failed to open file with content: ${filePath}`);
      this.performanceService.endBackgroundTask('openFileWithContent', false);
      return null;
    }
  }
  
  public setActiveTabById(tabId: string | null): void {
    const currentActiveTab = this.getActiveTab();
    if (currentActiveTab && this.primaryEditor) {
      currentActiveTab.viewState = this.primaryEditor.saveViewState();
    }
    
    this.activeTabId = tabId;
    const newActiveTab = this.getActiveTab();

    if (this.primaryEditor && newActiveTab) {
      this.primaryEditor.setModel(newActiveTab.model);
      if (newActiveTab.viewState) {
        this.primaryEditor.restoreViewState(newActiveTab.viewState);
      }
      this.primaryEditor.focus();
    } else if (this.primaryEditor && !newActiveTab) {
      this.primaryEditor.setModel(null); // No active tab, clear editor
    }

    this.emit('activeTabChanged', { 
      activeTabId: this.activeTabId, 
      activeTabContent: newActiveTab?.model.getValue(), // Content of the new active tab
      activeTabPath: newActiveTab?.filePath,
      activeTabLanguage: newActiveTab?.language
    });
    this.emit('tabsChanged', this.getOpenTabsSummary());
  }

  public getActiveTab(): OpenTab | null {
    if (!this.activeTabId) return null;
    return this.openTabs.find(t => t.id === this.activeTabId) || null;
  }

  public getOpenTabsSummary(): Array<{ id: string; title: string; filePath: string; isDirty: boolean }> {
    return this.openTabs.map(t => ({
      id: t.id,
      title: t.title,
      filePath: t.filePath,
      isDirty: t.isDirty,
    }));
  }

  public closeTab(tabId: string): void {
    const tabIndex = this.openTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const closingTab = this.openTabs[tabIndex];
    closingTab.model.dispose(); // Dispose Monaco model
    
    const listener = this.modelListeners.get(tabId);
    if (listener) {
        listener.dispose();
        this.modelListeners.delete(tabId);
    }

    this.openTabs.splice(tabIndex, 1);
    this.emit('tabsChanged', this.getOpenTabsSummary());

    if (this.activeTabId === tabId) {
      if (this.primaryEditor) {
        this.primaryEditor.setModel(null); // Clear model from editor
      }
      // Activate the previous tab, or the first tab if the closed one was first, or null if no tabs left
      const newActiveTabIndex = this.openTabs.length > 0 
                               ? Math.max(0, tabIndex -1) // Prefer previous tab
                               : -1; // No tabs left
      const newActiveTabId = newActiveTabIndex !== -1 ? this.openTabs[newActiveTabIndex].id : null;
      this.setActiveTabById(newActiveTabId); // This will also emit activeTabChanged
    }
  }

  public async saveActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return; // No active tab to save
    
    // Check if the file exists on disk. If not, or if it's dirty, save.
    // This requires ProjectService to have a method like fileExists.
    // For now, let's assume we save if dirty, or if path suggests it's a new file (e.g. no real path yet)
    // A robust check would involve this.projectService.fileExists(tab.filePath)
    // if (!tab.isDirty && await this.projectService.fileExists(tab.filePath)) {
    //    console.log("File is not dirty and exists, no action taken.");
    //    return;
    // }
    if (!tab.isDirty) { // Simplified: only save if dirty. New files are marked dirty by openFile or content change.
        console.log("File is not dirty, no save action taken.");
        return;
    }


    this.performanceService.startBackgroundTask('saveFile');
    try {
      const content = tab.model.getValue();
      await this.projectService.saveFile(tab.filePath, content);
      tab.isDirty = false;
      this.emit('tabDirtyStateChanged', { tabId: tab.id, isDirty: false });
      this.emit('tabsChanged', this.getOpenTabsSummary()); // Reflect dirty state change
      this.emit('fileSaved', { filePath: tab.filePath, tabId: tab.id });
      this.performanceService.endBackgroundTask('saveFile');
    } catch (error) {
      console.error(`Error saving file ${tab.filePath}:`, error);
      this.emit('error', `Failed to save file: ${tab.filePath}`);
      this.performanceService.endBackgroundTask('saveFile', false);
      throw error;
    }
  }
  
  /**
   * This method is called when the content of a model associated with a tab changes.
   * It's typically triggered by the onDidChangeContent listener for that model.
   */
  public handleModelContentChange(tabId: string): void {
    const tab = this.openTabs.find(t => t.id === tabId);
    if (tab) {
      if (!tab.isDirty) { 
        tab.isDirty = true;
        this.emit('tabDirtyStateChanged', { tabId: tab.id, isDirty: true });
        this.emit('tabsChanged', this.getOpenTabsSummary());
      }
      // Emit an event with the new content for any subscribers that need the raw content
      this.emit('modelContentChanged', { tabId: tab.id, newContent: tab.model.getValue() });
    }
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

    // this.editors.set(editorId, editor); // Removed
    // this.states.set(editorId, { // Removed
    //   id: editorId,
    //   content: '',
    //   language: config.language || 'plaintext',
    //   isDirty: false
    // });

    // this.setupEditorListeners(editorId, editor); // Model listeners are per-tab now
    this.emit('editorCreated', editorId); // This event might need to be re-evaluated

    return editorId; // This ID is less relevant now, primaryEditor is the focus
  }

  // Set up listeners for a specific editor instance - REPLACED by model listeners per tab
  // private setupEditorListeners(editorId: string, editor: monaco.editor.IStandaloneCodeEditor): void {
  //   const model = editor.getModel();
  //   if (!model) return;
  //
  //   const disposable = model.onDidChangeContent(() => {
  //     const state = this.states.get(editorId); // Old state logic
  //     if (state) {
  //       state.content = model.getValue();
  //       state.isDirty = true;
  //       this.emit('contentChanged', editorId); // Old event
  //     }
  //   });
  //
  //   this.disposables.push(disposable);
  // }

  /**
   * Get an editor instance by its ID. - DEPRECATED in favor of getPrimaryEditor()
   * @param editorId The ID of the editor instance
   * @returns The editor instance, or undefined if not found
   */
  // public getEditor(editorId: string): monaco.editor.IStandaloneCodeEditor | undefined {
  //   // return this.editors.get(editorId); // Removed
  //   if (this.primaryEditor && editorId === "primary") return this.primaryEditor; // Example
  //   return undefined;
  // }

  /**
   * Get the currently active editor instance. - REPLACED by getPrimaryEditor() and getActiveTab()
   * @returns The active editor instance, or undefined if not found
   */
  // public getActiveEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
  //   // if (!this.activeEditor) return undefined; // Removed
  //   // return this.editors.get(this.activeEditor); // Removed
  //   return this.primaryEditor;
  // }

  /**
   * Set the active editor instance. - REPLACED by setActiveTabById(tabId)
   * @param editorId The ID of the editor instance to set as active
   */
  // public setActiveEditor(editorId: string): void {
  //   // if (this.editors.has(editorId)) { // Removed
  //   //   this.activeEditor = editorId; // Removed
  //   //   this.emit('activeEditorChanged', editorId); // Old event
  //   // }
  // }

  /**
   * Close an editor instance. - REPLACED by closeTab(tabId)
   * @param editorId The ID of the editor instance to close
   */
  // public closeEditor(editorId: string): void {
  //   // const editor = this.editors.get(editorId); // Removed
  //   // if (editor) { // Removed
  //   //   editor.dispose(); // Removed
  //   //   this.editors.delete(editorId); // Removed
  //   //   this.states.delete(editorId); // Removed
  //   //   this.emit('editorClosed', editorId); // Old event
  //   // }
  // }

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
  private async updateGitDecorations(): Promise<void> { // Renamed to avoid conflict
    // Logic to be updated for single editor, multiple models
    const status = await this.gitService.getStatus();
    if (!status || !this.primaryEditor) return;

    this.openTabs.forEach(tab => {
        const model = tab.model;
        if (!model) return;

        const filePath = tab.filePath; // Assuming tab.filePath is the correct path for git status
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];

        // Example: if file is modified
        if (status.modified.includes(filePath)) {
            // Add decoration logic here
        }
        // Example: if file is staged
        if (status.staged.includes(filePath)) {
            // Add decoration logic here
        }
        // Apply decorations to the model
        // model.deltaDecorations([], decorations); // This might need to be model specific
        // If model is active in primaryEditor, then:
        if (this.primaryEditor.getModel() === model) {
            this.primaryEditor.deltaDecorations([], decorations); // Or use model.deltaDecorations
        } else {
            // If model not active, store decorations and apply when model becomes active?
            // Or, Monaco might handle this if decorations are set on the model directly.
            // model.deltaDecorations([], decorations); // Prefer setting on model
        }
    });
  }


  /**
   * Dispose of all editor instances and resources.
   */
  public dispose(): void {
    this.primaryEditor?.dispose();
    this.openTabs.forEach(tab => {
      tab.model.dispose(); // Dispose each model
      const listener = this.modelListeners.get(tab.id);
      if (listener) {
        listener.dispose(); // Dispose its content change listener
      }
    });
    this.modelListeners.clear();
    this.openTabs = [];
    this.activeTabId = null;
    this.primaryEditor = null; // Ensure primary editor reference is also cleared

    this.gitDiffs.clear(); 
    this.disposables.forEach(d => d.dispose()); // This should include completion provider disposables
    this.disposables = [];
    this.removeAllListeners();
    console.log("EditorService disposed");
  }

  /**
   * Registers a completion item provider for a given language.
   * @param languageId The language ID (e.g., 'typescript', 'javascript').
   * @param provider The completion item provider.
   * @returns An IDisposable that can be used to unregister the provider.
   */
  public registerCompletionProvider(
    languageId: string, 
    provider: monaco.languages.CompletionItemProvider
  ): monaco.IDisposable {
    const disposable = monaco.languages.registerCompletionItemProvider(languageId, provider);
    this.disposables.push(disposable); // Store for later disposal
    this.emit('completionProviderRegistered', { languageId });
    console.log(`Completion provider registered for language: ${languageId}`);
    return {
      dispose: () => {
        const index = this.disposables.indexOf(disposable);
        if (index > -1) {
          this.disposables.splice(index, 1);
        }
        disposable.dispose();
        this.emit('completionProviderUnregistered', { languageId });
        console.log(`Completion provider unregistered for language: ${languageId}`);
      }
    };
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