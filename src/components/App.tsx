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

// Erweitere die StoreSchema um lastProjectPath
declare module '../store/store' {
  interface StoreSchema {
    theme: string;
    fontSize: number;
    fontFamily: string;
    terminal: {
      port: number;
      defaultProfile: string;
    };
    editor: {
      wordWrap: boolean;
      minimap: boolean;
      lineNumbers: boolean;
      content?: string;
    };
    lastProjectPath?: string;
  }
}

export const App: React.FC = () => {
  const [editorContent, setEditorContent] = useState<string>('');
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [projectPath, setProjectPath] = useState<string>('');
  const [showProjectDialog, setShowProjectDialog] = useState<boolean>(true);
  const [fileStructure, setFileStructure] = useState<any[]>([]);
  const [terminalPort, setTerminalPort] = useState<number>(3001);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null);

  useEffect(() => {
    // Load initial settings from store
    const theme = store.get('theme');
    const fontSize = store.get('fontSize');
    const fontFamily = store.get('fontFamily');
    const savedProjectPath = store.get('lastProjectPath');
    const editor = store.get('editor');

    // Apply theme
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    }
    
    // Apply font settings
    if (fontSize) {
      document.documentElement.style.fontSize = `${fontSize}px`;
    }
    if (fontFamily) {
      document.documentElement.style.fontFamily = fontFamily;
    }

    // Load initial editor content from editor store
    if (editor?.content) {
      setEditorContent(editor.content);
    }

    // If there's a saved project path, open it automatically
    if (savedProjectPath) {
      openProject(savedProjectPath);
    }
  }, []);

  const openProject = async (path: string) => {
    setProjectPath(path);
    setShowProjectDialog(false);
    
    // Update store with new project path
    store.set('lastProjectPath', path);

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
    const terminalService = new TerminalService(
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

    // Load file structure - verwende eine Mock-Implementierung, da getFileStructure nicht existiert
    try {
      // Mock-Implementierung für die Dateistruktur
      const mockStructure = [
        {
          name: 'src',
          path: 'src',
          type: 'directory',
          children: [
            {
              name: 'components',
              path: 'src/components',
              type: 'directory',
              children: [
                {
                  name: 'App.tsx',
                  path: 'src/components/App.tsx',
                  type: 'file'
                },
                {
                  name: 'Layout.tsx',
                  path: 'src/components/Layout.tsx',
                  type: 'file'
                }
              ]
            },
            {
              name: 'services',
              path: 'src/services',
              type: 'directory',
              children: [
                {
                  name: 'AIService.ts',
                  path: 'src/services/AIService.ts',
                  type: 'file'
                }
              ]
            }
          ]
        },
        {
          name: 'package.json',
          path: 'package.json',
          type: 'file'
        }
      ];
      setFileStructure(mockStructure);
    } catch (error) {
      console.error('Error loading file structure:', error);
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

  return (
    <div className="app">
      {showProjectDialog ? (
        <div className="project-dialog">
          <h2>Projekt öffnen</h2>
          <p>Bitte wählen Sie ein Projekt aus, das Sie öffnen möchten:</p>
          <div className="project-input">
            <input 
              type="text" 
              placeholder="Projektpfad eingeben..." 
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
            />
            <button onClick={() => openProject(projectPath)}>Öffnen</button>
          </div>
          <div className="recent-projects">
            <h3>Kürzlich geöffnete Projekte</h3>
            {/* Hier könnten kürzlich geöffnete Projekte angezeigt werden */}
          </div>
        </div>
      ) : (
        <Layout
          initialContent={editorContent}
          initialLanguage="typescript"
          fileStructure={fileStructure}
          onOpenFile={(path: string) => {
            setActiveFile(path);
            if (!openFiles.includes(path)) {
              setOpenFiles([...openFiles, path]);
            }
          }}
          activeFile={activeFile}
          terminalPort={terminalPort}
          isTerminalOpen={isTerminalOpen}
          onTerminalOpen={handleTerminalOpen}
          onTerminalClose={handleTerminalClose}
        >
          <div className="editor-content">
            {editorContent}
          </div>
        </Layout>
      )}
    </div>
  );
}; 