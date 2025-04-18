import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

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
  private watcher: chokidar.FSWatcher | null = null;
  private isInitialized: boolean = false;
  private fileWatchers: Map<string, chokidar.FSWatcher> = new Map();
  private gitStatus: Map<string, string> = new Map();
  private gitDiffs: Map<string, string> = new Map();
  private workspacePath: string;
  private projectName: string;
  private projectType: string;

  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.projectName = path.basename(workspacePath);
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
      const settingsPath = path.join(this.settings.rootPath, '.project.json');
      if (fs.existsSync(settingsPath)) {
        const settingsContent = await fs.promises.readFile(settingsPath, 'utf-8');
        this.settings = { ...this.settings, ...JSON.parse(settingsContent) };
      }
      this.emit('projectLoaded', this.settings);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  public async getFileContent(filePath: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Project not initialized');
    }

    try {
      const fullPath = path.join(this.settings.rootPath, filePath);
      return await fs.promises.readFile(fullPath, 'utf-8');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  public async saveFile(filePath: string, content: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Project not initialized');
    }

    try {
      const fullPath = path.join(this.settings.rootPath, filePath);
      await fs.promises.writeFile(fullPath, content, 'utf-8');
      this.emit('fileSaved', filePath);
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  public getSettings(): ProjectSettings {
    return { ...this.settings };
  }

  public async updateSettings(settings: Partial<ProjectSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    const settingsPath = path.join(this.settings.rootPath, '.project.json');
    await fs.promises.writeFile(settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    this.emit('settingsUpdated', this.settings);
  }

  public getFileTree(): ProjectFile[] {
    const tree: ProjectFile[] = [];
    this.buildFileTree(this.settings.rootPath, tree);
    return tree;
  }

  private buildFileTree(dirPath: string, tree: ProjectFile[]): void {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.relative(this.settings.rootPath, fullPath);
      
      if (this.settings.excludePatterns.some((pattern: string) => 
        new RegExp(pattern).test(relativePath))) {
        continue;
      }

      const stats = fs.statSync(fullPath);
      const file: ProjectFile = {
        path: relativePath,
        name: item,
        type: stats.isDirectory() ? 'directory' : 'file'
      };

      if (stats.isDirectory()) {
        file.children = [];
        this.buildFileTree(fullPath, file.children);
      }

      tree.push(file);
    }
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
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.relative(this.settings.rootPath, fullPath);
      
      if (this.settings.excludePatterns.some((pattern: string) => 
        new RegExp(pattern).test(relativePath))) {
        continue;
      }

      if (item.toLowerCase().includes(query.toLowerCase())) {
        const stats = fs.statSync(fullPath);
        results.push({
          path: relativePath,
          name: item,
          type: stats.isDirectory() ? 'directory' : 'file'
        });
      }

      if (fs.statSync(fullPath).isDirectory()) {
        this.searchInDirectory(fullPath, query, results);
      }
    }
  }

  public watchFile(filePath: string, callback: (event: string, filename: string) => void): void {
    const fullPath = path.join(this.settings.rootPath, filePath);
    const watcher = chokidar.watch(fullPath);
    
    watcher.on('change', (path) => callback('change', path));
    watcher.on('add', (path) => callback('add', path));
    watcher.on('unlink', (path) => callback('unlink', path));
    
    this.fileWatchers.set(filePath, watcher);
  }

  public unwatchFile(filePath: string): void {
    const watcher = this.fileWatchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(filePath);
    }
  }

  public dispose(): void {
    this.fileWatchers.forEach(watcher => watcher.close());
    this.fileWatchers.clear();
    this.gitStatus.clear();
    this.gitDiffs.clear();
    this.removeAllListeners();
  }

  private startFileWatcher(projectPath: string): void {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = chokidar.watch(projectPath, {
      ignored: this.settings.excludePatterns,
      persistent: true
    });

    this.watcher
      .on('add', (filePath: string) => {
        this.emit('fileAdded', filePath);
      })
      .on('change', (filePath: string) => {
        this.emit('fileChanged', filePath);
      })
      .on('unlink', (filePath: string) => {
        this.emit('fileDeleted', filePath);
      });
  }

  private stopFileWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  public setProject(projectPath: string): void {
    this.currentProject = projectPath;
    this.startFileWatcher(projectPath);
    this.emit('projectChanged', projectPath);
  }

  public closeProject(): void {
    this.stopFileWatcher();
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
} 