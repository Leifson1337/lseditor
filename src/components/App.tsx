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
import { Editor } from './Editor';

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
    console.log('Opening project:', path);
    setProjectPath(path);
    setShowProjectDialog(false);
    
    // Update store with new project path
    store.set('lastProjectPath', path);

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

  const handleFileOpen = (path: string) => {
    console.log('Opening file:', path);
    setActiveFile(path);
    if (!openFiles.includes(path)) {
      setOpenFiles([...openFiles, path]);
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

  console.log('App rendering, showProjectDialog:', showProjectDialog);
  
  return (
    <div className="app">
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
            <button onClick={() => openProject(projectPath)}>Open</button>
          </div>
          <div className="recent-projects">
            <h3>Recently opened projects</h3>
            {/* Here you could display recently opened projects */}
          </div>
        </div>
      ) : (
        <Layout
          fileStructure={fileStructure}
          onOpenFile={handleFileOpen}
          activeFile={activeFile}
          terminalPort={terminalPort}
          isTerminalOpen={isTerminalOpen}
          onTerminalOpen={handleTerminalOpen}
          onTerminalClose={handleTerminalClose}
        >
          <Editor
            filePath={activeFile || 'Kein File geöffnet'}
            content={editorContent || 'Willkommen! Öffne eine Datei, um sie zu bearbeiten.'}
            isLoading={!isInitialized}
          />
        </Layout>
      )}
    </div>
  );
};

export default App; 