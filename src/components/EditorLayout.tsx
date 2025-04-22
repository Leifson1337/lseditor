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
  fileStructure: any[];
  activeFile?: string;
  projectPath?: string;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  initialContent = '',
  initialLanguage = 'typescript',
  onSave,
  fileStructure,
  activeFile,
  projectPath = ''
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string }>>([]);
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');

  const [editorContent, setEditorContent] = useState<string>(initialContent);
  const [editorLanguage, setEditorLanguage] = useState<string>(initialLanguage);

  // Dateiinhalt laden und Tab aktivieren
  const openFileInTab = async (filePath: string) => {
    if (!filePath) return;
    let tab = tabs.find(tab => tab.path === filePath);
    if (!tab) {
      tab = {
        id: Math.random().toString(36).substr(2, 9),
        title: filePath.split(/[\\/]/).pop() || filePath,
        path: filePath
      };
      setTabs(prev => [...prev, tab!]);
    }
    setActiveTab(tab.id);
    // Dateiinhalt laden
    try {
      let content = '';
      if (window.electron?.ipcRenderer.invoke) {
        content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
        if (!content) {
          content = await window.electron.ipcRenderer.invoke('readFile', filePath);
        }
      }
      setEditorContent(content ?? '');
    } catch {
      setEditorContent('Fehler beim Laden der Datei.');
    }
  };

  // Tab-Wechsel lädt Inhalt
  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTab);
    if (tab) {
      openFileInTab(tab.path);
    }
  }, [activeTab]);

  const handleTabClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null);
    }
  };

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
                    activeTab={sidebarTab}
                    onTabChange={setSidebarTab}
                  />
                  <div className="sidebar-content-panel">
                    {sidebarTab === 'explorer' && (
                      <FileExplorer
                        fileStructure={fileStructure}
                        onOpenFile={openFileInTab}
                        activeFile={tabs.find(t => t.id === activeTab)?.path || ''}
                        projectPath={projectPath}
                      />
                    )}
                  </div>
                </div>
              )}
              
              <div className="editor-container">
                {tabs.length > 0 && activeTab ? (
                  <Editor
                    height="100%"
                    value={editorContent}
                    language={editorLanguage}
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