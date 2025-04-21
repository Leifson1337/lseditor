import React, { useState, useEffect } from 'react';
import { Editor } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import Sidebar from './Sidebar';
import AIChatPanel from './AIChatPanel';
import { ThemeProvider } from '../contexts/ThemeContext';
import { EditorProvider } from '../contexts/EditorContext';
import { AIProvider } from '../contexts/AIContext';
import '../styles/EditorLayout.css';

interface EditorLayoutProps {
  initialContent?: string;
  initialLanguage?: string;
  onSave?: (content: string) => void;
  onFileOpen?: (path: string) => void;
  fileStructure: any[];
  activeFile?: string;
  projectPath?: string;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  initialContent = '',
  initialLanguage = 'typescript',
  onSave,
  onFileOpen,
  fileStructure,
  activeFile,
  projectPath = ''
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string }>>([]);
  const [editorContent, setEditorContent] = useState<string>(initialContent);
  const [editorLanguage, setEditorLanguage] = useState<string>(initialLanguage);

  const handleFileOpen = (path: string) => {
    if (onFileOpen) {
      onFileOpen(path);
    }
    // Add new tab if it doesn't exist
    let tab = tabs.find(tab => tab.path === path);
    if (!tab) {
      tab = {
        id: Math.random().toString(36).substr(2, 9),
        title: path.split('/').pop() || path,
        path
      };
      setTabs([...tabs, tab]);
    }
    setActiveTab(tab.id);
  };

  const handleTabClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null);
    }
  };

  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTab);
    if (tab) {
      // Detailliertes Logging für Debugging
      console.log('Aktiver Tab zum Laden:', tab);
      console.log('Datei wird geladen:', tab.path);
      console.log('Projekt-Pfad:', projectPath);

      try {
        // Den Pfad der Datei normalisieren
        let filePath = tab.path;

        // Prüfen, ob es ein absoluter Pfad ist
        if (!filePath.match(/^([a-zA-Z]:\\|\\\\)/)) {
          // Wenn nicht, zum Projektpfad hinzufügen
          filePath = projectPath ? 
            (projectPath.endsWith('\\') ? `${projectPath}${filePath}` : `${projectPath}\\${filePath}`) 
            : filePath;
        }
        
        console.log('Finaler Dateipfad für Lesen:', filePath);

        // Direkten IPC-Aufruf zum Lesen verwenden
        window.electron?.ipcRenderer.invoke('readFile', filePath)
          .then(content => {
            console.log('Datei erfolgreich gelesen, Länge:', content ? content.length : 0);
            setEditorContent(content ?? '');
            
            // Sprache anhand Dateiendung setzen
            const ext = tab.path.split('.').pop()?.toLowerCase();
            let lang = 'plaintext';
            switch (ext) {
              case 'js': lang = 'javascript'; break;
              case 'ts': lang = 'typescript'; break;
              case 'tsx': lang = 'typescript'; break;
              case 'json': lang = 'json'; break;
              case 'css': lang = 'css'; break;
              case 'html': lang = 'html'; break;
              case 'md': lang = 'markdown'; break;
              case 'py': lang = 'python'; break;
              default: lang = 'plaintext';
            }
            setEditorLanguage(lang);
          })
          .catch(err => {
            // Alternativ mit fallback fs:readFile versuchen
            console.log('Fallback: Versuche fs:readFile mit:', filePath);
            window.electron?.ipcRenderer.invoke('fs:readFile', filePath)
              .then(content => {
                console.log('Datei mit fs:readFile erfolgreich gelesen');
                setEditorContent(content ?? '');
                // Language handling...
                const ext = tab.path.split('.').pop()?.toLowerCase();
                let lang = 'plaintext';
                switch (ext) {
                  case 'js': lang = 'javascript'; break;
                  case 'ts': lang = 'typescript'; break;
                  case 'tsx': lang = 'typescript'; break;
                  case 'json': lang = 'json'; break;
                  case 'css': lang = 'css'; break;
                  case 'html': lang = 'html'; break;
                  case 'md': lang = 'markdown'; break;
                  case 'py': lang = 'python'; break;
                  default: lang = 'plaintext';
                }
                setEditorLanguage(lang);
              })
              .catch(fsErr => {
                console.error('Beide Methoden zum Lesen fehlgeschlagen:', fsErr);
                setEditorContent('Fehler beim Lesen der Datei. Pfad: ' + filePath);
              });
          });
      } catch (error) {
        console.error('Fehler beim Verarbeiten des Tab-Pfads:', error);
        setEditorContent('Fehler: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }, [activeTab, projectPath]);

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout">
            <div className="editor-layout-header">
              <button 
                className="sidebar-toggle"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              >
                ☰
              </button>
              <TabBar
                tabs={tabs}
                activeTab={activeTab}
                onTabClose={handleTabClose}
                onTabSelect={setActiveTab}
              />
              <button 
                className="ai-panel-toggle"
                onClick={() => setIsAIPanelOpen(!isAIPanelOpen)}
              >
                🤖
              </button>
            </div>
            
            <div className="editor-layout-main">
              {isSidebarOpen && (
                <div className="sidebar-container">
                  <Sidebar 
                    activeTab="explorer"
                    onTabChange={(tab) => console.log('Tab changed:', tab)}
                  />
                  <div className="sidebar-content-panel">
                    <FileExplorer
                      fileStructure={fileStructure}
                      onOpenFile={handleFileOpen}
                      activeFile={tabs.find(t => t.id === activeTab)?.path || null}
                      projectPath={projectPath}
                    />
                  </div>
                </div>
              )}
              
              <div className="editor-container">
                {tabs.length > 0 && activeTab ? (
                  <Editor
                    height="100%"
                    defaultLanguage={editorLanguage}
                    defaultValue={editorContent}
                    value={editorContent}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: true },
                      fontSize: 14,
                      lineNumbers: 'on',
                      roundedSelection: false,
                      scrollBeyondLastLine: false,
                      readOnly: false,
                      automaticLayout: true,
                    }}
                    onChange={val => setEditorContent(val ?? '')}
                  />
                ) : (
                  <div className="editor-empty">Keine Datei geöffnet</div>
                )}
              </div>
              
              {isAIPanelOpen && (
                <AIChatPanel />
              )}
            </div>
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
}; 