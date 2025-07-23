import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { AIService } from '../services/AIService';
import { TerminalService } from '../services/TerminalService';
import { TerminalServer } from '../server/terminalServer';
import { TerminalManager } from '../services/TerminalManager';

// Define types
export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  content?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  type: 'project';
  children?: FileNode[];
}

// Define the store interface
export interface IStore<T> {
  get: <K extends keyof T>(key: K) => T[K];
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  delete: (key: keyof T) => void;
  clear: () => void;
  has: (key: keyof T) => boolean;
  reset: (...keys: (keyof T)[]) => void;
  store: T;
  path: string;
  openInEditor: () => void;
}

// Create a store instance
const createStore = <T extends Record<string, any>>(options: any): IStore<T> => {
  const store: any = {};

  store.get = (key: string) => {
    const value = localStorage.getItem(`store.${String(key)}`);
    return value ? JSON.parse(value) : undefined;
  };

  store.set = (key: string, value: any) => {
    localStorage.setItem(`store.${String(key)}`, JSON.stringify(value));
  };

  store.delete = (key: string) => {
    localStorage.removeItem(`store.${String(key)}`);
  };

  store.clear = () => {
    Object.keys(localStorage)
      .filter(key => key.startsWith('store.'))
      .forEach(key => localStorage.removeItem(key));
  };

  store.has = (key: string) => {
    return localStorage.getItem(`store.${String(key)}`) !== null;
  };

  store.reset = (...keys: string[]) => {
    if (keys.length === 0) {
      store.clear();
    } else {
      keys.forEach(key => store.delete(key));
    }
  };

  // Initialize with defaults
  if (options?.defaults) {
    Object.entries(options.defaults).forEach(([key, value]) => {
      if (!store.has(key)) {
        store.set(key, value);
      }
    });
  }

  store.store = new Proxy({} as T, {
    get(_, prop) {
      return store.get(prop);
    },
    set(_, prop, value) {
      store.set(prop, value);
      return true;
    },
    deleteProperty(_, prop) {
      store.delete(prop);
      return true;
    },
    ownKeys() {
      return Object.keys(localStorage)
        .filter(key => key.startsWith('store.'))
        .map(key => key.replace('store.', ''));
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true
      };
    }
  });

  store.path = '';
  store.openInEditor = () => {};

  return store as IStore<T>;
};

// Define the store schema
export interface IStoreSchema {
  lastProjectPath?: string;
  recentProjects: string[];
  recentFiles: Array<{ path: string; timestamp: number }>;
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  terminal: {
    fontSize: number;
    fontFamily: string;
    theme: string;
  };
  editor: {
    lineNumbers: 'on' | 'off' | 'relative';
    minimap: { enabled: boolean };
    wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  };
  ai: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

// Initialize the store
const store = createStore<IStoreSchema>({
  defaults: {
    recentProjects: [],
    recentFiles: [],
    theme: 'system',
    fontSize: 14,
    fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
    terminal: {
      fontSize: 14,
      fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
      theme: 'default'
    },
    editor: {
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'on'
    },
    ai: {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000
    }
  }
});

// Default AI configuration
const defaultAIConfig = {
  useLocalModel: false,
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindow: 4096,
  stopSequences: ['\n\n', '```'],
  topP: 1,
  endpoint: 'https://api.openai.com/v1/chat/completions'
};

// Import components with proper types
import { FileExplorer } from './FileExplorer';
import { Editor } from './Editor';
import { Terminal } from './Terminal';
import { Tabs } from './Tabs';
import { ProjectDialog } from './ProjectDialog';
import { ThemeProvider } from './ThemeProvider';
import { Layout } from './Layout';

// Import styles
import './App.css';

// Extend Window interface to include Electron API
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        on: (channel: string, listener: (...args: any[]) => void) => void;
        removeListener: (channel: string, listener: (...args: any[]) => void) => void;
      };
      windowControls: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
    };
  }
}

// Define store schema
interface StoreSchema {
  lastProjectPath?: string;
  recentProjects: string[];
  recentFiles: Array<{ path: string; timestamp: number }>;
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  terminal: {
    fontSize: number;
    fontFamily: string;
    theme: string;
  };
  editor: {
    lineNumbers: 'on' | 'off' | 'relative';
    minimap: { enabled: boolean };
    wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  };
  ai: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
}

