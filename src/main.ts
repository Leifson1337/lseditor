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
import { dialog, MessageBoxOptions } from 'electron';

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
  
  // Event-Listener für Fensterstatusänderungen
  mainWindow.on('maximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:maximized');
  });
  
  mainWindow.on('unmaximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:unmaximized');
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
  
  // Pfadüberprüfung
  ipcMain.handle('fs:checkPathExists', async (event, path) => {
    try {
      const stats = await fs.promises.stat(path);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  });
  
  // Zusätzliche Handler für Dateisystemoperationen
  ipcMain.handle('fs:createDirectory', async (event, dirPath) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error('Fehler beim Erstellen des Verzeichnisses:', error);
      return false;
    }
  });
  
  ipcMain.handle('fs:deleteFile', async (event, filePath) => {
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Fehler beim Löschen der Datei:', error);
      return false;
    }
  });
  
  ipcMain.handle('fs:deleteDirectory', async (event, dirPath) => {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Fehler beim Löschen des Verzeichnisses:', error);
      return false;
    }
  });
  
  ipcMain.handle('fs:renameFile', async (event, oldPath, newPath) => {
    try {
      await fs.promises.rename(oldPath, newPath);
      return true;
    } catch (error) {
      console.error('Fehler beim Umbenennen der Datei:', error);
      return false;
    }
  });
}

ipcMain.handle('dialog:openDirectory', async (event, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    ...options
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:inputBox', async (event, options) => {
  const { prompt = '', title = '', defaultValue = '' } = options || {};
  
  // Da Electron keinen nativen Eingabedialog hat, verwenden wir ein Nachrichtenfenster mit HTML-Input
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Abbrechen', 'OK'],
    defaultId: 1,
    title: title,
    message: prompt,
    detail: 'Drücken Sie OK, um fortzufahren.',
    customButtons: [{
      text: 'OK',
      type: 'normal'
    }],
    inputField: {
      text: defaultValue,
      type: 'text'
    }
  } as any); // 'as any' verwendet, da die Typdefinition nicht vollständig ist
  
  if (result.response === 0) return null; // Abgebrochen
  return (result as any).inputFieldText || defaultValue;
});

ipcMain.handle('dialog:showMessageBox', async (event, options: MessageBoxOptions) => {
  return await dialog.showMessageBox(options);
});

// IPC-Events für Fenstersteuerung
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    mainWindow.maximize();
    mainWindow.webContents.send('window:maximized');
  }
});
ipcMain.on('window:unmaximize', () => {
  if (mainWindow) {
    mainWindow.unmaximize();
    mainWindow.webContents.send('window:unmaximized');
  }
});
ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// IPC-Handler für Fensterstatusabfrage
ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
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
    
    // Sicheres Abrufen von Dateiinformationen mit Fehlerbehandlung für jeden Eintrag
    const result = await Promise.all(entries.map(async entry => {
      try {
        const fullPath = path.join(dirPath, entry.name);
        let stats;
        
        try {
          stats = await fs.promises.stat(fullPath);
        } catch (statError) {
          console.log(`Konnte Statistiken für ${fullPath} nicht lesen:`, statError);
          // Standardwerte verwenden, wenn Statistiken nicht gelesen werden können
          stats = {
            size: 0,
            mtime: new Date()
          };
        }
        
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: entry.isFile() ? stats.size : undefined,
          modified: entry.isFile() ? stats.mtime : undefined
        };
      } catch (entryError) {
        console.error(`Fehler beim Verarbeiten des Eintrags ${entry.name}:`, entryError);
        // Einen minimalen Eintrag zurückgeben, wenn ein Fehler auftritt
        return {
          name: entry.name,
          path: path.join(dirPath, entry.name),
          isDirectory: false,
          size: 0,
          modified: new Date()
        };
      }
    }));
    
    return result;
  } catch (error) {
    console.error('Fehler beim Lesen des Verzeichnisses:', error);
    return [];
  }
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

// IPC-Handler für Help-Menü-Funktionen
ipcMain.handle('help:showCommands', () => {
  if (mainWindow) {
    mainWindow.webContents.send('show-commands-palette');
    return true;
  }
  return false;
});

ipcMain.handle('help:editorPlayground', () => {
  if (mainWindow) {
    // Öffne einen neuen Tab mit dem Editor-Playground
    mainWindow.webContents.send('open-editor-playground');
    return true;
  }
  return false;
});

ipcMain.handle('help:accessibility', () => {
  if (mainWindow) {
    // Öffne die Accessibility-Einstellungen
    mainWindow.webContents.send('show-accessibility-features');
    return true;
  }
  return false;
});

