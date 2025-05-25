import { EventEmitter } from '../utils/EventEmitter';
import * as path from 'path';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { v4 as uuidv4 } from 'uuid';
import { AIService } from './AIService';
import { ProjectService } from './ProjectService';
import { TerminalManager } from './TerminalManager';
import { UIService } from './UIService';
import { TerminalServer } from '../server/terminalServer';
import { useEditorStore } from '../store/editorStore';
import { TerminalConfig, TerminalSession, TerminalProfile, TerminalTheme } from '../types/terminal';
import { Position } from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * TerminalService manages terminal sessions and communication with the terminal backend.
 * It provides methods for creating, activating, deactivating, and removing terminal sessions.
 * It also handles writing to and clearing terminal sessions.
 */
export class TerminalService extends EventEmitter {
  // Singleton instance of the TerminalService
  private static instance: TerminalService;

  // Terminal manager instance
  private terminalManager: TerminalManager | null;

  // AI service instance
  private aiService: AIService;

  // Project service instance
  private projectService: ProjectService | undefined;

  // UI service instance
  private uiService: UIService | undefined;

  // Terminal server instance
  private terminalServer: TerminalServer | undefined;

  // Editor store instance
  private store: ReturnType<typeof useEditorStore> | undefined;

  // Map of all terminal sessions - REMOVED, will use TerminalManager's
  // private sessions: Map<string, TerminalSession> = new Map();

  // Currently active terminal session - REMOVED, will use TerminalManager's
  // private activeSession: TerminalSession | null = null;

  // Flag indicating whether the terminal service is initialized
  private isInitialized: boolean = false; // Still useful for TerminalService's own setup

  // Monaco editor instance - This seems unrelated to terminal core logic, might belong elsewhere or be passed in.
  // For now, keeping it if methods like selectAll, getCurrentInput, search are truly TerminalService's domain.
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;


  // DOM element for the XTerm instance, managed by the UI component (TerminalPanel)
  // This is set by the UI component that hosts the terminal.
  private terminalElement: HTMLElement | null = null;


  /**
   * Constructor for the TerminalService.
   * @param terminalManager Terminal manager instance
   * @param aiService AI service instance
   * @param projectService Project service instance
   * @param uiService UI service instance
   * @param terminalServer Terminal server instance
   * @param store Editor store instance
   */
  constructor(
    terminalManager: TerminalManager | null,
    aiService: AIService,
    projectService?: ProjectService,
    uiService?: UIService,
    terminalServer?: TerminalServer,
    store?: ReturnType<typeof useEditorStore>
  ) {
    super();
    // Ensure terminalManager is always provided, or throw error if critical.
    // For now, allowing null but checkInitialized should prevent usage if null.
    this.terminalManager = terminalManager || null; 
    this.aiService = aiService;
    this.projectService = projectService;
    this.uiService = uiService;
    this.terminalServer = terminalServer;
    this.store = store;
  }

  /**
   * Set the terminal manager instance.
   * @param manager Terminal manager instance
   */
  public setTerminalManager(manager: TerminalManager): void {
    this.terminalManager = manager;
  }

  /**
   * Get the singleton instance of the TerminalService.
   * @param terminalManager Terminal manager instance
   * @param aiService AI service instance
   * @param projectService Project service instance
   * @param uiService UI service instance
   * @param terminalServer Terminal server instance
   * @param store Editor store instance
   * @returns The singleton instance of the TerminalService
   */
  public static getInstance(
    terminalManager: TerminalManager | null,
    aiService: AIService,
    projectService?: ProjectService,
    uiService?: UIService,
    terminalServer?: TerminalServer,
    store?: ReturnType<typeof useEditorStore>
  ): TerminalService {
    if (!TerminalService.instance) {
      TerminalService.instance = new TerminalService(
        terminalManager,
        aiService,
        projectService,
        uiService,
        terminalServer,
        store
      );
    }
    return TerminalService.instance;
  }

  /**
   * Initialize the terminal service.
   * This method must be called before using the terminal service.
   */
  public async initialize(): Promise<void> {
    if (!this.terminalManager) {
      throw new Error("TerminalManager not provided to TerminalService.");
    }
    try {
      // TerminalManager should initialize its own dependencies (like TerminalServer)
      if (!this.terminalManager.isInitialized) { // Assuming isInitialized property exists
          await this.terminalManager.initialize();
      }
      this.isInitialized = true;
      this.emit('initialized');
      console.log('TerminalService initialized and linked with TerminalManager.');
    } catch (error) {
      console.error('Failed to initialize TerminalService:', error);
      this.emit('error', error);
      throw error;
    }
  }

  // --- Session Management (Delegated to TerminalManager) ---

  public async createSession(config: TerminalConfig): Promise<TerminalSession> {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    // TerminalManager.createSession now returns a TerminalSession that includes the XTerm instance
    const session = await this.terminalManager.createSession(config);
    // TerminalService no longer directly manages the DOM element for the session.
    // This will be handled by TerminalPanel using getSessionXTerm.
    this.emit('sessionCreated', session); // Forward event
    return session;
  }