// Initialize store
const store = new Store<StoreSchema>({
  defaults: {
    recentProjects: [],
    recentFiles: [],
    theme: 'system',
    fontSize: 14,
    fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
    terminal: {
      fontSize: 14,
      fontFamily: '"Fira Code", "Consolas", "Monaco", monospace',
      theme: 'default',
    },
    editor: {
      lineNumbers: 'on',
      minimap: { enabled: true },
      wordWrap: 'on',
    },
    ai: {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2048,
    },
  },
});

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <button onClick={() => window.location.reload()}>Reload App</button>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  // State management
  const [fileStructure, setFileStructure] = useState<FileNode[]>([]);
  const [openFiles, setOpenFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(true);
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null);
  const [projectPath, setProjectPath] = useState<string>('');
  const [showProjectDialog, setShowProjectDialog] = useState<boolean>(true);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize services with proper types
  const projectService = useMemo(() => new ProjectService(), []);
  const uiService = useMemo(() => new UIService(), []);
  const aiService = useMemo(() => new AIService(), []);
  const terminalService = useMemo(() => new TerminalService(), []);
  const terminalServer = useMemo(() => new TerminalServer(), []);

  // Load recent projects from store
  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const recent = store.get('recentProjects');
        setRecentProjects(recent || []);
      } catch (err) {
        console.error('Error loading recent projects:', err);
      }
    };

    loadRecentProjects();
  }, []);

  // Reset error state when project path changes
  useEffect(() => {
    if (projectPath) {
      setError(null);
    }
  }, [projectPath]);

  // Initialize terminal when project is loaded
  useEffect(() => {
    if (projectPath) {
      const initTerminal = async () => {
        try {
          if (terminalManager) {
            terminalManager.dispose();
          }

          await terminalServer.start();
          const manager = new TerminalManager(terminalServer);
          setTerminalManager(manager);
        } catch (err) {
          console.error('Failed to initialize terminal:', err);
          setError('Failed to initialize terminal');
        }
      };

      initTerminal();

      return () => {
        if (terminalManager) {
          terminalManager.dispose();
        }
        terminalServer.stop();
      };
    }
  }, [projectPath, terminalServer, terminalManager]);

  // Handle file close with confirmation for unsaved changes
  const handleFileClose = useCallback(async (filePath: string) => {
    try {
      const file = openFiles.find(f => f.path === filePath);

      if (file) {
        // Check for unsaved changes
        const originalContent = await window.electron.ipcRenderer.invoke('file:read', filePath);

        if (file.content !== originalContent) {
          // Show confirmation dialog
          const shouldClose = window.confirm('You have unsaved changes. Close anyway?');
          if (!shouldClose) return;
        }

        setOpenFiles(prev => {
          const newFiles = prev.filter(f => f.path !== filePath);

          // If the closed file was active, set a new active file
          if (activeFile === filePath) {
            const currentIndex = prev.findIndex(f => f.path === filePath);
            const newActiveFile = newFiles[currentIndex] || newFiles[newFiles.length - 1];

            if (newActiveFile) {
              setActiveFile(newActiveFile.path);
              setEditorContent(newActiveFile.content);
            } else {
              setActiveFile('');
              setEditorContent('');
            }
          }

          return newFiles;
        });
      }
    } catch (error) {
      console.error('Error checking file changes:', error);
      // Continue with closing the file if there's an error checking changes
      setOpenFiles(prev => prev.filter(f => f.path !== filePath));
      if (activeFile === filePath) {
        setActiveFile('');
        setEditorContent('');
      }
    }
  }, [activeFile, openFiles]);

  // Create new project
  const createNewProject = useCallback(async (projectData: { name: string; path: string }) => {
    try {
      setIsLoading(true);

      // Create project directory and structure
      await window.electron.ipcRenderer.invoke('fs:ensureDir', projectData.path);

      // Initialize project
      const project = await projectService.createProject(projectData.name, projectData.path);
      setProjectPath(project.path);
      setFileStructure(project.children || []);
      setShowProjectDialog(false);

      // Clear any open files
      setOpenFiles([]);
      setActiveFile('');
      setEditorContent('');

      // Update recent projects
      setRecentProjects(prev => {
        const newRecent = [project.path, ...prev.filter(p => p !== project.path)].slice(0, 5);
        store.set('recentProjects', newRecent);
        return newRecent;
      });

      // Initialize terminal
      if (terminalServer) {
        try {
          await terminalServer.start();
          const manager = new TerminalManager(terminalServer);
          setTerminalManager(manager);
        } catch (error) {
          console.error('Failed to initialize terminal:', error);
          setError('Project created, but failed to initialize terminal');
        }
      }
    } catch (error) {
      console.error('Error creating project:', error);
      setError(error instanceof Error ? error.message : 'Failed to create project');
    } finally {
      setIsLoading(false);
    }
  }, [projectService, terminalServer]);

  // Load file content
  const loadFileContent = useCallback(async (filePath: string) => {
    if (!filePath) return;

    try {
      setIsLoading(true);
      const content = await window.electron.ipcRenderer.invoke('file:read', filePath);
      setEditorContent(content);
      setActiveFile(filePath);

      // Add to open files if not already open
      setOpenFiles(prev => {
        if (!prev.some(file => file.path === filePath)) {
          return [...prev, { path: filePath, content }];
        }
        return prev.map(file =>
          file.path === filePath ? { ...file, content } : file
        );
      });

      // Save file to recent files in store
      const recentFiles = store.get('recentFiles') || [];
      const updatedRecentFiles = [
        { path: filePath, timestamp: Date.now() },
        ...recentFiles.filter((f: { path: string }) => f.path !== filePath).slice(0, 9)
      ];
      store.set('recentFiles', updatedRecentFiles);
    } catch (err) {
      console.error('Error loading file:', err);
      setError('Failed to open file');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle editor content change with debounce for auto-save
  const handleEditorChange = useCallback((value: string) => {
    setEditorContent(value);

    // Update the content in open files
    setOpenFiles(prev =>
      prev.map(file =>
        file.path === activeFile ? { ...file, content: value } : file
      )
    );

    // Auto-save if file is open
    if (activeFile) {
      // Use setTimeout to debounce the save operation
      if ((window as any).saveTimeout) {
        clearTimeout((window as any).saveTimeout);
      }

      (window as any).saveTimeout = setTimeout(() => {
        window.electron.ipcRenderer.send('file:save', {
          path: activeFile,
          content: value
        }).catch((err: Error) => {
          console.error('Error auto-saving file:', err);
        });
      }, 1000); // 1 second debounce
    }
  }, [activeFile]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Cmd/Ctrl + O to open project
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        setShowProjectDialog(true);
      }
      // Handle Cmd/Ctrl + , to open settings
      else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        // TODO: Open settings dialog
      }
      // Handle Cmd/Ctrl + S to save file
      else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile && editorContent !== undefined) {
          window.electron.ipcRenderer.send('file:save', {
            path: activeFile,
            content: editorContent
          }).catch(err => {
            console.error('Error saving file:', err);
            setError('Failed to save file');
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeFile, editorContent]);

  // Window control handlers
  const handleMinimize = useCallback(() => {
    if (window.electron?.windowControls?.minimize) {
      window.electron.windowControls.minimize();
    }
  }, []);

  const handleMaximize = useCallback(() => {
    if (window.electron?.windowControls?.maximize) {
      window.electron.windowControls.maximize();
    }
  }, []);

  const handleClose = useCallback(() => {
    if (window.electron?.windowControls?.close) {
      window.electron.windowControls.close();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear any pending save timeouts
      if ((window as any).saveTimeout) {
        clearTimeout((window as any).saveTimeout);
      }
      
      // Cleanup terminal
      if (terminalManager) {
        terminalManager.dispose();
      }
      
      if (terminalServer) {
        terminalServer.stop().catch(err => {
          console.error('Error stopping terminal server:', err);
        });
      }
    };
  }, [terminalManager, terminalServer]);

  // Render the app with error boundary and theme provider
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <div className="app">
          {/* Window Controls */}
          <div className="window-controls">
            <button onClick={handleMinimize} className="window-control minimize">
              <span>_</span>
            </button>
            <button onClick={handleMaximize} className="window-control maximize">
              <span>□</span>
            </button>
            <button onClick={handleClose} className="window-control close">
              <span>×</span>
            </button>
        {/* Window Controls */}
        <div className="window-controls">
          <button onClick={handleMinimize} className="window-control minimize">
            <span>_</span>
          </button>
          <button onClick={handleMaximize} className="window-control maximize">
            <span>□</span>
          </button>
          <button onClick={handleClose} className="window-control close">
            <span>×</span>
          </button>
        </div>
        
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        
        {showProjectDialog ? (
          <ProjectDialog
            isOpen={showProjectDialog}
            onClose={() => setShowProjectDialog(false)}
            onOpenProject={openProject}
            onCreateProject={createNewProject}
            recentProjects={recentProjects}
            onSelectRecentProject={openProject}
          />
        ) : (
          <Layout
            fileStructure={fileStructure}
            projectPath={projectPath}
            isTerminalOpen={isTerminalOpen}
            onTerminalToggle={() => setIsTerminalOpen(!isTerminalOpen)}
          >
            <div className="editor-container">
              <Tabs
                files={openFiles}
                activeFile={activeFile}
                onFileSelect={loadFileContent}
                onFileClose={handleFileClose}
              />
              
              <Editor
                content={editorContent}
                onChange={handleEditorChange}
                filePath={activeFile}
                isLoading={isLoading}
              />
              
              <Terminal
                isOpen={isTerminalOpen}
                onToggle={() => setIsTerminalOpen(!isTerminalOpen)}
                terminalManager={terminalManager}
                onData={(data) => terminalManager?.write(data)}
                onExit={() => {
                  terminalManager?.dispose();
                  setTerminalManager(null);
                }}
              />
            </div>
          </Layout>
        )}
        
        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-bar-item">
            {projectPath ? `Project: ${projectPath}` : 'No project open'}
          </div>
          <div className="status-bar-item">
            {activeFile ? `File: ${activeFile}` : 'No file selected'}
          </div>
          <div className="status-bar-item">
            {isLoading ? 'Loading...' : 'Ready'}
          </div>
        </div>
      </div>
    </ThemeProvider>
  </ErrorBoundary>
);