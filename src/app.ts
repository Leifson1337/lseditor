import { EventEmitter } from 'events';
import { EditorService } from './services/EditorService';
import { AIService } from './services/AIService';
import { ProjectService } from './services/ProjectService';
import { UIService } from './services/UIService';
import { GitService } from './services/GitService';
import { TerminalService } from './services/TerminalService';
import { SecurityService } from './services/SecurityService';
import { CollaborationService } from './services/CollaborationService';
import { DocumentationService } from './services/DocumentationService';
import { PerformanceService } from './services/PerformanceService';
import { NotificationService, Notification } from './services/NotificationService';
import { StatusBarItem } from './services/StatusBarService';
import { AIConfig } from './types/AITypes';
import { EditorConfig } from './services/EditorService';
import { TerminalConfig } from './types/terminal';
import * as path from 'path';
import { StatusBarService } from './services/StatusBarService';
import { StatusResult } from 'simple-git';
import { ResourceUsage } from './types/PerformanceService';
import { app, BrowserWindow, ipcMain } from 'electron';
import { TerminalManager } from './services/TerminalManager';
import { TerminalServer } from './server/terminalServer';
import Store from 'electron-store';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { EditorIntegrationService } from './services/EditorIntegrationService';
import { CodeContext } from './types/AITypes';
import { Position } from 'monaco-editor/esm/vs/editor/editor.api';

interface ProjectSettings {
  workspacePath: string;
  name: string;
  type: string;
  settings: Record<string, any>;
}

interface StoreSchema {
  ai: AIConfig;
}

export class App extends EventEmitter {
  private editorService: EditorService;
  private aiService: AIService;
  private projectService: ProjectService;
  private uiService: UIService;
  private gitService: GitService;
  private terminalService: TerminalService;
  private securityService: SecurityService;
  private collaborationService: CollaborationService;
  private documentationService: DocumentationService;
  private performanceService: PerformanceService;
  private notificationService: NotificationService;
  private statusBarService: StatusBarService;
  private terminalManager: TerminalManager;
  private terminalServer: TerminalServer;
  private store: Store<StoreSchema>;
  private mainWindow: BrowserWindow | null = null;
  private editorIntegrationService: EditorIntegrationService;

  constructor(workspacePath: string) {
    super();
    
    // Initialize services
    this.performanceService = new PerformanceService();
    this.gitService = GitService.getInstance(workspacePath);
    this.projectService = new ProjectService(workspacePath);
    this.editorService = new EditorService({}, this.gitService, this.performanceService);
    this.uiService = new UIService();
    
    this.store = new Store<StoreSchema>({
      name: 'lseditor-config',
      defaults: {
        ai: {
          model: 'gpt-3.5-turbo',
          temperature: 0.7,
          maxTokens: 1000,
          contextWindow: 4096,
          useLocalModel: false,
          localModelPath: '',
          stopSequences: [],
          openAIConfig: {
            apiKey: '',
            model: 'gpt-3.5-turbo',
            temperature: 0.7,
            maxTokens: 1000
          }
        }
      }
    });

    // Initialize AIService with config
    this.aiService = AIService.getInstance({
      useLocalModel: false,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 1000
      },
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000,
      contextWindow: 2048,
      stopSequences: [],
      topP: 1
    });

    this.terminalServer = new TerminalServer(3001);
    
    // Create TerminalService with null TerminalManager initially
    this.terminalService = TerminalService.getInstance(
      null,
      this.aiService,
      this.projectService,
      this.uiService,
      this.terminalServer,
      this.store
    );
    
    // Create TerminalManager with the port number
    this.terminalManager = new TerminalManager(
      3001,
      this.terminalService,
      this.aiService,
      this.projectService,
      this.uiService
    );
    
    // Now update the TerminalService with the TerminalManager
    this.terminalService.setTerminalManager(this.terminalManager);
    
    const securityConfig = {
      jwtSecret: process.env.JWT_SECRET || 'default-secret',
      tokenExpiration: 3600,
      maxFailedAttempts: 5,
      lockoutDuration: 300000,
      backupInterval: 3600000,
      backupPath: path.join(workspacePath, '.security'),
      encryptionKey: process.env.ENCRYPTION_KEY || 'default-key'
    };
    
    this.securityService = new SecurityService(securityConfig);
    this.collaborationService = new CollaborationService(3000);
    this.documentationService = new DocumentationService(
      path.join(workspacePath, 'docs'),
      path.join(workspacePath, 'tutorials'),
      path.join(workspacePath, 'cheatsheets')
    );
    this.notificationService = new NotificationService();
    this.statusBarService = new StatusBarService();

    // Initialize UI
    this.uiService.initializeDefaultThemes();
    this.uiService.initializeDefaultShortcuts();

