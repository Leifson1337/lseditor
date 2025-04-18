import { EventEmitter } from 'events';

// Sichere ipcRenderer-Initialisierung, funktioniert nur im Renderer
let ipcRenderer: typeof import('electron').ipcRenderer | null = null;
if (typeof window !== 'undefined' && window.require) {
  ipcRenderer = window.require('electron').ipcRenderer;
}

export interface ProjectSettings {
  name: string;
  rootPath: string;
  gitEnabled: boolean;
  excludePatterns: string[];
  maxRecentFiles: number;
  recentFiles: string[];
}

interface ProjectFile {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: ProjectFile[];
}

export class ProjectService extends EventEmitter {
  private currentProject: string | null = null;
  private settings: ProjectSettings;
  private watcher: any | null = null;
  private isInitialized: boolean = false;
  private fileWatchers: Map<string, any> = new Map();
  private gitStatus: Map<string, string> = new Map();
  private gitDiffs: Map<string, string> = new Map();
  private workspacePath: string;
  private projectName: string;
  private projectType: string;

  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.projectName = this.detectProjectType();
    this.projectType = this.detectProjectType();
    this.settings = {
      name: '',
      rootPath: '',
      gitEnabled: false,
      excludePatterns: [],
      maxRecentFiles: 10,
      recentFiles: []
    };
    this.initialize().catch(error => {
      console.error('Failed to initialize project service:', error);
      this.emit('error', error);
    });
  }

  private async initialize(): Promise<void> {
    await this.loadSettings();
    this.isInitialized = true;
  }

  private async loadSettings(): Promise<void> {
    try {
      const settingsPath = await this.getDirectoryEntries(this.settings.rootPath);
      const settingsFile = settingsPath.find((entry: any) => entry.name === '.project.json');
      if (settingsFile) {
        const settingsContent = await this.getFileContent(joinPath(this.settings.rootPath, '.project.json'));
        this.settings = { ...this.settings, ...JSON.parse(settingsContent) };
      }
      this.emit('projectLoaded', this.settings);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  public async getDirectoryEntries(dirPath: string) {
    if (!ipcRenderer) throw new Error('ipcRenderer not available');
    return ipcRenderer.invoke('fs:readDir', dirPath);
  }

  public async getFileContent(filePath: string): Promise<string> {
    const ipc = ipcRenderer;
    if (!ipc) throw new Error('ipcRenderer not available');
    return ipc.invoke('fs:readFile', filePath);
  }

  public async saveFile(filePath: string, content: string): Promise<void> {
    const ipc = ipcRenderer;
    if (!ipc) throw new Error('ipcRenderer not available');
    await ipc.invoke('fs:writeFile', filePath, content);
    this.emit('fileSaved', filePath);
  }

  public getSettings(): ProjectSettings {
    return { ...this.settings };
  }

  public async updateSettings(settings: Partial<ProjectSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    const settingsPath = joinPath(this.settings.rootPath, '.project.json');
    const ipc = ipcRenderer;
    if (!ipc) throw new Error('ipcRenderer not available');
    await ipc.invoke('fs:writeFile', settingsPath, JSON.stringify(this.settings, null, 2));
    this.emit('settingsUpdated', this.settings);
  }

  public getFileTree(): ProjectFile[] {
    const tree: ProjectFile[] = [];
    this.buildFileTree(this.settings.rootPath, tree);
    return tree;
  }

  private buildFileTree(dirPath: string, tree: ProjectFile[]): void {
    this.getDirectoryEntries(dirPath).then(entries => {
      for (const entry of entries) {
        const relative = relativePath(this.settings.rootPath, entry.path);
        
        if (this.settings.excludePatterns.some((pattern: string) => 
          new RegExp(pattern).test(relative))) {
          continue;
        }

        const file: ProjectFile = {
          path: relative,
          name: entry.name,
          type: entry.isDirectory ? 'directory' : 'file'
        };

        if (entry.isDirectory) {
          file.children = [];
          this.buildFileTree(entry.path, file.children);
        }

        tree.push(file);
      }
    });
  }

  public async getGitStatus(): Promise<Map<string, string>> {
    if (!this.settings.gitEnabled) {
      return new Map();
    }

    try {
      // Implement Git status check
      // This is a placeholder for actual Git integration
      return this.gitStatus;
    } catch (error) {
      console.error('Error getting Git status:', error);
      return new Map();
    }
  }

  public async getGitDiff(filePath?: string): Promise<string> {
    if (!this.settings.gitEnabled) {
      return '';
    }

    try {
      // Implement Git diff
      // This is a placeholder for actual Git integration
      return this.gitDiffs.get(filePath || '') || '';
    } catch (error) {
      console.error('Error getting Git diff:', error);
      return '';
    }
  }

  public addRecentFile(filePath: string): void {
    const index = this.settings.recentFiles.indexOf(filePath);
    if (index !== -1) {
      this.settings.recentFiles.splice(index, 1);
    }
    
    this.settings.recentFiles.unshift(filePath);
    
    if (this.settings.recentFiles.length > this.settings.maxRecentFiles) {
      this.settings.recentFiles.pop();
    }

    this.emit('recentFilesUpdated', this.settings.recentFiles);
  }

  public getRecentFiles(): string[] {
    return this.settings.recentFiles;
  }

  public searchFiles(query: string): ProjectFile[] {
    const results: ProjectFile[] = [];
    this.searchInDirectory(this.settings.rootPath, query, results);
    return results;
  }

  private searchInDirectory(dirPath: string, query: string, results: ProjectFile[]): void {
    this.getDirectoryEntries(dirPath).then(entries => {
      for (const entry of entries) {
        const relative = relativePath(this.settings.rootPath, entry.path);
        
        if (this.settings.excludePatterns.some((pattern: string) => 
          new RegExp(pattern).test(relative))) {
          continue;
        }

        if (entry.name.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            path: relative,
            name: entry.name,
            type: entry.isDirectory ? 'directory' : 'file'
          });
        }

        if (entry.isDirectory) {
          this.searchInDirectory(entry.path, query, results);
        }
      }
    });
  }

  public watchFile(filePath: string, callback: (event: string, filename: string) => void): void {
    if (!ipcRenderer) throw new Error('ipcRenderer not available');
    ipcRenderer.on('fs:changed', (_event, eventType: string, changedPath: string) => {
      if (changedPath === filePath) {
        callback(eventType, changedPath);
      }
    });
    this.fileWatchers.set(filePath, true);
  }

  public unwatchFile(filePath: string): void {
    if (!ipcRenderer) return;
    ipcRenderer.removeListener('fs:changed', (_event, eventType: string, changedPath: string) => {
      if (changedPath === filePath) {
        // callback(eventType, changedPath);
      }
    });
    this.fileWatchers.delete(filePath);
  }

  public setProject(projectPath: string): void {
    this.currentProject = projectPath;
    this.emit('projectChanged', projectPath);
  }

  public closeProject(): void {
    this.currentProject = null;
    this.emit('projectClosed');
  }

  public getWorkspacePath(): string {
    return this.workspacePath;
  }

  private detectProjectType(): string {
    // Implement project type detection logic here
    return 'unknown';
  }

  public async getFileStructure(dirPath: string): Promise<any[]> {
    const entries = await this.getDirectoryEntries(dirPath);
    const nodes: any[] = [];

    for (const entry of entries) {
      const fullPath = entry.path;
      const node: any = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory ? 'directory' : 'file'
      };

      if (entry.isDirectory) {
        node.children = await this.getFileStructure(fullPath);
      }

      nodes.push(node);
    }

    return nodes;
  }
}

// Hilfsfunktionen für Pfadoperationen im Renderer
function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/');
}

function relativePath(from: string, to: string): string {
  if (to.startsWith(from)) {
    let rel = to.slice(from.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return to;
}