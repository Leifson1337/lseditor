// main.ts
// Main Electron process script for lseditor. Handles app lifecycle, window creation, and main process logic.

/**
 * The main Electron process script is responsible for initializing the application,
 * managing the main window, handling IPC, and integrating with OS-level features.
 */

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

// Main window and service instances
let mainWindow: BrowserWindow | null = null;
let aiService: AIService;
let terminalService: TerminalService | undefined = undefined;
let uiService: UIService | undefined = undefined;
let terminalServer: TerminalServer | undefined = undefined;
let terminalManager: TerminalManager | undefined = undefined;

// --- TERMINAL ---
// Terminal functionality is now handled in the renderer process

// --- SYSTEM BUTTONS ---
ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.maximize();
});
ipcMain.handle('window:unmaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.unmaximize();
});
ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// --- FS CHECK PATH EXISTS ---
ipcMain.handle('fs:checkPathExists', async (event, pathToCheck: string) => {
  try {
    await fs.promises.access(pathToCheck, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

/**
 * Creates the main application window with custom settings and loads the index.html file.
 */
async function createWindow() {
  // Create a new browser window with custom settings
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

  // Maximize the window
  mainWindow.maximize();

  // Listen for window maximize event and notify renderer
  mainWindow.on('maximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:maximized');
  });

  // Listen for window unmaximize event and notify renderer
  mainWindow.on('unmaximize', () => {
    if (mainWindow) mainWindow.webContents.send('window:unmaximized');
  });

  // Load the index.html file into the window
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

/**
 * Initializes the main application services, including AIService, TerminalService, UIService, and TerminalServer.
 */
async function initializeServices() {
  try {
    // Initialize AIService with config
    const aiConfig: AIConfig = {
      useLocalModel: false,
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048,
      contextWindow: 4096,
      // Stop sequences must always be an array!
      stopSequences: ['\n\n', '```'],
      topP: 1,
      openAIConfig: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2048
      }
    };

    // Create services with temporary references (due to dependency cycle)
    let terminalManager: TerminalManager;
    let terminalService: TerminalService;

    // Initialize TerminalService first with a temporary TerminalManager (set later)
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

    // Now set the TerminalManager in TerminalService using Object.defineProperty
    Object.defineProperty(terminalService, 'terminalManager', {
      value: terminalManager,
      writable: false,
      configurable: true
    });

    // Initialize the TerminalManager in the main process
    await terminalManager.initialize();

    // Initialize other services
    aiService = AIService.getInstance(aiConfig);
    uiService = new UIService();
    terminalServer = new TerminalServer(3001);

    // Initialize services
    await aiService.initialize();
    await terminalService.initialize();
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
  }
}

/**
 * Sets up IPC handlers for AI code features, including code completion, explanation, and refactoring.
 */
function setupIpcHandlers() {
  // IPC handler for getting code completion
  ipcMain.handle('get-code-completion', async (event, filePath: string, position: any) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.getCodeCompletion(filePath, position);
  });

  // IPC handler for explaining code
  ipcMain.handle('explain-code', async (event, filePath: string, selection: any) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.explainCode(filePath, selection);
  });

  // IPC handler for refactoring code
  ipcMain.handle('refactor-code', async (event, filePath: string, selection: any, refactorType: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService!.refactorCode(filePath, selection, refactorType);
  });
}

/**
 * Sets up IPC handlers for file system operations, including reading directories, files, and writing files.
 */
function setupFsIpcHandlers() {
  // File system: read directory
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

  // File system: read file
  ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      console.error('Error reading file:', err);
      return '';
    }
  });

  // File system: write file
  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      console.error('Error writing file:', err);
      return false;
    }
  });

  // File system: check if path exists and is directory
  ipcMain.handle('fs:checkPathExistsAndIsDirectory', async (event, path) => {
    try {
      const stats = await fs.promises.stat(path);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  });

  // File system: create directory recursively
  ipcMain.handle('fs:createDirectory', async (event, dirPath) => {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error('Error creating directory:', error);
      return false;
    }
  });

  // File system: delete file
  ipcMain.handle('fs:deleteFile', async (event, filePath) => {
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  });

  // File system: delete directory recursively
  ipcMain.handle('fs:deleteDirectory', async (event, dirPath) => {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error('Error deleting directory:', error);
      return false;
    }
  });

  // File system: rename file or directory
  ipcMain.handle('fs:renameFile', async (event, oldPath, newPath) => {
    try {
      await fs.promises.rename(oldPath, newPath);
      return true;
    } catch (error) {
      console.error('Error renaming file:', error);
      return false;
    }
  });
}

// --- Fehlende IPC-Handler für Renderer-Kommunikation ---
ipcMain.handle('getDirectoryEntries', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      path: path.join(dirPath, entry.name)
    }));
  } catch (error) {
    return { error: String(error) };
  }
});

ipcMain.handle('window:isMaximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.handle('dialog:openDirectory', async (event) => {
  const win = mainWindow;
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openDirectory']
  };
  const result = win
    ? await dialog.showOpenDialog(win, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:inputBox', async (event, options) => {
  const win = mainWindow;
  const msgBoxOptions: MessageBoxOptions = {
    type: 'question',
    title: options?.title || 'Input',
    message: options?.label || 'Please enter a value:',
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  };
  const result = win
    ? await dialog.showMessageBox(win, msgBoxOptions)
    : await dialog.showMessageBox(msgBoxOptions);
  return result.response === 0 ? (options?.value || '') : null;
});

// IPC-Handler für system buttons (Fenstersteuerung)

ipcMain.handle('file:newTextFile', async () => {
  if (mainWindow) {
    mainWindow.webContents.send('create-new-text-file');
    return true;
  }
  return false;
});

/**
 * IPC handler for saving all open files.
 */
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

/**
 * IPC handler for recursive search and replace in files.
 */
ipcMain.handle('editor:findInFiles', async (event, searchText, searchPath, options = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };

  try {
    // Recursive search in files
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

// Export services for use in other parts of the application
export {
  terminalManager,
  terminalService,
  aiService,
  uiService,
  terminalServer
};

// Electron Lifecycle: Services und Fenster nach App-Start initialisieren
app.whenReady().then(async () => {
  await initializeServices();
  await createWindow();
  setupIpcHandlers();
  setupFsIpcHandlers();
});

/**
 * Helper function for recursively listing all files in a directory.
 */
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
