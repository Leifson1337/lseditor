import { EventEmitter } from 'events';
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

export class TerminalService extends EventEmitter {
  private static instance: TerminalService;
  private terminalManager: TerminalManager | null;
  private aiService: AIService;
  private projectService: ProjectService;
  private uiService: UIService;
  private terminalServer: TerminalServer;
  private store: ReturnType<typeof useEditorStore>;
  private sessions: Map<string, TerminalSession> = new Map();
  private activeSession: TerminalSession | null = null;
  private isInitialized: boolean = false;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

  constructor(
    terminalManager: TerminalManager | null,
    aiService: AIService,
    projectService: ProjectService,
    uiService: UIService,
    terminalServer: TerminalServer,
    store: ReturnType<typeof useEditorStore>
  ) {
    super();
    this.terminalManager = terminalManager || null;
    this.aiService = aiService;
    this.projectService = projectService;
    this.uiService = uiService;
    this.terminalServer = terminalServer;
    this.store = store;
  }

  public setTerminalManager(manager: TerminalManager): void {
    this.terminalManager = manager;
  }

  public static getInstance(
    terminalManager: TerminalManager | null,
    aiService: AIService,
    projectService: ProjectService,
    uiService: UIService,
    terminalServer: TerminalServer,
    store: ReturnType<typeof useEditorStore>
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

  public async createSession(config: TerminalConfig): Promise<TerminalSession> {
    this.checkInitialized();
    try {
      const id = uuidv4();
      const element = document.createElement('div');
      element.className = 'terminal-session';
      
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

      this.sessions.set(id, session);
      this.emit('sessionCreated', session);
      return session;
    } catch (error) {
      console.error('Failed to create terminal session:', error);
      throw error;
    }
  }

  public async activateSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (this.activeSession) {
        this.activeSession.isActive = false;
        this.emit('sessionDeactivated', this.activeSession);
      }

      session.isActive = true;
      this.activeSession = session;
      this.emit('sessionActivated', session);
    } catch (error) {
      console.error('Failed to activate terminal session:', error);
      throw error;
    }
  }

  public async deactivateSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

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

  public async removeSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.isActive) {
        await this.deactivateSession(id);
      }

      this.sessions.delete(id);
      this.emit('sessionRemoved', session);
    } catch (error) {
      console.error('Failed to remove terminal session:', error);
      throw error;
    }
  }

  public getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  public getActiveSession(): TerminalSession | null {
    return this.activeSession;
  }

  public getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  public async writeToSession(id: string, text: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.ws) {
        session.ws.send(text);
      }
      this.emit('sessionOutput', { session, text });
    } catch (error) {
      console.error('Failed to write to terminal session:', error);
      throw error;
    }
  }

  public async clearSession(id: string): Promise<void> {
    this.checkInitialized();
    try {
      const session = this.sessions.get(id);
      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.element) {
        session.element.innerHTML = '';
      }
      this.emit('sessionCleared', session);
    } catch (error) {
      console.error('Failed to clear terminal session:', error);
      throw error;
    }
  }

  public getElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'terminal-container';
    return container;
  }

  public write(text: string): void {
    if (this.activeSession) {
      this.writeToSession(this.activeSession.id, text);
    }
  }

  public writeln(text: string): void {
    this.write(text + '\n');
  }

  public clear(): void {
    if (this.activeSession) {
      this.clearSession(this.activeSession.id);
    }
  }

  public selectAll(): void {
    if (this.editor) {
      const model = this.editor.getModel();
      if (model) {
        this.editor.setSelection(model.getFullModelRange());
      }
    }
  }

  public getCurrentInput(): string {
    if (this.editor) {
      const model = this.editor.getModel();
      if (model) {
        return model.getValue();
      }
    }
    return '';
  }

  public search(query: string): void {
    if (this.editor) {
      this.editor.getAction('actions.find')?.run();
    }
  }

  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Terminal service not initialized');
    }
  }

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