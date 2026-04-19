import { EventEmitter } from '../utils/EventEmitter';

// Safe ipcRenderer initialization
// ipcRenderer is used to send IPC calls to the main process
let ipcRenderer: any = null;
// Check if we're in the renderer process (window exists)
const isRenderer = typeof window !== 'undefined';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in ProjectService', e);
}

// Helper for safe IPC calls
// Checks that ipcRenderer is available before invoking IPC
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
}

function assertFsOk(result: unknown, fallbackMessage: string): void {
  if (result && typeof result === 'object' && 'ok' in result && !(result as { ok: boolean }).ok) {
    throw new Error((result as { error?: string }).error || fallbackMessage);
  }
}

// Interface for directory entries
// A directory entry can represent a file or directory
export interface DirectoryEntry {
  name: string;            // Entry name
  path: string;            // Entry path
  isDirectory: boolean;    // Whether the entry is a directory
  isSymbolicLink?: boolean; // Whether the entry is a symlink/junction
  children?: DirectoryEntry[]; // Child entries (directories only)
  size?: number;           // Size (files only)
  modified?: Date;         // Last modified time
}

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.yarn',
  '.pnpm-store',
  '.idea',
  '.vs',
  '.venv',
  'venv',
  '__pycache__',
  'target'
]);

// ProjectService class
// Manages access to projects and files in the workspace
export class ProjectService extends EventEmitter {
  private workspacePath: string; // Workspace path
  private currentProject: string | null = null; // Current project
  
  /**
   * ProjectService constructor
   * @param workspacePath Workspace path
   */
  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.initialize().catch(err => {
      console.error('Failed to initialize project service:', err);
    });
  }
  
  // Initializes ProjectService
  private async initialize() {
    // Load project settings
    await this.loadSettings();
  }
  
  // Loads project settings
  private async loadSettings() {
    try {
      // Load directory structure
      const entries = await this.safeGetDirectoryEntries(this.workspacePath);
      this.emit('directoryLoaded', entries);
    } catch (error) {
      console.error('Error loading project settings:', error);
    }
  }
  
  /**
   * Returns directory entries for the given path
   * @param dirPath Directory path
   * @returns Array of directory entries
   */
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
  
  // Returns directory entries for the path with error tolerance
  private async safeGetDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
    try {
      return await this.getDirectoryEntries(dirPath);
    } catch (error: any) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
        // System file or access denied: ignore
        return [];
      }
      console.error('Error getting directory entries:', error);
      return [];
    }
  }

  /**
   * Reads file contents
   * @param filePath File path
   * @returns File contents as string
   */
  public async getFileContent(filePath: string): Promise<string> {
    try {
      const content = await safeIpcInvoke('fs:readFile', filePath);
      return typeof content === 'string' ? content : '';
    } catch (error) {
      console.error('Error reading file:', error);
      return '';
    }
  }
  
  /**
   * Saves file contents
   * @param filePath File path
   * @param content File contents as string
   */
  public async saveFile(filePath: string, content: string): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:writeFile', filePath, content);
      assertFsOk(res, 'Failed to save file');
      this.emit('fileSaved', filePath);
    } catch (error) {
      console.error('Error saving file:', error);
    }
  }
  
  /**
   * Creates a new file
   * @param filePath File path
   * @param content File contents (optional)
   */
  public async createFile(filePath: string, content: string = ''): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:writeFile', filePath, content);
      assertFsOk(res, 'Failed to create file');
      this.emit('fileCreated', filePath);
    } catch (error) {
      console.error('Error creating file:', error);
    }
  }
  
  /**
   * Creates a new directory
   * @param dirPath Directory path
   */
  public async createDirectory(dirPath: string): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:createDirectory', dirPath);
      assertFsOk(res, 'Failed to create directory');
      this.emit('directoryCreated', dirPath);
    } catch (error) {
      console.error('Error creating directory:', error);
    }
  }
  
  /**
   * Deletes a file
   * @param filePath File path
   */
  public async deleteFile(filePath: string): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:deleteFile', filePath);
      assertFsOk(res, 'Failed to delete file');
      this.emit('fileDeleted', filePath);
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }
  
  /**
   * Deletes a directory
   * @param dirPath Directory path
   */
  public async deleteDirectory(dirPath: string): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:deleteDirectory', dirPath);
      assertFsOk(res, 'Failed to delete directory');
      this.emit('directoryDeleted', dirPath);
    } catch (error) {
      console.error('Error deleting directory:', error);
    }
  }
  
  /**
   * Renames a file
   * @param oldPath Old file path
   * @param newPath New file path
   */
  public async renameFile(oldPath: string, newPath: string): Promise<void> {
    try {
      const res = await safeIpcInvoke('fs:renameFile', oldPath, newPath);
      assertFsOk(res, 'Failed to rename file');
      this.emit('fileRenamed', { oldPath, newPath });
    } catch (error) {
      console.error('Error renaming file:', error);
    }
  }
  
  // Returns the workspace path
  public getWorkspacePath(): string {
    return this.workspacePath;
  }
  
  // Sets the workspace path
  public setWorkspacePath(path: string): void {
    this.workspacePath = path;
    this.emit('workspaceChanged', path);
    this.loadSettings().catch(err => {
      console.error('Error reloading settings after workspace change:', err);
    });
  }

  // Methods used by app.ts and App.tsx
  /**
   * Sets the current project
   * @param projectPath Project path
   */
  public setProject(projectPath: string): void {
    this.currentProject = projectPath;
    this.emit('projectChanged', projectPath);
  }

  /**
   * Closes the current project
   */
  public closeProject(): void {
    this.currentProject = null;
    this.emit('projectClosed');
  }

  /**
   * Returns the file tree for the given path
   * @param dirPath Directory path
   * @returns Array of file entries
   */
  public async getFileStructure(dirPath: string): Promise<any[]> {
    try {
      const entries = await this.safeGetDirectoryEntries(dirPath);
      const result: any[] = [];
      const filteredEntries = entries
        .filter(entry => !entry.isSymbolicLink)
        .filter(entry => !(entry.isDirectory && IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())))
        .sort((a, b) => {
          if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          }
          return a.isDirectory ? -1 : 1;
        });
      
      for (const entry of filteredEntries) {
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
    } catch (error: any) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
        // System file or access denied: ignore
        return [];
      }
      console.error('Error getting file structure:', error);
      return [];
    }
  }
}