  public async activateSession(id: string): Promise<void> {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    this.terminalManager.activateSession(id);
    // UI layer (TerminalPanel) will be responsible for showing the correct XTerm instance.
    // TerminalService can emit an event that UI can listen to.
    this.emit('sessionActivated', this.terminalManager.getSession(id)); // Forward event
  }

  // Deactivate is primarily an internal TerminalManager concept if needed.
  // UI will just switch active tabs.
  // public async deactivateSession(id: string): Promise<void> { ... }

  public async removeSession(id: string): Promise<void> {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    this.terminalManager.removeSession(id);
    this.emit('sessionRemoved', { id }); // Forward event
  }

  public getSession(id: string): TerminalSession | undefined {
    this.checkInitialized();
    return this.terminalManager?.getSession(id);
  }

  public getActiveSession(): TerminalSession | null {
    this.checkInitialized();
    return this.terminalManager?.getActiveSession() || null;
  }

  public getAllSessions(): TerminalSession[] {
    this.checkInitialized();
    return this.terminalManager?.getAllSessions() || [];
  }

  // --- Terminal I/O (Delegated) ---

  public async writeToSession(id: string, data: string): Promise<void> {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    await this.terminalManager.writeToSession(id, data);
    // No direct event emission here; data flow is PTY -> XTerm (handled by Manager)
  }

  public async clearSession(id: string): Promise<void> {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    const xterm = this.terminalManager.getSessionXTerm(id);
    if (xterm) {
      xterm.clear();
      this.emit('sessionCleared', { id }); // Forward event
    } else {
      console.warn(`XTerm instance not found for session ${id} to clear.`);
    }
  }
  
  /**
   * Attaches an XTerm.js instance (managed by TerminalManager) to a DOM element.
   * This method is called by the UI layer (e.g., TerminalPanel).
   * @param sessionId The ID of the session whose XTerm instance should be attached.
   * @param element The HTMLElement to attach the XTerm instance to.
   */
  public attachXTermToElement(sessionId: string, element: HTMLElement): void {
    this.checkInitialized();
    if (!this.terminalManager) throw new Error("TerminalManager not available.");
    const xterm = this.terminalManager.getSessionXTerm(sessionId);
    if (xterm && element) {
      // Clear previous children from element to prevent multiple terminals in one container
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
      xterm.open(element);
      // TODO: Consider FitAddon usage here if XTerm instances have it.
      // Example: if (xterm.fitAddon) xterm.fitAddon.fit();
      // For now, assuming TerminalPanel might call fit if needed.
    } else {
      console.warn(`XTerm instance for session ${sessionId} or element not available for attachment.`);
    }
  }
  
  public detachXTermFromElement(sessionId: string): void {
     this.checkInitialized();
     if (!this.terminalManager) throw new Error("TerminalManager not available.");
     const xterm = this.terminalManager.getSessionXTerm(sessionId);
     if (xterm && xterm.element && xterm.element.parentElement) {
         // xterm.dispose(); // Disposing the xterm instance might be too much if just detaching.
         // If the goal is to simply remove it from DOM for reuse, this is more complex.
         // For now, let's assume "detach" means the UI is no longer showing it,
         // but the xterm instance itself is still managed by TerminalManager.
         // The physical removal from DOM would be handled by the UI component managing 'element'.
         console.log(`XTerm for session ${sessionId} detached (conceptually). DOM managed by UI.`);
     }
  }


  public getTerminalManager(): TerminalManager | null {
    return this.terminalManager;
  }
  
  // --- UI specific methods (like write, writeln, clear for active session) ---
  public write(data: string): void {
    const active = this.getActiveSession();
    if (active) {
      this.writeToSession(active.id, data);
    } else {
      console.warn("No active terminal session to write to.");
    }
  }

  public writeln(text: string): void {
    this.write(text + '\\r\\n'); // Use \r\n for terminal newlines typically
  }

  public clear(): void {
    const active = this.getActiveSession();
    if (active) {
      this.clearSession(active.id);
    } else {
      console.warn("No active terminal session to clear.");
    }
  }
  
  // --- Editor related methods - consider if they belong here or in EditorService ---
  /**
   * Select all text in the Monaco editor.
   */
  public selectAll(): void {
    if (this.editor) {
      const model = this.editor.getModel();
      if (model) {
        this.editor.setSelection(model.getFullModelRange());
      }
    }
  }

  /**
   * Get the current input in the Monaco editor.
   * @returns The current input
   */
  public getCurrentInput(): string {
    if (this.editor) {
      const model = this.editor.getModel();
      if (model) {
        return model.getValue();
      }
    }
    return '';
  }

  /**
   * Search for text in the Monaco editor.
   * @param query Search query
   */
  public search(query: string): void {
    if (this.editor) {
      this.editor.getAction('actions.find')?.run();
    }
  }

  /**
   * Check if the terminal service is initialized.
   * @throws Error if the terminal service is not initialized
   */
  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Terminal service not initialized');
    }
  }

  /**
   * Dispose of the terminal service.
   * This method should be called when the terminal service is no longer needed.
   */
  public dispose(): void {
    this.removeAllListeners();
    this.sessions.clear();
    this.activeSession = null;
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }
}