ipcMain.handle('help:reportIssue', () => {
  // Öffne die GitHub Issues-Seite im Browser
  require('electron').shell.openExternal('https://github.com/yourusername/lseditor/issues/new');
  return true;
});

ipcMain.handle('help:toggleDevTools', () => {
  if (mainWindow) {
    // Toggle Developer Tools
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools();
    }
    return true;
  }
  return false;
});

ipcMain.handle('help:openProcessExplorer', () => {
  // Öffne den Electron Process Explorer
  if (process.env.NODE_ENV === 'development') {
    require('electron-process-manager').openProcessManager();
    return true;
  } else {
    // Fallback für Produktionsumgebung
    const processInfo = {
      pid: process.pid,
      ppid: process.ppid,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    if (mainWindow) {
      mainWindow.webContents.send('show-process-info', processInfo);
    }
    return true;
  }
});

ipcMain.handle('help:checkForUpdates', async () => {
  // Implementiere hier die Update-Prüfung
  // Beispiel: Sende ein Ereignis an den Renderer, um einen Update-Dialog anzuzeigen
  if (mainWindow) {
    mainWindow.webContents.send('checking-for-updates');
    
    // Simuliere eine Update-Prüfung (in einer echten App würde hier die tatsächliche Prüfung stattfinden)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Sende das Ergebnis der Update-Prüfung
    mainWindow.webContents.send('update-check-result', {
      hasUpdate: false,
      version: app.getVersion(),
      message: 'You are using the latest version.'
    });
    
    return true;
  }
  return false;
});

ipcMain.handle('help:about', () => {
  // Zeige About-Dialog
  const options = {
    type: 'info',
    title: 'About LSEditor',
    message: 'LSEditor',
    detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode.js: ${process.versions.node}\nV8: ${process.versions.v8}\nOS: ${process.platform} ${process.arch}`
  };
  
  dialog.showMessageBox(options);
  return true;
});

// IPC-Handler für File-Menü-Funktionen
ipcMain.handle('file:newTextFile', async () => {
  if (mainWindow) {
    mainWindow.webContents.send('create-new-text-file');
    return true;
  }
  return false;
});

ipcMain.handle('file:newWindow', async () => {
  createWindow();
  return true;
});

ipcMain.handle('file:openFile', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Text Files', extensions: ['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('file:openFolder', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('file:openWorkspaceFromFile', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Workspace Files', extensions: ['code-workspace', 'workspace'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || !result.filePaths.length) return null;
  
  try {
    const content = await fs.promises.readFile(result.filePaths[0], 'utf-8');
    const workspace = JSON.parse(content);
    return { path: result.filePaths[0], workspace };
  } catch (error) {
    console.error('Error reading workspace file:', error);
    return null;
  }
});

ipcMain.handle('file:addFolderToWorkspace', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('file:saveWorkspaceAs', async (event, currentWorkspace) => {
  if (!mainWindow) return null;
  
  const result = await dialog.showSaveDialog({
    defaultPath: 'workspace.code-workspace',
    filters: [
      { name: 'Workspace Files', extensions: ['code-workspace'] }
    ]
  });
  
  if (result.canceled || !result.filePath) return null;
  
  try {
    await fs.promises.writeFile(result.filePath, JSON.stringify(currentWorkspace, null, 2));
    return result.filePath;
  } catch (error) {
    console.error('Error saving workspace file:', error);
    return null;
  }
});

ipcMain.handle('file:save', async (event, filePath, content) => {
  if (!filePath) {
    // Wenn keine Datei angegeben ist, rufen wir saveAs direkt auf
    const saveAsResult = await dialog.showSaveDialog({
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'JavaScript', extensions: ['js'] },
        { name: 'TypeScript', extensions: ['ts'] },
        { name: 'HTML', extensions: ['html'] },
        { name: 'CSS', extensions: ['css'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (saveAsResult.canceled || !saveAsResult.filePath) {
      return { success: false, error: 'Operation canceled' };
    }
    
    try {
      await fs.promises.writeFile(saveAsResult.filePath, content, 'utf-8');
      return { success: true, path: saveAsResult.filePath };
    } catch (error) {
      console.error('Error saving file:', error);
      return { success: false, error: String(error) };
    }
  }
  
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('file:saveAs', async (event, content, defaultPath = '') => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'TypeScript', extensions: ['ts'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'CSS', extensions: ['css'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || !result.filePath) return { success: false, error: 'Operation canceled' };
  
  try {
    await fs.promises.writeFile(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('file:saveAll', async (event, files) => {
  const results = [];
  
  for (const file of files) {
    try {
      await fs.promises.writeFile(file.path, file.content, 'utf-8');
      results.push({ path: file.path, success: true });
    } catch (error) {
      console.error(`Error saving file ${file.path}:`, error);
      results.push({ path: file.path, success: false, error: String(error) });
    }
  }
  
  return results;
});

ipcMain.handle('file:share', async (event, filePath, content) => {
  // Implementierung für Teilen-Funktionalität
  // Dies könnte eine Integration mit einem Dienst wie GitHub Gist, Pastebin, etc. sein
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  // Beispiel: Erstellen eines temporären Links (in einer echten App würde hier die tatsächliche Sharing-Logik stehen)
  mainWindow.webContents.send('show-share-dialog', {
    filePath,
    shareUrl: `https://example.com/share/${Date.now()}`
  });
  
  return { success: true };
});

