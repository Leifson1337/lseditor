import React, { useEffect, useState } from 'react';
import Layout from './Layout';
import { store, StoreSchema } from '../store/store';
import { ProjectService } from '../services/ProjectService';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { AIService } from '../services/AIService';
import { UIService } from '../services/UIService';
import { TerminalServer } from '../server/terminalServer';
import '../styles/App.css';
import { Terminal } from './Terminal';
import { TerminalContainer } from './TerminalContainer';
import { TerminalPanel } from './TerminalPanel';
import { AIConfig } from '../types/AITypes';
import { FileNode } from '../types/FileNode';
import { EditorLayout } from './EditorLayout';
import SettingsIcon from './SettingsIcon';
import { ThemeProvider } from '../contexts/ThemeContext';

// Update StoreSchema to include all required properties
declare module '../store/store' {
  interface StoreSchema {
    theme: string;
    fontSize: number;
    fontFamily: string;
    terminal: {
      fontSize: number;
      fontFamily: string;
      port: number;
      defaultProfile: string;
    };
    editor: {
      fontSize: number;
      fontFamily: string;
      wordWrap: boolean;
      minimap: boolean;
      lineNumbers: boolean;
      content?: string;
    };
    lastProjectPath?: string;
    recentProjects?: string[];
  }
}

// Erweitern der Electron-Schnittstelle für den checkPathExists-Handler
declare global {
  interface Window {
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        send: (channel: string, ...args: any[]) => void;
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
        removeListener: (channel: string, listener: (...args: any[]) => void) => void;
      };
      windowControls: {
        minimize: () => void;
        maximize: () => void;
        unmaximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximize: (callback: () => void) => void;
        onUnmaximize: (callback: () => void) => void;
        removeMaximizeListener: (callback: () => void) => void;
        removeUnmaximizeListener: (callback: () => void) => void;
      };
    };
  }
}

