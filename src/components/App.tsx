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
import Titlebar from './Titlebar';

// Extend StoreSchema to include all required properties for the editor and terminal
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

// Extend the Electron interface for custom IPC handlers and window controls
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
  // State for editor content
  const [editorContent, setEditorContent] = useState<string>('');
  // State for currently open files
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  // State for the active (focused) file
  const [activeFile, setActiveFile] = useState<string>('');
  // State for the current project path
  const [projectPath, setProjectPath] = useState<string>('');
  // State to show/hide the project selection dialog
  const [showProjectDialog, setShowProjectDialog] = useState<boolean>(false);
  // State for the file structure tree
  const [fileStructure, setFileStructure] = useState<FileNode[]>([]);
  // State for the terminal port
  const [terminalPort, setTerminalPort] = useState<number>(3001);
  // State to show/hide the terminal panel
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  // State for the terminal manager instance
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null);
  // State to signal app initialization
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  // State for path validity
  const [isValidPath, setIsValidPath] = useState<boolean>(false);
  // State to prevent multiple dialogs
  const [isBrowseDialogOpen, setIsBrowseDialogOpen] = useState<boolean>(false);
  // State for recent projects list
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    return store.get('recentProjects') || [];
  });
  // State for showing settings
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    console.log('App component mounted');
    // Load initial settings from store
    const theme = store.get('theme') || 'dark';
    const fontSize = store.get('fontSize') || 14;
    const fontFamily = store.get('fontFamily') || 'Consolas, monospace';
    const savedProjectPath = store.get('lastProjectPath');
    const editor = store.get('editor') || { wordWrap: true, minimap: true, lineNumbers: true };

    // Apply theme to root element
    document.documentElement.setAttribute('data-theme', theme);
    // Apply font settings to root element
    document.documentElement.style.fontSize = `${fontSize}px`;
    document.documentElement.style.fontFamily = fontFamily;

    // Load initial editor content from editor store
    if (editor?.content) {
      setEditorContent(editor.content);
    }

    // Automatically open last project if available
    if (savedProjectPath) {
      openProject(savedProjectPath);
    } else {
      // Show project dialog if no project is open
      setShowProjectDialog(true);
    }

    // Set isInitialized to true when initialization is complete
    setIsInitialized(true);
    console.log('App initialization complete');
  }, []);

  // Open a project at the given path
  const openProject = async (path: string) => {
    if (!path) return;
    try {
      // Check if the provided path is valid
      const isValid = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', path);
      if (!isValid) {
        alert('The specified path does not exist or is not a directory.');
        return;
      }
    } catch (error) {
      console.error('Error checking path validity:', error);
      alert('Error checking path validity.');
      return;
    }

    console.log('Opening project:', path);
    setProjectPath(path);
    setShowProjectDialog(false);
    store.set('lastProjectPath', path);

    // Update recent projects list
    let updated = [path, ...recentProjects.filter(p => p !== path)];
    if (updated.length > 8) updated = updated.slice(0, 8);
    setRecentProjects(updated);
    store.set('recentProjects', updated);

    try {
      // Initialize core services for the project
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

      // Initialize terminal server and services
      const terminalServer = new TerminalServer(terminalPort);
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

      // Load file structure for the project
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

  // Open the project selection dialog
  const openProjectDialog = async () => {
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

  // Create a new project with a selected directory and name
  const createNewProject = async () => {
    if (isBrowseDialogOpen) return;
    setIsBrowseDialogOpen(true);
    try {
      // Dialog to select directory for new project
      const dir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory', {
        title: 'Select directory for new project'
      });
      if (!dir) return;

      // Dialog to enter project name
      const projectName = await window.electron?.ipcRenderer.invoke('dialog:inputBox', {
        title: 'New Project',
        prompt: 'Please enter a name for the new project:',
        defaultValue: 'MyProject'
      });
      if (!projectName) return;

      // Construct new project path
      const newProjectPath = `${dir}/${projectName}`;
      try {
        // Check if the directory already exists
        const exists = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', newProjectPath);
        if (exists) {
          const overwrite = await window.electron?.ipcRenderer.invoke('dialog:showMessageBox', {
            type: 'question',
            buttons: ['Cancel', 'Overwrite'],
            title: 'Directory already exists',
            message: `The directory "${newProjectPath}" already exists. Do you want to overwrite it?`
          });
          if (!overwrite || overwrite.response !== 1) return;
        }
        // Create directory and basic structure
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', newProjectPath);
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', `${newProjectPath}/src`);
        await window.electron?.ipcRenderer.invoke('fs:createDirectory', `${newProjectPath}/assets`);
        await window.electron?.ipcRenderer.invoke('fs:writeFile', `${newProjectPath}/README.md`, `# ${projectName}\n\nA new project created with LSEditor.`);
        // Open the new project
        setProjectPath(newProjectPath);
        setIsValidPath(true);
        openProject(newProjectPath);
      } catch (error) {
        console.error('Error creating project:', error);
        alert(`Error creating project: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setIsBrowseDialogOpen(false);
    }
  };

  // Check if a given path is valid (exists and is a directory)
  const checkPathValidity = async (path: string) => {
    if (!path) {
      setIsValidPath(false);
      return;
    }
    try {
      const isValid = await window.electron?.ipcRenderer.invoke('fs:checkPathExists', path);
      setIsValidPath(!!isValid);
    } catch (error) {
      console.error('Error checking path validity:', error);
      setIsValidPath(false);
    }
  };

  // Check path validity whenever the project path changes
  useEffect(() => {
    checkPathValidity(projectPath);
  }, [projectPath]);

  // Load file content from the given file path
  const loadFileContent = async (filePath: string) => {
    if (!filePath) return;
    try {
      // Try to read file content using the new IPC handler
      let content;
      if (window.electron?.ipcRenderer.invoke) {
        content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
        if (!content) {
          // Fallback to the old IPC handler
          content = await window.electron.ipcRenderer.invoke('readFile', filePath);
        }
      }
      setEditorContent(content ?? '');
    } catch (error) {
      setEditorContent('Error loading file.');
    }
  };

  // Save file content to the given file path
  const saveFileContent = async (filePath: string, content: string) => {
    if (!filePath) return;
    try {
      let ok = false;
      if (window.electron?.ipcRenderer.invoke) {
        ok = await window.electron.ipcRenderer.invoke('fs:writeFile', filePath, content);
        if (!ok) {
          // Fallback to the old IPC handler
          ok = await window.electron.ipcRenderer.invoke('saveFile', filePath, content);
        }
      }
    } catch (error) {
      alert('Error saving file!');
    }
  };

  // Handle file open event
  const handleFileOpen = (path: string) => {
    console.log('Opening file:', path);
    setActiveFile(path);
    if (!openFiles.includes(path)) {
      setOpenFiles([...openFiles, path]);
    }
    loadFileContent(path);
  };

  // Handle editor content change
  const handleEditorChange = (value: string) => {
    setEditorContent(value);
    if (activeFile) {
      saveFileContent(activeFile, value);
    }
  };

  // Handle terminal open event
  const handleTerminalOpen = () => {
    if (terminalManager) {
      terminalManager.connect();
      setIsTerminalOpen(true);
    }
  };

  // Handle terminal close event
  const handleTerminalClose = () => {
    if (terminalManager) {
      terminalManager.disconnect();
      setIsTerminalOpen(false);
    }
  };

  // Remove a project from the recent projects list
  const removeRecentProject = (path: string) => {
    const updated = recentProjects.filter(p => p !== path);
    setRecentProjects(updated);
    store.set('recentProjects', updated);
  };

  console.log('App rendering, showProjectDialog:', showProjectDialog);

  return (
    <ThemeProvider>
      <div className="app">
        {/* SettingsIcon is now placed in the MenuBar, no separate popup */}
        {showProjectDialog ? (
          <>
            <Titlebar minimal />
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
                  title={!isValidPath ? "Please enter a valid path" : "Open project"}
                >
                  Open
                </button>
                <button 
                  onClick={openProjectDialog}
                  disabled={isBrowseDialogOpen}
                  title={isBrowseDialogOpen ? "Dialog is already open" : "Browse directory"}
                >
                  Browse...
                </button>
                <button 
                  onClick={createNewProject}
                  disabled={isBrowseDialogOpen}
                  title={isBrowseDialogOpen ? "Dialog is already open" : "Create new project"}
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
                          title="Open project"
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
                  <p>No recently opened projects.</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <Layout
            fileStructure={fileStructure}
            projectPath={projectPath}
          >
            <EditorLayout
              fileStructure={fileStructure}
              projectPath={projectPath}
              activeFile={activeFile}
              onOpenFile={handleFileOpen}
            />
          </Layout>
        )}
      </div>
    </ThemeProvider>
  );
};

export default App;