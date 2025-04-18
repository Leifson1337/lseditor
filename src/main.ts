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
      nodeIntegration: false,
      contextIsolation: true,
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

// IPC-Handler für Dateisystem-Operationen
ipcMain.handle('readFile', async (event, filePath) => {
  return fs.promises.readFile(filePath, 'utf8');
});

ipcMain.handle('getFileExtension', async (event, filePath) => {
  return path.extname(filePath);
});

ipcMain.handle('getProjectRoot', async (event, filePath) => {
  return path.dirname(filePath);
});

ipcMain.handle('getPackageJsonPath', async (event, filePath) => {
  const packageJsonPath = path.join(path.dirname(filePath), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return packageJsonPath;
  }
  return null;
});

ipcMain.handle('readJsonFile', async (event, filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf8');
  return JSON.parse(content);
});

ipcMain.handle('getAllFiles', async (event, dir) => {
  // Implementiere rekursives Dateilisten
  return getAllFilesRecursive(dir);
});

ipcMain.handle('readDir', async (event, dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries.map(entry => ({
    name: entry.name,
    isDirectory: entry.isDirectory()
  }));
});

ipcMain.handle('joinPath', async (event, ...parts) => {
  return path.join(...parts);
});

ipcMain.handle('getRelativePath', async (event, from, to) => {
  return path.relative(from, to);
});

ipcMain.handle('exec', async (event, command) => {
  return new Promise((resolve, reject) => {
    require('child_process').exec(command, (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
});

// IPC-Handler für Dateisystem-Operationen für ProjectService
ipcMain.handle('getDirectoryEntries', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      size: entry.isFile() ? fs.statSync(path.join(dirPath, entry.name)).size : undefined,
      modified: entry.isFile() ? fs.statSync(path.join(dirPath, entry.name)).mtime : undefined
    }));
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
});

ipcMain.handle('writeFile', async (event, filePath, content) => {
  await fs.promises.writeFile(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('createDirectory', async (event, dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle('deleteFile', async (event, filePath) => {
  await fs.promises.unlink(filePath);
  return true;
});

ipcMain.handle('deleteDirectory', async (event, dirPath) => {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
  return true;
});

ipcMain.handle('renameFile', async (event, oldPath, newPath) => {
  await fs.promises.rename(oldPath, newPath);
  return true;
});

// IPC-Handler für TerminalServer
ipcMain.handle('findAvailablePort', async (event, startPort) => {
  const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = require('net').createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  };

  let port = startPort;
  while (!(await isPortAvailable(port))) {
    port++;
  }

  return port;
});

ipcMain.handle('isPortAvailable', async (event, port) => {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
});

// WebSocket-Server-Instanzen
const terminalServers = new Map<number, any>();

ipcMain.handle('initTerminalServer', async (event, port) => {
  try {
    // Finde verfügbaren Port, falls der angegebene nicht verfügbar ist
    const actualPort = await event.sender.send('findAvailablePort', port);
    console.log('Initializing terminal server on port:', port);
    
    // Erstelle WebSocket-Server
    const WebSocketServer = require('ws').WebSocketServer;
    const wss = new WebSocketServer({ port });
    
    // Speichere Server-Instanz
    terminalServers.set(port, wss);
    
    // Event-Handler
    wss.on('connection', (ws: any) => {
      console.log('New terminal connection established');
      
      ws.on('message', (data: any) => {
        // Sende Daten an den Renderer-Prozess
        event.sender.send('terminal:data', 'default', data.toString());
      });
    });
    
    return port;
  } catch (error) {
    console.error('Failed to initialize terminal server:', error);
    throw error;
  }
});

ipcMain.handle('terminalSend', async (event, data) => {
  // Sende Daten an alle verbundenen WebSocket-Clients
  for (const [port, wss] of terminalServers.entries()) {
    wss.clients.forEach((client: any) => {
      if (client.readyState === require('ws').OPEN) {
        client.send(data);
      }
    });
  }
  return true;
});

ipcMain.handle('closeTerminalServer', async (event, port) => {
  const wss = terminalServers.get(port);
  if (wss) {
    wss.close();
    terminalServers.delete(port);
    console.log('Terminal server on port', port, 'closed');
  }
  return true;
});

// Hilfsfunktion zum rekursiven Auflisten aller Dateien
function getAllFilesRecursive(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const results: string[] = [];
    fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
      if (err) {
        return reject(err);
      }
      
      let pending = entries.length;
      if (!pending) {
        return resolve(results);
      }
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules and .git
          if (entry.name === 'node_modules' || entry.name === '.git') {
            if (--pending === 0) {
              resolve(results);
            }
            continue;
          }
          
          getAllFilesRecursive(fullPath).then(files => {
            results.push(...files);
            if (--pending === 0) {
              resolve(results);
            }
          }).catch(reject);
        } else {
          results.push(fullPath);
          if (--pending === 0) {
            resolve(results);
          }
        }
      }
    });
  });
}

// Export services for use in other parts of the application
export {
  terminalManager,
  terminalService,
  aiService,
  uiService,
  terminalServer
};