const App: React.FC = () => {
  const [editorContent, setEditorContent] = useState<string>('');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [projectPath, setProjectPath] = useState<string>('');
  const [showProjectDialog, setShowProjectDialog] = useState<boolean>(false);
  const [fileStructure, setFileStructure] = useState<FileNode[]>([]);
  const [terminalPort, setTerminalPort] = useState<number>(3001);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isValidPath, setIsValidPath] = useState<boolean>(false);
  const [isBrowseDialogOpen, setIsBrowseDialogOpen] = useState<boolean>(false);
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    return store.get('recentProjects') || [];
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    console.log('App component mounted');
    // Load initial settings from store
    const theme = store.get('theme') || 'dark';
    const fontSize = store.get('fontSize') || 14;
    const fontFamily = store.get('fontFamily') || 'Consolas, monospace';
    const savedProjectPath = store.get('lastProjectPath');
    const editor = store.get('editor') || { wordWrap: true, minimap: true, lineNumbers: true };

    // Apply theme
    document.documentElement.setAttribute('data-theme', theme);
    
    // Apply font settings
    document.documentElement.style.fontSize = `${fontSize}px`;
    document.documentElement.style.fontFamily = fontFamily;

    // Load initial editor content from editor store
    if (editor?.content) {
      setEditorContent(editor.content);
    }

    // If there's a saved project path, open it automatically
    if (savedProjectPath) {
      openProject(savedProjectPath);
    } else {
      // If no project is open, show the project dialog
      setShowProjectDialog(true);
    }

    // Set isInitialized to true when initialization is complete
    setIsInitialized(true);
    console.log('App initialization complete');
  }, []);

  const openProject = async (path: string) => {
    if (!path) return;
    
    // Überprüfen, ob der Pfad gültig ist
    try {
      const isValid = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', path);
      if (!isValid) {
        alert('Der angegebene Pfad existiert nicht oder ist kein Verzeichnis.');
        return;
      }
    } catch (error) {
      console.error('Fehler beim Überprüfen des Pfades:', error);
      alert('Fehler beim Überprüfen des Pfades.');
      return;
    }
    
    console.log('Opening project:', path);
    setProjectPath(path);
    setShowProjectDialog(false);
    store.set('lastProjectPath', path);

    // Recent Projects aktualisieren
    let updated = [path, ...recentProjects.filter(p => p !== path)];
    if (updated.length > 8) updated = updated.slice(0, 8);
    setRecentProjects(updated);
    store.set('recentProjects', updated);

    try {
      // Initialize services
      const projectService = new ProjectService(path);
      const uiService = new UIService();
      const aiService = AIService.getInstance({
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
      });

      // Initialize terminal server
      const terminalServer = new TerminalServer(terminalPort);

      // Initialize terminal service
      const terminalService = TerminalService.getInstance(
        null,
        aiService,
        projectService,
        uiService,
        terminalServer,
        store
      );

      // Initialize terminal manager
      const manager = new TerminalManager(
        terminalPort,
        terminalService,
        aiService,
        projectService,
        uiService
      );
      setTerminalManager(manager);

      // Load file structure
      try {
        const structure = await projectService.getFileStructure(path);
        console.log('File structure loaded:', structure);
        setFileStructure(structure);
      } catch (error) {
        console.error('Error loading file structure:', error);
        // Set a default empty structure if loading fails
        setFileStructure([]);
      }
    } catch (error) {
      console.error('Error initializing project:', error);
      // Show error in UI
      alert(`Failed to open project: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openProjectDialog = async () => {
    // Verhindern, dass mehrere Dialoge geöffnet werden
    if (isBrowseDialogOpen) return;
    
    setIsBrowseDialogOpen(true);
    try {
      const dir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory');
      if (dir) {
        setProjectPath(dir);
        setIsValidPath(true);
      }
    } finally {
      setIsBrowseDialogOpen(false);
    }
  };

  // Funktion zum Erstellen eines neuen Projekts
  const createNewProject = async () => {
    // Verhindern, dass mehrere Dialoge geöffnet werden
    if (isBrowseDialogOpen) return;
    
    setIsBrowseDialogOpen(true);
    try {
      // Dialog zum Auswählen des Verzeichnisses für das neue Projekt
      const dir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory', {
        title: 'Verzeichnis für neues Projekt auswählen'
      });
      
      if (!dir) return;
      
      // Dialog zum Eingeben des Projektnamens
      const projectName = await window.electron?.ipcRenderer.invoke('dialog:inputBox', {
        title: 'Neues Projekt',
        prompt: 'Bitte geben Sie einen Namen für das neue Projekt ein:',
        defaultValue: 'MeinProjekt'
      });
      
      if (!projectName) return;
      
      // Pfad für das neue Projekt erstellen
      const newProjectPath = `${dir}/${projectName}`;
      
      try {
        // Überprüfen, ob das Verzeichnis bereits existiert
        const exists = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', newProjectPath);
        
        if (exists) {
          const overwrite = await window.electron?.ipcRenderer.invoke('dialog:showMessageBox', {
            type: 'question',
            buttons: ['Abbrechen', 'Überschreiben'],
            title: 'Verzeichnis existiert bereits',
            message: `Das Verzeichnis "${newProjectPath}" existiert bereits. Möchten Sie es überschreiben?`
          });
          
          if (!overwrite || overwrite.response !== 1) return;
        }
        
        // Verzeichnis erstellen
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', newProjectPath);
        
        // Grundlegende Projektstruktur erstellen
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', `${newProjectPath}/src`);
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', `${newProjectPath}/assets`);
        await window.electron?.ipcRenderer.invoke('fs:writeFile', `${newProjectPath}/README.md`, `# ${projectName}\n\nEin neues Projekt erstellt mit LSEditor.`);
        
        // Projekt öffnen
        setProjectPath(newProjectPath);
        setIsValidPath(true);
        openProject(newProjectPath);
      } catch (error) {
        console.error('Fehler beim Erstellen des Projekts:', error);
        alert(`Fehler beim Erstellen des Projekts: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setIsBrowseDialogOpen(false);
    }
  };

  const checkPathValidity = async (path: string) => {
    if (!path) {
      setIsValidPath(false);
      return;
    }
    
    try {
      const isValid = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', path);
      setIsValidPath(!!isValid);
    } catch (error) {
      console.error('Fehler beim Überprüfen des Pfades:', error);
      setIsValidPath(false);
    }
  };

  // Überprüfe Pfadgültigkeit, wenn sich der Pfad ändert
  useEffect(() => {
    checkPathValidity(projectPath);
  }, [projectPath]);

  const loadFileContent = async (filePath: string) => {
    if (!filePath) return;
    try {
      // Versuche zuerst neuen Handler
      let content;
      if (window.electron?.ipcRenderer.invoke) {
        // Erst mit neuem Namensraum versuchen
        content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
        if (!content) {
          // Fallback auf alten Handler
          content = await window.electron.ipcRenderer.invoke('readFile', filePath);
        }
      }
      setEditorContent(content ?? '');
    } catch (error) {
      setEditorContent('Fehler beim Laden der Datei.');
    }
  };

  const saveFileContent = async (filePath: string, content: string) => {
    if (!filePath) return;
    try {
      let ok = false;
      if (window.electron?.ipcRenderer.invoke) {
        ok = await window.electron.ipcRenderer.invoke('fs:writeFile', filePath, content);
        if (!ok) {
          // Fallback auf alten Handler
          ok = await window.electron.ipcRenderer.invoke('saveFile', filePath, content);
        }
      }
    } catch (error) {
      alert('Fehler beim Speichern der Datei!');
    }
  };

  const handleFileOpen = (path: string) => {
    console.log('Opening file:', path);
    setActiveFile(path);
    if (!openFiles.includes(path)) {
      setOpenFiles([...openFiles, path]);
    }
    loadFileContent(path);
  };

  const handleEditorChange = (value: string) => {
    setEditorContent(value);
    if (activeFile) {
      saveFileContent(activeFile, value);
    }
  };

  const handleTerminalOpen = () => {
    if (terminalManager) {
      terminalManager.connect();
      setIsTerminalOpen(true);
    }
  };

  const handleTerminalClose = () => {
    if (terminalManager) {
      terminalManager.disconnect();
      setIsTerminalOpen(false);
    }
  };

  const removeRecentProject = (path: string) => {
    const updated = recentProjects.filter(p => p !== path);
    setRecentProjects(updated);
    store.set('recentProjects', updated);
  };

  console.log('App rendering, showProjectDialog:', showProjectDialog);
  
  return (
    <ThemeProvider>
      <div className="app">
        {/* SettingsIcon wird jetzt im MenuBar platziert, kein separates Popup mehr */}
        {showProjectDialog ? (
          <div className="project-dialog">
            <h2>Open Project</h2>
            <div className="project-input">
              <input 
                type="text" 
                placeholder="Enter project path..." 
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
              />
              <button 
                onClick={() => openProject(projectPath)} 
                disabled={!isValidPath}
                title={!isValidPath ? "Bitte geben Sie einen gültigen Pfad an" : "Projekt öffnen"}
              >
                Open
              </button>
              <button 
                onClick={openProjectDialog}
                disabled={isBrowseDialogOpen}
                title={isBrowseDialogOpen ? "Dialog ist bereits geöffnet" : "Verzeichnis durchsuchen"}
              >
                Browse...
              </button>
              <button 
                onClick={createNewProject}
                disabled={isBrowseDialogOpen}
                title={isBrowseDialogOpen ? "Dialog ist bereits geöffnet" : "Neues Projekt erstellen"}
              >
                New Project
              </button>
            </div>
            <div className="recent-projects">
              <h3>Recently opened projects</h3>
              {recentProjects.length > 0 ? (
                <ul>
                  {recentProjects.map((project) => (
                    <li key={project} style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis'}}>{project}</span>
                      <button 
                        onClick={() => openProject(project)}
                        title="Projekt öffnen"
                      >
                        Open
                      </button>
                      <button 
                        title="Remove from list" 
                        onClick={() => removeRecentProject(project)} 
                        style={{color:'red'}}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Keine kürzlich geöffneten Projekte vorhanden.</p>
              )}
            </div>
          </div>
        ) : (
          <Layout
            fileStructure={fileStructure}
            projectPath={projectPath}
          >
            <EditorLayout
              fileStructure={fileStructure}
              projectPath={projectPath}
            />
          </Layout>
        )}
      </div>
    </ThemeProvider>
  );
};

export default App; 