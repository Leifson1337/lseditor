import { EventEmitter } from '../utils/EventEmitter';

// Sichere ipcRenderer-Initialisierung
let ipcRenderer: any = null;
// Prüfe, ob wir im Renderer-Prozess sind (window existiert)
const isRenderer = typeof window !== 'undefined';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in ProjectService', e);
}

// Hilfsfunktion für sichere IPC-Aufrufe
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: DirectoryEntry[];
  size?: number;
  modified?: Date;
}

export class ProjectService extends EventEmitter {
  private workspacePath: string;
  private currentProject: string | null = null;
  
  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.initialize().catch(err => {
      console.error('Failed to initialize project service:', err);
    });
  }
  
  private async initialize() {
    // Lade Projekteinstellungen
    await this.loadSettings();
  }
  
  private async loadSettings() {
    try {
      // Lade Verzeichnisstruktur
      const entries = await this.getDirectoryEntries(this.workspacePath);
      this.emit('directoryLoaded', entries);
    } catch (error) {
      console.error('Error loading project settings:', error);
    }
  }
  
  public async getDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
    if (!ipcRenderer) {
      throw new Error('ipcRenderer not available');
    }
    
    try {
      return await safeIpcInvoke('getDirectoryEntries', dirPath);
    } catch (error) {
      console.error('Error getting directory entries:', error);
      return [];
    }
  }
  
  public async getFileContent(filePath: string): Promise<string> {
    try {
      return await safeIpcInvoke('readFile', filePath);
    } catch (error) {
      console.error('Error reading file:', error);
      return '';
    }
  }
  
  public async saveFile(filePath: string, content: string): Promise<void> {
    try {
      await safeIpcInvoke('writeFile', filePath, content);
      this.emit('fileSaved', filePath);
    } catch (error) {
      console.error('Error saving file:', error);
    }
  }
  
  public async createFile(filePath: string, content: string = ''): Promise<void> {
    try {
      await safeIpcInvoke('writeFile', filePath, content);
      this.emit('fileCreated', filePath);
    } catch (error) {
      console.error('Error creating file:', error);
    }
  }
  
  public async createDirectory(dirPath: string): Promise<void> {
    try {
      await safeIpcInvoke('createDirectory', dirPath);
      this.emit('directoryCreated', dirPath);
    } catch (error) {
      console.error('Error creating directory:', error);
    }
  }
  
  public async deleteFile(filePath: string): Promise<void> {
    try {
      await safeIpcInvoke('deleteFile', filePath);
      this.emit('fileDeleted', filePath);
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }
  
  public async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await safeIpcInvoke('deleteDirectory', dirPath);
      this.emit('directoryDeleted', dirPath);
    } catch (error) {
      console.error('Error deleting directory:', error);
    }
  }
  
  public async renameFile(oldPath: string, newPath: string): Promise<void> {
    try {
      await safeIpcInvoke('renameFile', oldPath, newPath);
      this.emit('fileRenamed', { oldPath, newPath });
    } catch (error) {
      console.error('Error renaming file:', error);
    }
  }
  
  public getWorkspacePath(): string {
    return this.workspacePath;
  }
  
  public setWorkspacePath(path: string): void {
    this.workspacePath = path;
    this.emit('workspaceChanged', path);
    this.loadSettings().catch(err => {
      console.error('Error reloading settings after workspace change:', err);
    });
  }

  // Fehlende Methoden hinzufügen, die in app.ts und App.tsx verwendet werden
  public setProject(projectPath: string): void {
    this.currentProject = projectPath;
    this.emit('projectChanged', projectPath);
  }

  public closeProject(): void {
    this.currentProject = null;
    this.emit('projectClosed');
  }

  public async getFileStructure(dirPath: string): Promise<any[]> {
    try {
      const entries = await this.getDirectoryEntries(dirPath);
      const result: any[] = [];
      
      for (const entry of entries) {
        const node = {
          name: entry.name,
          path: entry.path,
          type: entry.isDirectory ? 'directory' : 'file',
          children: undefined as any[] | undefined
        };
        
        if (entry.isDirectory) {
          node.children = await this.getFileStructure(entry.path);
        }
        
        result.push(node);
      }
      
      return result;
    } catch (error) {
      console.error('Error getting file structure:', error);
      return [];
    }
  }
}