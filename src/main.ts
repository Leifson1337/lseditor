import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AIService } from './services/AIService';
import { TerminalService } from './services/TerminalService';
import { UIService } from './services/UIService';
import { TerminalServer } from './server/terminalServer';
import { TerminalManager } from './services/TerminalManager';
import { AIConfig } from './types/AITypes';
import 'prismjs';
import 'prismjs/themes/prism.css';
import * as fs from 'fs';
import { dialog } from 'electron';

let mainWindow: BrowserWindow | null = null;
let aiService: AIService | null = null;
let terminalService: TerminalService | null = null;
let uiService: UIService | null = null;
let terminalServer: TerminalServer | null = null;
let terminalManager: TerminalManager | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Custom Titlebar
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.maximize();
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
      stopSequences: ['\n\n', '```'], // immer ein Array!
      topP: 1,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2048
      }
    };

    aiService = AIService.getInstance(aiConfig);
    uiService = new UIService();
    terminalServer = new TerminalServer(3001);
    
    // Create services with temporary references
    let terminalManager: TerminalManager;
    let terminalService: TerminalService;

    // Initialize TerminalService first with a temporary TerminalManager
    terminalService = new TerminalService(
      null, // TerminalManager
      aiService,
      undefined, // ProjectService (optional)
      uiService,
      terminalServer,
      undefined // store (optional)
    );

    // Create TerminalManager with the port number
    terminalManager = new TerminalManager(
      3001,
      terminalService,
      aiService,
      undefined, // ProjectService (optional)
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

function setupFsIpcHandlers() {
  ipcMain.handle('fs:readDir', async (event, dirPath) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory()
      }));
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      return '';
    }
  });

  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      return false;
    }
  });
}

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// IPC-Events für Fenstersteuerung
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window:maximize', () => {
  if (mainWindow) mainWindow.maximize();
});
ipcMain.on('window:unmaximize', () => {
  if (mainWindow) mainWindow.unmaximize();
});
ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

try {
  const Store = require('electron-store');
  if (Store && Store.initRenderer) {
    Store.initRenderer();
  }
} catch (e) {
  // electron-store nicht im Main-Prozess verwendet
}

app.whenReady().then(async () => {
  setupFsIpcHandlers(); // Stelle sicher, dass die FS-Handler VOR dem Renderer aktiv sind
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
  if (uiService) uiService.dispose();
  if (terminalServer) terminalServer.dispose();
  if (terminalManager) terminalManager.dispose();
});

// Export services for use in other parts of the application
export {
  terminalManager,
  terminalService,
  aiService,
  uiService,
  terminalServer
};
