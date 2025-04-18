import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AIService } from './services/AIService';
import { TerminalService } from './services/TerminalService';
import { ProjectService } from './services/ProjectService';
import { UIService } from './services/UIService';
import { TerminalServer } from './server/terminalServer';
import { TerminalManager } from './services/TerminalManager';
import { AIConfig } from './types';
import Store from 'electron-store';

interface StoreSchema {
  theme: string;
  fontSize: number;
  fontFamily: string;
}

let mainWindow: BrowserWindow | null = null;
let aiService: AIService | null = null;
let terminalService: TerminalService | null = null;
let projectService: ProjectService | null = null;
let uiService: UIService | null = null;
let terminalServer: TerminalServer | null = null;
let terminalManager: TerminalManager | null = null;
let store: Store<StoreSchema> | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function initializeServices() {
  try {
    // Initialize AIService with config
    const aiConfig: AIConfig = {
      useLocalModel: false,
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048,
      contextWindow: 4096,
      stopSequences: ['\n\n', '```'],
      topP: 1,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2048
      }
    };

    store = new Store<StoreSchema>({
      schema: {
        theme: {
          type: 'string',
          default: 'dark'
        },
        fontSize: {
          type: 'number',
          default: 14
        },
        fontFamily: {
          type: 'string',
          default: 'Consolas, monospace'
        }
      }
    });
    aiService = AIService.getInstance(aiConfig);
    projectService = new ProjectService(process.cwd());
    uiService = new UIService();
    terminalServer = new TerminalServer(3001);
    
    // Create services with temporary references
    let terminalManager: TerminalManager;
    let terminalService: TerminalService;

    // Initialize TerminalService first with a temporary TerminalManager
    terminalService = new TerminalService(
      undefined as any, // Will be set after TerminalManager is created
      aiService,
      projectService,
      uiService,
      terminalServer,
      store
    );

    // Create TerminalManager with the port number
    terminalManager = new TerminalManager(
      3001,
      terminalService,
      aiService,
      projectService,
      uiService
    );

    // Now set the TerminalManager in TerminalService
    Object.defineProperty(terminalService, 'terminalManager', {
      value: terminalManager,
      writable: false,
      configurable: true
    });

    // Initialize the TerminalManager - this will now work in the main process
    await terminalManager.initialize();

    await aiService.initialize();
    await terminalService.initialize();
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

function setupIpcHandlers() {
  ipcMain.handle('get-code-completion', async (event, filePath: string, position: any) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.getCodeCompletion(filePath, position);
  });

  ipcMain.handle('explain-code', async (event, filePath: string, selection: any) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.explainCode(filePath, selection);
  });

  ipcMain.handle('refactor-code', async (event, filePath: string, selection: any, refactorType: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.refactorCode(filePath, selection, refactorType);
  });
}

app.whenReady().then(async () => {
  await initializeServices();
  await createWindow();
  setupIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (aiService) aiService.dispose();
  if (terminalService) terminalService.dispose();
  if (projectService) projectService.dispose();
  if (uiService) uiService.dispose();
  if (terminalServer) terminalServer.dispose();
  if (terminalManager) terminalManager.dispose();
  if (store) store.clear();
});

// Export services for use in other parts of the application
export {
  store,
  terminalManager,
  terminalService,
  aiService,
  projectService,
  uiService,
  terminalServer
};