ipcMain.handle('file:revertFile', async (event, filePath) => {
  if (!filePath) return { success: false, error: 'No file path provided' };
  
  try {
    // Lese die Datei erneut vom Dateisystem, um Änderungen zu verwerfen
    const content = await fs.promises.readFile(filePath, 'utf-8');
    if (mainWindow) {
      mainWindow.webContents.send('file-reverted', { path: filePath, content });
    }
    return { success: true, content };
  } catch (error) {
    console.error('Error reverting file:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('file:closeEditor', () => {
  if (mainWindow) {
    mainWindow.webContents.send('close-current-editor');
    return true;
  }
  return false;
});

ipcMain.handle('file:closeFolder', () => {
  if (mainWindow) {
    mainWindow.webContents.send('close-current-folder');
    return true;
  }
  return false;
});

ipcMain.handle('file:closeWindow', () => {
  if (mainWindow) {
    mainWindow.close();
    return true;
  }
  return false;
});

ipcMain.handle('file:exit', () => {
  app.quit();
  return true;
});

ipcMain.handle('file:duplicateWorkspace', () => {
  if (mainWindow) {
    createWindow();
    mainWindow.webContents.send('duplicate-workspace');
    return true;
  }
  return false;
});

// IPC-Handler für Editor-Befehle
ipcMain.on('editor:executeCommand', (event, command) => {
  if (!mainWindow) return;
  
  // Sende den Befehl an den Editor im Renderer-Prozess
  mainWindow.webContents.send('editor:executeCommand', command);
});

// IPC-Handler für Suchen und Ersetzen
ipcMain.handle('editor:find', (event, searchText, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  mainWindow.webContents.send('editor:find', searchText, options);
  return { success: true };
});

ipcMain.handle('editor:replace', (event, searchText, replaceText, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  mainWindow.webContents.send('editor:replace', searchText, replaceText, options);
  return { success: true };
});

ipcMain.handle('editor:findInFiles', async (event, searchText, searchPath, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  try {
    // Rekursive Suche in Dateien
    const files = await getAllFilesRecursive(searchPath);
    const results = [];
    
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(searchText)) {
            results.push({
              file,
              line: i + 1,
              content: line,
              matchStart: line.indexOf(searchText),
              matchEnd: line.indexOf(searchText) + searchText.length
            });
          }
        }
      } catch (error) {
        console.error(`Error searching in file ${file}:`, error);
      }
    }
    
    mainWindow.webContents.send('editor:findInFilesResults', results);
    return { success: true, count: results.length };
  } catch (error) {
    console.error('Error searching in files:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('editor:replaceInFiles', async (event, searchText, replaceText, searchPath, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };
  
  try {
    // Rekursive Suche und Ersetzen in Dateien
    const files = await getAllFilesRecursive(searchPath);
    const results = [];
    
    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf-8');
        
        if (content.includes(searchText)) {
          const newContent = content.split(searchText).join(replaceText);
          await fs.promises.writeFile(file, newContent, 'utf-8');
          
          const replacements = (content.match(new RegExp(searchText, 'g')) || []).length;
          results.push({
            file,
            replacements
          });
        }
      } catch (error) {
        console.error(`Error replacing in file ${file}:`, error);
      }
    }
    
    mainWindow.webContents.send('editor:replaceInFilesResults', results);
    return { success: true, count: results.length };
  } catch (error) {
    console.error('Error replacing in files:', error);
    return { success: false, error: String(error) };
  }
});

// IPC-Handler für Datei-Lesevorgänge
ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const fsPromises = require('fs').promises;
    const content = await fsPromises.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Fehler beim Lesen der Datei:', filePath, error);
    return '';
  }
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
