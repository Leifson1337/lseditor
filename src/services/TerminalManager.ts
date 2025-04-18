import { EventEmitter } from '../utils/EventEmitter';

// Sichere ipcRenderer-Initialisierung - mit Prozess-Check
let ipcRenderer: any = null;
// Prüfe, ob wir im Renderer-Prozess sind
const isRenderer = typeof window !== 'undefined' && typeof process !== 'undefined' && process.type === 'renderer';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in TerminalManager', e);
}

// Hilfsfunktion für sichere IPC-Aufrufe
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
}

import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { TerminalServer } from '../server/terminalServer';
import { TerminalService } from '../services/TerminalService';
import { v4 as uuidv4 } from 'uuid';
import { TerminalConfig, TerminalSession, TerminalProfile, TerminalTheme, CustomTheme } from '../types/terminal';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { AIService } from '../services/AIService';
import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { store } from '../store/store';

export interface SplitViewConfig {
  orientation: 'horizontal' | 'vertical';
  sizes: number[];
  sessions: string[];
}

export class TerminalManager extends EventEmitter {
  private terminals: Map<string, XTerm> = new Map();
  private profiles: Map<string, TerminalProfile> = new Map();
  private themes: Map<string, TerminalTheme> = new Map();
  private customThemes: Map<string, CustomTheme> = new Map();
  private splitViews: Map<string, SplitViewConfig> = new Map();
  private history: string[] = [];
  private maxHistorySize: number = 1000;
  private terminalServer: TerminalServer;
  private sessions: Map<string, TerminalSession> = new Map();
  private activeSession: TerminalSession | null = null;
  private isInitialized: boolean = false;
  private container: HTMLElement | null = null;
  private ws: any | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: any | null = null;
  private terminalService: TerminalService;
  private aiService: AIService;
  private projectService?: ProjectService;
  private uiService?: UIService;
  private isConnected: boolean = false;

  constructor(
    private initialPort: number,
    terminalService: TerminalService,
    aiService: AIService,
    projectService?: ProjectService,
    uiService?: UIService
  ) {
    super();
    this.terminalService = terminalService;
    this.aiService = aiService;
    this.projectService = projectService;
    this.uiService = uiService;
    this.terminalServer = new TerminalServer(initialPort);
    this.initializeDefaultProfiles();
    this.initializeDefaultThemes();
    this.setupEventListeners();
    this.initialize().catch(error => {
      console.error('Failed to initialize Terminal manager:', error);
      this.emit('error', error);
    });
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Check if we're in a browser environment
      if (typeof document !== 'undefined') {
        this.container = document.createElement('div');
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        document.body.appendChild(this.container);
      } else {
        // We're in the main process, create a mock container
        this.container = null;
        console.log('Terminal UI will be initialized in renderer process');
      }
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('Failed to initialize Terminal manager:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2);
  }

  // Session Management
  public async createSession(options: {
    title?: string;
    cwd?: string;
    profile?: string;
    theme?: string;
    parentId?: string;
    splitDirection?: 'horizontal' | 'vertical';
  }): Promise<TerminalSession> {
    const id = uuidv4();
    const profileName = options.profile || 'default';
    const themeName = options.theme || 'default';
    const profile = this.profiles.get(profileName);
    const theme = this.themes.get(themeName);

    if (!profile) {
      throw new Error(`Profile ${profileName} not found`);
    }

    if (!theme) {
      throw new Error(`Theme ${themeName} not found`);
    }

    const session: TerminalSession = {
      id,
      config: {
        title: options.title,
        cwd: options.cwd || process.cwd(),
        profile: profileName,
        theme: themeName
      },
      profile: {
        ...profile,
        theme: themeName
      },
      theme,
      element: typeof document !== 'undefined' ? document.createElement('div') : null,
      status: 'connecting',
      createdAt: new Date(),
      lastActive: new Date(),
      isActive: false,
      ws: undefined
    };

    this.sessions.set(id, session);
    this.emit('sessionCreated', session);
    return session;
  }

  public removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.isActive) {
      this.deactivateSession(sessionId);
    }

