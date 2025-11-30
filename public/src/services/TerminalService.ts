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

  // Map of all terminal sessions
  private sessions: Map<string, TerminalSession> = new Map();

  // Currently active terminal session
  private activeSession: TerminalSession | null = null;

  // Flag indicating whether the terminal service is initialized
  private isInitialized: boolean = false;

  // Monaco editor instance
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

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
    try {
      await this.terminalManager?.initialize();
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('Failed to initialize Terminal service:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Create a new terminal session.
   * @param config Terminal configuration
   * @returns The new terminal session
   */
  public async createSession(config: TerminalConfig): Promise<TerminalSession> {
    this.checkInitialized();
    try {
      const id = uuidv4();
      const element = document.createElement('div');
      element.className = 'terminal-session';

      // Get the terminal profile and theme
      const profileName = config.profile || 'default';
      const profile = this.terminalManager?.getProfile(profileName);

      if (!profile) {
        throw new Error(`Profile ${profileName} not found`);
      }

      const themeName = config.theme || 'default';
      const theme = this.terminalManager?.getTheme(themeName);

      if (!theme) {
        throw new Error(`Theme ${themeName} not found`);
      }

      // Create a new terminal session
      const session: TerminalSession = {
        id,
        element,
        isActive: false,
        config,
        profile: profile,
        theme: theme,
        status: 'connecting',
        createdAt: new Date(),
        lastActive: new Date()
      };

      // Add the session to the map of sessions
      this.sessions.set(id, session);
      this.emit('sessionCreated', session);
      return session;
    } catch (error) {
      console.error('Failed to create terminal session:', error);
      throw error;
    }
  }

  /**
   * Activate a terminal session by ID.
   * @param id Session ID to activate
   */
  public async activateSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      // Deactivate the current active session
      if (this.activeSession) {
        this.activeSession.isActive = false;
        this.emit('sessionDeactivated', this.activeSession);
      }

      // Activate the session
      session.isActive = true;
      this.activeSession = session;
      this.emit('sessionActivated', session);
    } catch (error) {
      console.error('Failed to activate terminal session:', error);
      throw error;
    }
  }

  /**
   * Deactivate a terminal session by ID.
   * @param id Session ID to deactivate
   */
  public async deactivateSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      // Deactivate the session
      session.isActive = false;
      if (this.activeSession?.id === id) {
        this.activeSession = null;
      }
      this.emit('sessionDeactivated', session);
    } catch (error) {
      console.error('Failed to deactivate terminal session:', error);
      throw error;
    }
  }

  /**
   * Remove a terminal session by ID.
   * @param id Session ID to remove
   */
  public async removeSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      // Deactivate the session if it is active
      if (session.isActive) {
        await this.deactivateSession(id);
      }

      // Remove the session from the map of sessions
      this.sessions.delete(id);
      this.emit('sessionRemoved', session);
    } catch (error) {
      console.error('Failed to remove terminal session:', error);
      throw error;
    }
  }

  /**
   * Get a terminal session by ID.
   * @param id Session ID to get
   * @returns The terminal session or undefined
   */
  public getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get the currently active terminal session.
   * @returns The active terminal session or null
   */
  public getActiveSession(): TerminalSession | null {
    return this.activeSession;
  }

  /**
   * Get all terminal sessions.
   * @returns Array of terminal sessions
   */
  public getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Write to a terminal session by ID.
   * @param id Session ID to write to
   * @param text Text to write
   */
  public async writeToSession(id: string, text: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      // Write to the session
      if (session.ws) {
        session.ws.send(text);
      }
      this.emit('sessionOutput', { session, text });
    } catch (error) {
      console.error('Failed to write to terminal session:', error);
      throw error;
    }
  }

  /**
   * Clear a terminal session by ID.
   * @param id Session ID to clear
   */
  public async clearSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      // Clear the session
      if (session.element) {
        session.element.innerHTML = '';
      }
      this.emit('sessionCleared', session);
    } catch (error) {
      console.error('Failed to clear terminal session:', error);
      throw error;
    }
  }

  /**
   * Get the terminal container element.
   * @returns The terminal container element
   */
  public getElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'terminal-container';
    return container;
  }

  /**
   * Write to the active terminal session.
   * @param text Text to write
   */
  public write(text: string): void {
    if (this.activeSession) {
      this.writeToSession(this.activeSession.id, text);
    }
  }

  /**
   * Write a line to the active terminal session.
   * @param text Text to write
   */
  public writeln(text: string): void {
    this.write(text + '\n');
  }

  /**
   * Clear the active terminal session.
   */
  public clear(): void {
    if (this.activeSession) {
      this.clearSession(this.activeSession.id);
    }
  }

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