    // Set up event listeners
    this.setupEventListeners();

    // Initialize EditorIntegrationService
    this.editorIntegrationService = new EditorIntegrationService(this.terminalService);

    // Initialize terminal session
    this.initializeTerminalSession();
  }

  private async initializeTerminalSession(): Promise<void> {
    const defaultConfig: TerminalConfig = {
      profile: 'default',
      theme: 'default',
      cwd: process.cwd()
    };
    
    const session = await this.terminalService.createSession(defaultConfig);
    if (session) {
      await this.terminalService.writeToSession(session.id, 'Welcome to the terminal!\n');
      await this.terminalService.clearSession(session.id);
      await this.terminalService.writeToSession(session.id, 'Ready.\n');
    }
  }

  private setupEventListeners(): void {
    // Project Service Events
    this.projectService.on('projectChanged', (projectPath: string) => {
      this.notificationService.show({
        type: 'info',
        message: `Project changed to ${projectPath}`,
        duration: 3000
      });
    });

    // Terminal Service Events
    this.terminalService.on('data', (data: string) => {
      this.statusBarService.updateStatusBarItem({
        id: 'terminal',
        text: data,
        alignment: 'right',
        priority: 1
      });
    });

    // Editor Service Events
    this.editorService.on('configChanged', (config: EditorConfig) => {
      this.statusBarService.updateStatusBarItem({
        id: 'editorConfig',
        text: 'Editor config updated',
        alignment: 'right',
        priority: 2
      });
    });

    // Git Service Events
    this.gitService.on('statusChanged', (status: StatusResult) => {
      const branch = status.current;
      this.statusBarService.updateStatusBarItem({
        id: 'gitBranch',
        text: `Branch: ${branch}`,
        alignment: 'left',
        priority: 1
      });
    });

    // Performance Service Events
    this.performanceService.on('resourceUsageUpdated', (usage: ResourceUsage) => {
      const cpu = Math.round(usage.cpu * 100);
      const memory = Math.round(usage.memory.heapUsed / 1024 / 1024);
      this.statusBarService.updateStatusBarItem({
        id: 'performance',
        text: `CPU: ${cpu}% | Memory: ${memory}MB`,
        alignment: 'right',
        priority: 3
      });
    });

    // Error Handling
    this.projectService.on('error', (error: Error) => this.handleError(error));
    this.terminalService.on('error', (error: Error) => this.handleError(error));
    this.editorService.on('error', (error: Error) => this.handleError(error));
    this.gitService.on('error', (error: Error) => this.handleError(error));
    this.performanceService.on('error', (error: Error) => this.handleError(error));

    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    // AI Operations
    ipcMain.handle('ai:getCompletion', async (event, filePath: string, position: monaco.Position) => {
      try {
        const context = await this.aiService.getCodeContext(filePath, position);
        return await this.aiService.getCodeCompletion(filePath, position);
      } catch (error) {
        console.error('Error getting completion:', error);
        throw error;
      }
    });

    ipcMain.handle('ai:explainCode', async (event, filePath: string, selection: monaco.Selection) => {
      try {
        return await this.aiService.explainCode(filePath, selection);
      } catch (error) {
        console.error('Error explaining code:', error);
        throw error;
      }
    });

    // Project Management
    ipcMain.handle('project:open', async (_, path: string) => {
      return this.projectService.setProject(path);
    });

    ipcMain.handle('project:save', async (_, path: string) => {
      return this.projectService.setProject(path);
    });

    // Terminal Management
    ipcMain.handle('terminal:create', async (_, config: TerminalConfig) => {
      const session = await this.terminalService.createSession(config);
      return session;
    });

    ipcMain.handle('terminal:write', async (event, { sessionId, data }) => {
      try {
        await this.terminalService.writeToSession(sessionId, data);
        return { success: true };
      } catch (error: any) {
        console.error('Failed to write to terminal:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('terminal:clear', async (event, { sessionId }) => {
      try {
        await this.terminalService.clearSession(sessionId);
        return { success: true };
      } catch (error: any) {
        console.error('Failed to clear terminal:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('terminal:resize', async (_, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      await this.terminalManager.resizeSession(sessionId, cols, rows);
      return { success: true };
    });

    // Git Operations
    ipcMain.handle('git:status', async () => {
      try {
        const status = await this.gitService.getStatus();
        return { success: true, status };
      } catch (error: any) {
        console.error('Failed to get git status:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('git:commit', async (event, { message }) => {
      try {
        await this.gitService.commit(message);
        return { success: true };
      } catch (error: any) {
        console.error('Failed to commit changes:', error);
        return { success: false, error: error.message };
      }
    });
  }

  public async initialize() {
    try {
      // Initialize services
      await this.gitService.refreshStatus();
      await this.gitService.refreshBranches();
      await this.gitService.refreshRemotes();
      
      // Configure AI service
      const aiConfig: AIConfig = {
        useLocalModel: false,
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2048,
        contextWindow: 4000,
        localModelPath: '',
        stopSequences: [],
        openAIConfig: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 2048
        }
      };
      
      // Start resource monitoring
      this.performanceService.startResourceMonitoring();

      await this.aiService.initialize();
      
      // Set up IPC handlers
      this.setupIpcHandlers();

      // Set up event listeners
      this.setupEventListeners();

      // Load last opened project if any
      const workspacePath = this.projectService.getWorkspacePath();
      if (workspacePath) {
        this.projectService.setProject(workspacePath);
      }

      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }

  private handleError(error: Error): void {
    const notification: Notification = {
      type: 'error',
      message: error.message,
      duration: 5000
    };
    
    this.notificationService.show(notification);
    console.error(error);
  }

  public async openFile(filePath: string): Promise<void> {
    try {
      const content = await this.projectService.getFileContent(filePath);
      // Create a new editor for the file
      const editorId = this.editorService.createEditor(document.getElementById('editor') as HTMLElement, {
        value: content,
        language: this.getLanguageFromPath(filePath)
      });
      
      // Update status bar
      this.uiService.updateStatusBarItem({
        id: 'currentFile',
        text: filePath,
        tooltip: 'Current file',
        alignment: 'left'
      });
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private getLanguageFromPath(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
      case '.js':
        return 'javascript';
      case '.ts':
        return 'typescript';
      case '.html':
        return 'html';
      case '.css':
        return 'css';
      case '.json':
        return 'json';
      case '.md':
        return 'markdown';
      default:
        return 'plaintext';
    }
  }

  public updateEditorConfig(config: Partial<EditorConfig>): void {
    try {
      this.editorService.updateConfig(config);
      
      // Update status bar
      this.uiService.updateStatusBarItem({
        id: 'editorConfig',
        text: 'Editor config updated',
        tooltip: 'Editor configuration',
        alignment: 'right'
      });
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public dispose(): void {
    this.editorService.dispose();
    this.gitService.dispose();
    this.terminalService.dispose();
    this.collaborationService.dispose();
    this.performanceService.dispose();
    this.notificationService.dispose();
    this.statusBarService.dispose();
    this.terminalManager.dispose();
    this.terminalServer.dispose();
    this.editorIntegrationService.dispose();
    this.removeAllListeners();
  }

  public getProjectService(): ProjectService {
    return this.projectService;
  }

  public getTerminalService(): TerminalService {
    return this.terminalService;
  }

  public getEditorService(): EditorService {
    return this.editorService;
  }

  public getAIService(): AIService {
    return this.aiService;
  }

  public getGitService(): GitService {
    return this.gitService;
  }

  public getPerformanceService(): PerformanceService {
    return this.performanceService;
  }

  public getSecurityService(): SecurityService {
    return this.securityService;
  }

  public async getCodeContext(): Promise<CodeContext> {
    const activeEditor = this.editorService.getActiveEditor();
    if (!activeEditor) {
      throw new Error('No active editor');
    }
    
    const model = activeEditor.getModel();
    if (!model) {
      throw new Error('No active model');
    }

    const filePath = model.uri.fsPath;
    if (!filePath) {
      throw new Error('No file path');
    }
    
    const position = activeEditor.getPosition();
    const selection = activeEditor.getSelection();
    
    const context: CodeContext = {
      imports: [],  // This will be filled by AIService
      code: model.getValue(),
      language: model.getLanguageId(),
      filePath: filePath,
      selectedText: selection ? model.getValueInRange(selection) : '',
      currentLine: position ? model.getLineContent(position.lineNumber) : '',
      currentWord: position ? (model.getWordAtPosition(position)?.word || '') : '',
      currentFile: filePath,
      projectRoot: this.projectService.getWorkspacePath(),
      gitStatus: await this.gitService.getStatus(),
      selection: selection ? {
        start: model.getOffsetAt(selection.getStartPosition()),
        end: model.getOffsetAt(selection.getEndPosition())
      } : undefined
    };

    return context;
  }

  public async getCodeCompletion(filePath: string, position: Position): Promise<string> {
    const response = await this.aiService.getCodeCompletion(filePath, position);
    return response.text;
  }

  public async explainCode(filePath: string, selection: monaco.Selection): Promise<string> {
    const response = await this.aiService.explainCode(filePath, selection);
    return response.text;
  }

  public async refactorCode(filePath: string, selection: monaco.Selection, refactorType: string): Promise<string> {
    const response = await this.aiService.refactorCode(filePath, selection, refactorType);
    return response.text;
  }
} 