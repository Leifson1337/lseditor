import { EventEmitter } from '../utils/EventEmitter';

// Sichere ipcRenderer-Initialisierung - mit Prozess-Check
// ipcRenderer is used for inter-process communication between the main process and renderer process
let ipcRenderer: any = null;
// Prüfe, ob wir im Renderer-Prozess sind
// Check if we're in the renderer process
const isRenderer = typeof window !== 'undefined' && typeof process !== 'undefined' && process.type === 'renderer';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in TerminalManager', e);
}

// Hilfsfunktion für sichere IPC-Aufrufe
// Helper function for safe IPC calls
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

// SplitViewConfig represents the configuration for a split view
export interface SplitViewConfig {
  orientation: 'horizontal' | 'vertical';
  sizes: number[];
  sessions: string[];
}

// TerminalManager manages multiple terminal sessions and provides functionality for creating, removing, and managing sessions
export class TerminalManager extends EventEmitter {
  // terminals stores all the terminal instances
  private terminals: Map<string, XTerm> = new Map();
  // profiles stores all the terminal profiles
  private profiles: Map<string, TerminalProfile> = new Map();
  // themes stores all the terminal themes
  private themes: Map<string, TerminalTheme> = new Map();
  // customThemes stores all the custom terminal themes
  private customThemes: Map<string, CustomTheme> = new Map();
  // splitViews stores all the split view configurations
  private splitViews: Map<string, SplitViewConfig> = new Map();
  // history stores the command history
  private history: string[] = [];
  // maxHistorySize is the maximum number of commands to store in the history
  private maxHistorySize: number = 1000;
  // terminalServer is the server that manages the terminal connections
  private terminalServer: TerminalServer;
  // sessions stores all the terminal sessions
  private sessions: Map<string, TerminalSession> = new Map();
  // activeSession is the currently active session
  private activeSession: TerminalSession | null = null;
  // isInitialized indicates whether the terminal manager has been initialized
  private isInitialized: boolean = false;
  // container is the HTML element that contains the terminal
  private container: HTMLElement | null = null;
  // ws is the WebSocket connection to the terminal server
  private ws: any | null = null;
  // reconnectAttempts is the number of reconnect attempts
  private reconnectAttempts = 0;
  // maxReconnectAttempts is the maximum number of reconnect attempts
  private maxReconnectAttempts = 5;
  // reconnectTimeout is the timeout for reconnecting to the terminal server
  private reconnectTimeout: any | null = null;
  // terminalService is the service that provides terminal functionality
  private terminalService: TerminalService;
  // aiService is the service that provides AI functionality
  private aiService: AIService;
  // projectService is the service that provides project functionality
  private projectService?: ProjectService;
  // uiService is the service that provides UI functionality
  private uiService?: UIService;
  // isConnected indicates whether the terminal manager is connected to the terminal server
  private isConnected: boolean = false;

  // Constructor initializes the terminal manager with the given parameters
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

  // Initialize the terminal manager
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

  // Generate a unique session ID
  private generateSessionId(): string {
    return Math.random().toString(36).substring(2);
  }

  // Session Management
  // Create a new terminal session
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

  // Remove a terminal session
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

  // Activate a terminal session
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

  // Deactivate a terminal session
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

  // Get a terminal session
  public getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Get the active terminal session
  public getActiveSession(): TerminalSession | null {
    return this.activeSession;
  }

  // Get all terminal sessions
  public getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  // Check if the terminal manager is initialized
  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Terminal manager not initialized');
    }
  }

  // Split View Management
  // Create a new split view
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

  // Get a split view configuration
  public getSplitView(id: string): SplitViewConfig | undefined {
    return this.splitViews.get(id);
  }

  // Update a split view configuration
  public updateSplitView(id: string, config: Partial<SplitViewConfig>): void {
    const currentConfig = this.splitViews.get(id);
    if (currentConfig) {
      const newConfig = { ...currentConfig, ...config };
      this.splitViews.set(id, newConfig);
      this.emit('splitViewUpdated', { id, config: newConfig });
    }
  }

  // Remove a split view configuration
  public removeSplitView(id: string): void {
    const config = this.splitViews.get(id);
    if (config) {
      this.splitViews.delete(id);
      this.emit('splitViewRemoved', id);
    }
  }

  // Profile Management
  // Initialize the default profiles
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

  // Add a new profile
  public addProfile(profile: TerminalProfile): void {
    this.profiles.set(profile.name, profile);
    this.emit('profileAdded', profile);
  }

  // Get a profile
  public getProfile(name: string): TerminalProfile | undefined {
    return this.profiles.get(name);
  }

  // Get all profiles
  public getProfiles(): TerminalProfile[] {
    return Array.from(this.profiles.values());
  }

  // Remove a profile
  public removeProfile(name: string): void {
    this.profiles.delete(name);
    this.emit('profileRemoved', name);
  }

  // Theme Management
  // Initialize the default themes
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

  // Add a new theme
  public addTheme(theme: TerminalTheme): void {
    this.themes.set(theme.name, theme);
    this.emit('themeAdded', theme);
  }

  // Get a theme
  public getTheme(name: string): TerminalTheme | undefined {
    return this.themes.get(name);
  }

  // Get all themes
  public getThemes(): TerminalTheme[] {
    return Array.from(this.themes.values());
  }

  // Remove a theme
  public removeTheme(name: string): void {
    this.themes.delete(name);
    this.emit('themeRemoved', name);
  }

  // History Management
  // Add a command to the history
  public addToHistory(command: string): void {
    this.history.push(command);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
    this.emit('historyUpdated', this.history);
  }

  // Get the command history
  public getHistory(): string[] {
    return [...this.history];
  }

  // Clear the command history
  public clearHistory(): void {
    this.history = [];
    this.emit('historyCleared');
  }

  // Cleanup
  // Dispose of the terminal manager
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

  // Setup event listeners for the terminal server
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

  // Resize a terminal session
  public async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.ws) {
      session.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  // Write to a terminal session
  public async writeToSession(sessionId: string, data: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.ws) {
      session.ws.send(data);
    }
  }

  // Get the terminal container element
  public getElement(): HTMLElement | null {
    return this.container;
  }

  // Get the current input
  public getCurrentInput(): string {
    return '';
  }

  // Search for a query
  public search(query: string): void {
    // TODO: Implement search functionality
  }

  // Add a custom theme
  public addCustomTheme(theme: CustomTheme): void {
    this.customThemes.set(theme.id, theme);
    this.emit('customThemeAdded', theme);
  }

  // Get a custom theme
  public getCustomTheme(id: string): CustomTheme | undefined {
    return this.customThemes.get(id);
  }

  // Get all custom themes
  public getAllCustomThemes(): CustomTheme[] {
    return Array.from(this.customThemes.values());
  }

  // Connect to the terminal server
  public connect() {
    console.log('Connecting to terminal server on port:', this.terminalServer.getPort());
    this.emit('connecting');
  }

  // Disconnect from the terminal server
  public disconnect() {
    console.log('Disconnecting from terminal server');
    this.terminalServer.close();
    this.isConnected = false;
    this.emit('disconnected');
  }

  // Send data to the terminal server
  public send(data: string) {
    if (this.isConnected) {
      this.terminalServer.send(data);
    } else {
      console.warn('Cannot send data: terminal not connected');
    }
  }

  // Get the terminal server port
  public getPort(): number {
    return this.terminalServer.getPort();
  }
}