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
import { FaRegFile } from 'react-icons/fa';
import { ResizableSidebar, ResizableAIPanel, ResizableMainArea } from './ResizableComponents';

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
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string; dirty: boolean }>>([]);
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
        path: filePath,
        dirty: false
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

  // Hilfsfunktion: Prüfen ob Datei ein Bild/Video ist
  const isMediaFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    return imageExts.includes(ext) || videoExts.includes(ext);
  };

  // dirty-Flag in Tabs verwalten
  const setTabDirty = (tabId: string, dirty: boolean) => {
    setTabs(prevTabs => prevTabs.map(tab =>
      tab.id === tabId ? { ...tab, dirty } : tab
    ));
  };

  // Datei speichern
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    if (window.electron?.ipcRenderer.invoke) {
      await window.electron.ipcRenderer.invoke('file:save', tab.path, editorContent);
      setTabDirty(tab.id, false);
    }
  };

  // STRG+S Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, editorContent, tabs]);

  // Editor-Inhalt ändern
  const handleEditorChange = (val: string | undefined) => {
    setEditorContent(val ?? '');
    if (activeTab) setTabDirty(activeTab, true);
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
                <ResizableSidebar initialWidth={260} minWidth={160} maxWidth={480}>
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
                </ResizableSidebar>
              )}
              <ResizableMainArea>
                <div className="editor-container">
                  {tabs.length > 0 && activeTab ? (
                    isMediaFile(tabs.find(t => t.id === activeTab)?.title || '') ? (
                      <div className="media-preview">
                        {/* Bild- oder Videoanzeige */}
                        {(() => {
                          const file = tabs.find(t => t.id === activeTab)?.path || '';
                          const ext = (file && typeof file === 'string') ? file.split('.').pop()?.toLowerCase() || '' : '';
                          if (["png","jpg","jpeg","gif","bmp","svg","webp"].includes(ext)) {
                            return <img src={`file://${file}`} alt={file} style={{maxWidth:'100%',maxHeight:'100%'}} />;
                          }
                          if (["mp4","webm","ogg","mov","avi","mkv"].includes(ext)) {
                            return <video src={`file://${file}`} controls style={{maxWidth:'100%',maxHeight:'100%'}} />;
                          }
                          return <div>Dateityp nicht unterstützt</div>;
                        })()}
                      </div>
                    ) : (
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
                        onChange={handleEditorChange}
                      />
                    )
                  ) : (
                    <div className="editor-empty-ui">
                      <FaRegFile size={64} color="#888" style={{marginBottom: 16}} />
                      <div className="editor-empty-title">Keine Datei geöffnet</div>
                      <div className="editor-empty-desc">Wähle links eine Datei aus oder erstelle eine neue Datei, um loszulegen.</div>
                    </div>
                  )}
                </div>
              </ResizableMainArea>
              {isAIPanelOpen && (
                <ResizableAIPanel minWidth={260} maxWidth={600} initialWidth={340}>
                  <AIChatPanel />
                </ResizableAIPanel>
              )}
            </div>
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
}; 