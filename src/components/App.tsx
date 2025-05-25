import React, { useEffect, useState } from 'react';
import Layout from './Layout';
import { store, StoreSchema } from '../store/store';
import { ProjectService } from '../services/ProjectService';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { AIService } from '../services/AIService';
import { UIService } from '../services/UIService';
import { PluginService } from '../services/PluginService';
import { CommandService } from '../services/CommandService';
import { ViewService } from '../services/ViewService';
import { ProviderService } from '../services/ProviderService'; // Import ProviderService
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
import { ServiceProvider, ServiceContextType } from '../contexts/ServiceContext'; // Import ServiceProvider
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
  const [isValidPath, setIsValidPath] = useState<boolean>(false);
  const [isBrowseDialogOpen, setIsBrowseDialogOpen] = useState<boolean>(false);
  const [recentProjects, setRecentProjects] = useState<string[]>(() => store.get('recentProjects') || []);
  const [showSettings, setShowSettings] = useState(false);

  // States for services
  const [projectService, setProjectService] = useState<ProjectService | null>(null);
  const [aiService, setAiService] = useState<AIService | null>(null);
  // terminalManager is already in state
  const [terminalService, setTerminalService] = useState<TerminalService | null>(null);
  const [uiService, setUiService] = useState<UIService | null>(null);
  const [pluginService, setPluginService] = useState<PluginService | null>(null); 
  const [commandService, setCommandService] = useState<CommandService | null>(null); 
  const [viewService, setViewService] = useState<ViewService | null>(null); 
  const [providerService, setProviderService] = useState<ProviderService | null>(null); // Added ProviderService state
  const [appStore, setAppStore] = useState<typeof store | null>(null); 

  useEffect(() => {
    console.log('App component mounted');
    setAppStore(store); // Set the global store instance to state
    // Load initial settings from store
    const theme = store.get('theme') || 'dark';
    const fontSize = store.get('fontSize') || 14;
    const fontFamily = store.get('fontFamily') || 'Consolas, monospace';
    const savedProjectPath = store.get('lastProjectPath');
    const editor = store.get('editor') || { wordWrap: true, minimap: true, lineNumbers: true };
    const savedOpenAIApiKey = store.get('openai_api_key');

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
      const newProjectService = new ProjectService(path);
      const newUiService = new UIService();
      
      // Initial AIConfig, can still use process.env as a fallback if no stored key
      const initialAIConfig: AIConfig = {
        useLocalModel: false,
        model: 'gpt-3.5-turbo', // Default model
        temperature: 0.7,
        maxTokens: 2048,
        contextWindow: 4096,
        stopSequences: ['\n\n', '```'],
        topP: 1,
        openAIConfig: {
          apiKey: savedOpenAIApiKey || process.env.OPENAI_API_KEY || '', // Prioritize stored key
          model: 'gpt-3.5-turbo',
          temperature: 0.7,
          maxTokens: 2048
        }
        // Ensure other AIConfig properties are included if they exist in your type
      };
      const newAiService = AIService.getInstance(initialAIConfig);
      
      // If a key was loaded from store, explicitly set it in AIService to ensure it's preferred
      // and potentially re-initializes the OpenAI client if AIService logic requires it.
      // AIService.setOpenAIApiKey will also update its internal config.
      if (savedOpenAIApiKey) {
        newAiService.setOpenAIApiKey(savedOpenAIApiKey);
      }
      
      setProjectService(newProjectService);
      setUiService(newUiService);
      setAiService(newAiService);
      
      // Initialize PluginService
      // TODO: Define actual pluginDirectory and marketplaceUrl, possibly from config/store
      const pluginDir = 'path/to/plugins'; // Placeholder
      const marketplaceUrl = 'https://example-marketplace.com/api'; // Placeholder
      const newPluginService = new PluginService(pluginDir, marketplaceUrl);
      setPluginService(newPluginService);

      // Initialize CommandService
      const newCommandService = new CommandService(newPluginService);
      setCommandService(newCommandService);

      // Initialize ViewService
      const newViewService = new ViewService(newPluginService); 
      setViewService(newViewService);

      // Initialize ProviderService
      const newProviderService = new ProviderService(newPluginService); // Pass pluginService
      setProviderService(newProviderService);

      // Setup listener for PluginAPI.showNotification
      // This assumes newPluginService and newUiService are immediately available.
      // If their setup is async or complex, this might need adjustment.
      newPluginService.on('notification', ({ message, type }: { message: string, type?: 'info' | 'warning' | 'error' }) => {
        if (newUiService) { // Check if uiService is initialized
          newUiService.showNotification({ message, type: type || 'info' });
        }
      });
      
      // Load plugins (this might also trigger command registrations)
      newPluginService.loadPlugins().catch(err => console.error("Error loading plugins:", err));

      // Setup listeners for CommandService feedback
      if (newCommandService && newUiService) {
        newCommandService.on('commandExecuted', ({ id }) => {
          // newUiService.showNotification({ message: `Command '${id}' executed.`, type: 'success', timeout: 2000 });
          // console.log(`Command '${id}' executed successfully.`); // For now, log, as showNotification might be too verbose for every command
        });
        newCommandService.on('commandExecutionError', ({ id, error }) => {
          console.error(`Error executing command ${id}:`, error);
          newUiService.showNotification({ message: `Error executing command '${id}': ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
        });
        newCommandService.on('commandNotFound', (id) => {
          console.warn(`Command ${id} not found.`);
          newUiService.showNotification({ message: `Command '${id}' not found.`, type: 'warning', timeout: 3000 });
        });
      }


      // Initialize terminal server and services
      // TerminalServer is managed internally by TerminalManager or TerminalService now
      const newTerminalService = TerminalService.getInstance(
        null, // terminal element, will be set by TerminalPanel or Terminal component
        newAiService,
        newProjectService,
        newUiService,
        null, // terminalServer instance - to be managed by TerminalManager/Service
        store // global store
      );
      setTerminalService(newTerminalService);

      // Initialize terminal manager
      const newTerminalManager = new TerminalManager(
        terminalPort, // This port needs to be managed better if dynamic
        newTerminalService,
        newAiService,
        newProjectService,
        newUiService
      );
      newTerminalService.setTerminalManager(newTerminalManager); // Link manager to service
      setTerminalManager(newTerminalManager);


      // Load file structure for the project
      try {
        const structure = await newProjectService.getFileStructure(path);
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

  const services: ServiceContextType = {
    aiService,
    projectService,
    terminalManager,
    terminalService,
    uiService,
    store: appStore,
    commandService, 
    viewService, 
    providerService, // Added providerService
  };

  return (
    <ThemeProvider>
      <ServiceProvider value={services}> {/* Wrap with ServiceProvider */}
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
      </ServiceProvider>
    </ThemeProvider>
  );
};

export default App;