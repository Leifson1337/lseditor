import { EventEmitter } from '../utils/EventEmitter';

// Sichere ipcRenderer-Initialisierung
// ipcRenderer wird verwendet, um IPC-Aufrufe an den Hauptprozess zu senden
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
// Diese Funktion prüft, ob ipcRenderer verfügbar ist, bevor ein IPC-Aufruf durchgeführt wird
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
}

// Interface für Verzeichniseinträge
// Ein Verzeichniseintrag kann ein Datei- oder Verzeichnisobjekt sein
export interface DirectoryEntry {
  name: string;            // Name des Eintrags
  path: string;            // Pfad des Eintrags
  isDirectory: boolean;    // Gibt an, ob der Eintrag ein Verzeichnis ist
  children?: DirectoryEntry[]; // Unterordnete Einträge (nur für Verzeichnisse)
  size?: number;           // Größe des Eintrags (nur für Dateien)
  modified?: Date;         // Letztes Änderungsdatum des Eintrags
}

// ProjectService-Klasse
// Diese Klasse verwaltet den Zugriff auf Projekte und Dateien im Workspace
export class ProjectService extends EventEmitter {
  private workspacePath: string; // Pfad zum Workspace
  private currentProject: string | null = null; // Aktuelles Projekt
  
  /**
   * Konstruktor für die ProjectService-Klasse
   * @param workspacePath Pfad zum Workspace
   */
  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.initialize().catch(err => {
      console.error('Failed to initialize project service:', err);
    });
  }
  
  // Initialisiert den ProjectService
  private async initialize() {
    // Lade Projekteinstellungen
    await this.loadSettings();
  }
  
  // Lädt die Projekteinstellungen
  private async loadSettings() {
    try {
      // Lade Verzeichnisstruktur
      const entries = await this.safeGetDirectoryEntries(this.workspacePath);
      this.emit('directoryLoaded', entries);
    } catch (error) {
      console.error('Error loading project settings:', error);
    }
  }
  
  /**
   * Gibt die Verzeichniseinträge für den angegebenen Pfad zurück
   * @param dirPath Pfad zum Verzeichnis
   * @returns Array von Verzeichniseinträgen
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
  
  // Gibt die Verzeichniseinträge für den angegebenen Pfad zurück, mit Fehlertoleranz
  private async safeGetDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
    try {
      return await this.getDirectoryEntries(dirPath);
    } catch (error: any) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
        // Systemdatei oder Zugriff verweigert: einfach ignorieren
        return [];
      }
      console.error('Error getting directory entries:', error);
      return [];
    }
  }

  /**
   * Liest den Inhalt einer Datei
   * @param filePath Pfad zur Datei
   * @returns Inhalt der Datei als String
   */
  public async getFileContent(filePath: string): Promise<string> {
    try {
      return await safeIpcInvoke('fs:readFile', filePath);
    } catch (error) {
      console.error('Error reading file:', error);
      return '';
    }
  }
  
  /**
   * Speichert den Inhalt einer Datei
   * @param filePath Pfad zur Datei
   * @param content Inhalt der Datei als String
   */
  public async saveFile(filePath: string, content: string): Promise<void> {
    try {
      await safeIpcInvoke('fs:writeFile', filePath, content);
      this.emit('fileSaved', filePath);
    } catch (error) {
      console.error('Error saving file:', error);
    }
  }
  
  /**
   * Erstellt eine neue Datei
   * @param filePath Pfad zur Datei
   * @param content Inhalt der Datei als String (optional)
   */
  public async createFile(filePath: string, content: string = ''): Promise<void> {
    try {
      await safeIpcInvoke('fs:writeFile', filePath, content);
      this.emit('fileCreated', filePath);
    } catch (error) {
      console.error('Error creating file:', error);
    }
  }
  
  /**
   * Erstellt ein neues Verzeichnis
   * @param dirPath Pfad zum Verzeichnis
   */
  public async createDirectory(dirPath: string): Promise<void> {
    try {
      await safeIpcInvoke('fs:createDirectory', dirPath);
      this.emit('directoryCreated', dirPath);
    } catch (error) {
      console.error('Error creating directory:', error);
    }
  }
  
  /**
   * Löscht eine Datei
   * @param filePath Pfad zur Datei
   */
  public async deleteFile(filePath: string): Promise<void> {
    try {
      await safeIpcInvoke('fs:deleteFile', filePath);
      this.emit('fileDeleted', filePath);
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }
  
  /**
   * Löscht ein Verzeichnis
   * @param dirPath Pfad zum Verzeichnis
   */
  public async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await safeIpcInvoke('fs:deleteDirectory', dirPath);
      this.emit('directoryDeleted', dirPath);
    } catch (error) {
      console.error('Error deleting directory:', error);
    }
  }
  
  /**
   * Umbenennung einer Datei
   * @param oldPath Alter Pfad zur Datei
   * @param newPath Neuer Pfad zur Datei
   */
  public async renameFile(oldPath: string, newPath: string): Promise<void> {
    try {
      await safeIpcInvoke('fs:renameFile', oldPath, newPath);
      this.emit('fileRenamed', { oldPath, newPath });
    } catch (error) {
      console.error('Error renaming file:', error);
    }
  }
  
  // Gibt den Workspace-Pfad zurück
  public getWorkspacePath(): string {
    return this.workspacePath;
  }
  
  // Setzt den Workspace-Pfad
  public setWorkspacePath(path: string): void {
    this.workspacePath = path;
    this.emit('workspaceChanged', path);
    this.loadSettings().catch(err => {
      console.error('Error reloading settings after workspace change:', err);
    });
  }

  // Fehlende Methoden hinzufügen, die in app.ts und App.tsx verwendet werden
  /**
   * Setzt das aktuelle Projekt
   * @param projectPath Pfad zum Projekt
   */
  public setProject(projectPath: string): void {
    this.currentProject = projectPath;
    this.emit('projectChanged', projectPath);
  }

  /**
   * Schließt das aktuelle Projekt
   */
  public closeProject(): void {
    this.currentProject = null;
    this.emit('projectClosed');
  }

  /**
   * Gibt die Dateistruktur für den angegebenen Pfad zurück
   * @param dirPath Pfad zum Verzeichnis
   * @returns Array von Dateieinträgen
   */
  public async getFileStructure(dirPath: string): Promise<any[]> {
    try {
      const entries = await this.safeGetDirectoryEntries(dirPath);
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
    } catch (error: any) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
        // Systemdatei oder Zugriff verweigert: einfach ignorieren
        return [];
      }
      console.error('Error getting file structure:', error);
      return [];
    }
  }
}