    this.sessions.delete(sessionId);
    this.emit('sessionRemoved', sessionId);
  }

  public activateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (this.activeSession) {
      this.deactivateSession(this.activeSession.id);
    }

    session.isActive = true;
    this.activeSession = session;
    this.emit('sessionActivated', sessionId);
  }

  private deactivateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.isActive) {
      return;
    }

    session.isActive = false;
    this.activeSession = null;
    this.emit('sessionDeactivated', sessionId);
  }

  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getActiveSession(): TerminalSession | null {
    return this.activeSession;
  }

  public getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Terminal manager not initialized');
    }
  }

  // Split View Management
  public async createSplitView(parentId: string, direction: 'horizontal' | 'vertical'): Promise<TerminalSession> {
    const parentSession = this.sessions.get(parentId);
    if (!parentSession) {
      throw new Error(`Parent session ${parentId} not found`);
    }

    const parentProfile = this.profiles.get(parentSession.config.profile || 'default');
    const parentTheme = this.themes.get(parentSession.config.theme || 'default');

    if (!parentProfile || !parentTheme) {
      throw new Error('Parent session has invalid profile or theme');
    }

    return this.createSession({
      parentId,
      splitDirection: direction,
      profile: 'default',
      theme: 'default'
    });
  }

  public getSplitView(id: string): SplitViewConfig | undefined {
    return this.splitViews.get(id);
  }

  public updateSplitView(id: string, config: Partial<SplitViewConfig>): void {
    const currentConfig = this.splitViews.get(id);
    if (currentConfig) {
      const newConfig = { ...currentConfig, ...config };
      this.splitViews.set(id, newConfig);
      this.emit('splitViewUpdated', { id, config: newConfig });
    }
  }

  public removeSplitView(id: string): void {
    const config = this.splitViews.get(id);
    if (config) {
      this.splitViews.delete(id);
      this.emit('splitViewRemoved', id);
    }
  }

  // Profile Management
  private initializeDefaultProfiles(): void {
    const defaultProfile: TerminalProfile = {
      name: 'default',
      command: 'powershell.exe',
      args: ['-NoLogo'],
      env: {},
      cwd: process.cwd(),
      fontSize: 14,
      fontFamily: 'Consolas, monospace',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 1000,
      rightClickBehavior: 'selectWord',
      copyOnSelect: true,
      copyFormat: 'text/plain',
      wordSeparator: ' ()[]{}\'"',
      bellStyle: 'sound',
      allowTransparency: false,
      theme: 'default'
    };
    this.profiles.set('default', defaultProfile);

    this.addProfile({
      name: 'powershell',
      command: 'powershell.exe',
      args: ['-NoLogo'],
      env: {},
      cwd: undefined,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      theme: 'default'
    });

    this.addProfile({
      name: 'git-bash',
      command: process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
      args: ['--login'],
      env: {},
      cwd: undefined,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      cursorStyle: 'block',
      scrollback: 1000,
      theme: 'default'
    });
  }

  public addProfile(profile: TerminalProfile): void {
    this.profiles.set(profile.name, profile);
    this.emit('profileAdded', profile);
  }

  public getProfile(name: string): TerminalProfile | undefined {
    return this.profiles.get(name);
  }

  public getProfiles(): TerminalProfile[] {
    return Array.from(this.profiles.values());
  }

  public removeProfile(name: string): void {
    this.profiles.delete(name);
    this.emit('profileRemoved', name);
  }

  // Theme Management
  private initializeDefaultThemes(): void {
    const defaultTheme: TerminalTheme = {
      name: 'default',
      background: '#1E1E1E',
      foreground: '#D4D4D4',
      cursor: '#FFFFFF',
      selection: '#264F78',
      black: '#000000',
      red: '#CD3131',
      green: '#0DBC79',
      yellow: '#E5E510',
      blue: '#2472C8',
      magenta: '#BC3FBC',
      cyan: '#11A8CD',
      white: '#E5E5E5',
      brightBlack: '#666666',
      brightRed: '#F14C4C',
      brightGreen: '#23D18B',
      brightYellow: '#F5F543',
      brightBlue: '#3B8EEA',
      brightMagenta: '#D670D6',
      brightCyan: '#29B8DB',
      brightWhite: '#E5E5E5'
    };
    this.themes.set('default', defaultTheme);

    this.addTheme({
      name: 'light',
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#000000',
      selection: '#add6ff',
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#14ce14',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    });
  }

  public addTheme(theme: TerminalTheme): void {
    this.themes.set(theme.name, theme);
    this.emit('themeAdded', theme);
  }

  public getTheme(name: string): TerminalTheme | undefined {
    return this.themes.get(name);
  }

  public getThemes(): TerminalTheme[] {
    return Array.from(this.themes.values());
  }

  public removeTheme(name: string): void {
    this.themes.delete(name);
    this.emit('themeRemoved', name);
  }

  // History Management
  public addToHistory(command: string): void {
    this.history.push(command);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
    this.emit('historyUpdated', this.history);
  }

  public getHistory(): string[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
    this.emit('historyCleared');
  }

  // Cleanup
  public dispose(): void {
    this.sessions.forEach(session => {
      this.removeSession(session.id);
    });
    this.terminals.clear();
    this.profiles.clear();
    this.themes.clear();
    this.customThemes.clear();
    this.splitViews.clear();
    this.history = [];
    this.activeSession = null;
    this.isInitialized = false;
    this.emit('disposed');
    this.disconnect();
    this.terminalServer.dispose();
  }

  private setupEventListeners(): void {
    this.terminalServer.on('connection', () => {
      console.log('Terminal connected');
      this.isConnected = true;
      this.emit('connected');
    });

    this.terminalServer.on('disconnection', () => {
      console.log('Terminal disconnected');
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.terminalServer.on('error', (error: any) => {
      console.error('Terminal error:', error);
      this.emit('error', error);
    });
  }

  public async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.ws) {
      session.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  public async writeToSession(sessionId: string, data: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.ws) {
      session.ws.send(data);
    }
  }

  public getElement(): HTMLElement | null {
    return this.container;
  }

  public getCurrentInput(): string {
    return '';
  }

  public search(query: string): void {
    // TODO: Implement search functionality
  }

  public addCustomTheme(theme: CustomTheme): void {
    this.customThemes.set(theme.id, theme);
    this.emit('customThemeAdded', theme);
  }

  public getCustomTheme(id: string): CustomTheme | undefined {
    return this.customThemes.get(id);
  }

  public getAllCustomThemes(): CustomTheme[] {
    return Array.from(this.customThemes.values());
  }

  public connect() {
    console.log('Connecting to terminal server on port:', this.terminalServer.getPort());
    this.emit('connecting');
  }

  public disconnect() {
    console.log('Disconnecting from terminal server');
    this.terminalServer.close();
    this.isConnected = false;
    this.emit('disconnected');
  }

  public send(data: string) {
    if (this.isConnected) {
      this.terminalServer.send(data);
    } else {
      console.warn('Cannot send data: terminal not connected');
    }
  }

  public getPort(): number {
    return this.terminalServer.getPort();
  }
}