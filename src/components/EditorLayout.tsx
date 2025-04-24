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

interface EditorLayoutProps {
  initialContent?: string;
  initialLanguage?: string;
  onSave?: (content: string) => void;
  fileStructure: any[];
  activeFile?: string;
  projectPath?: string;
  onEditorChange?: (content: string) => void;
  onOpenFile?: (filePath: string) => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  initialContent = '',
  initialLanguage = 'typescript',
  onSave,
  fileStructure,
  activeFile = '',
  projectPath = '',
  onEditorChange,
  onOpenFile
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string; content: string; dirty: boolean }>>([]);
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const minSidebarWidth = 160;
  const maxSidebarWidth = 480;

  // Aktueller Tab-Inhalt für den Editor
  const activeTabContent = tabs.find(t => t.id === activeTab)?.content || '';

  // Datei in Tab öffnen und Inhalt laden
  const openFileInTab = async (filePath: string) => {
    if (!filePath) return;
    let tab = tabs.find(tab => tab.path === filePath);
    if (!tab) {
      let content = '';
      if (window.electron && window.electron.ipcRenderer) {
        content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
        if (!content) content = await window.electron.ipcRenderer.invoke('file:read', filePath);
        if (!content) content = await window.electron.ipcRenderer.invoke('readFile', filePath);
      }
      tab = {
        id: Math.random().toString(36).substr(2, 9),
        title: filePath.split(/[\\/]/).pop() || filePath,
        path: filePath,
        content: typeof content === 'string' ? content : '',
        dirty: false
      };
      setTabs([...tabs, tab]);
      setActiveTab(tab.id);
    } else {
      setActiveTab(tab.id);
    }
  };

  // Wenn activeFile sich ändert, öffne Datei im Tab
  useEffect(() => {
    if (activeFile) openFileInTab(activeFile);
  }, [activeFile]);

  // dirty-Flag in Tabs verwalten
  const setTabDirty = (tabId: string, dirty: boolean) => {
    setTabs(tabs.map(tab =>
      tab.id === tabId ? { ...tab, dirty } : tab
    ));
  };

  // Editor-Inhalt ändern
  const handleEditorChange = (val: string | undefined) => {
    if (!activeTab) return;
    setTabs(tabs.map(tab =>
      tab.id === activeTab ? { ...tab, content: val ?? '', dirty: true } : tab
    ));
  };

  // Datei speichern
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    if (window.electron && window.electron.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('file:save', tab.path, tab.content);
      setTabs(tabs.map(t => t.id === tab.id ? { ...t, dirty: false } : t));
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
  }, [activeTab, tabs]);

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

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout-root">
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
                <div style={{ width: sidebarWidth, minWidth: minSidebarWidth, maxWidth: maxSidebarWidth, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                  <div className="sidebar-container" style={{ width: '100%', minWidth: minSidebarWidth, maxWidth: maxSidebarWidth }}>
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
                  {/* Resizer */}
                  <div
                    style={{ width: 6, cursor: 'col-resize', position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 10, background: '#2224', borderRadius: 3 }}
                    onMouseDown={e => {
                      e.preventDefault();
                      const startX = e.clientX;
                      const startWidth = sidebarWidth;
                      const onMouseMove = (moveEvent: MouseEvent) => {
                        let newWidth = startWidth + (moveEvent.clientX - startX);
                        newWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, newWidth));
                        setSidebarWidth(newWidth);
                      };
                      const onMouseUp = () => {
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);
                      };
                      window.addEventListener('mousemove', onMouseMove);
                      window.addEventListener('mouseup', onMouseUp);
                    }}
                  />
                </div>
              )}
              {/* Editor wächst/shrinkt dynamisch mit Sidebar */}
              <div style={{ flex: 1, minWidth: 0, minHeight: 0, height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
                <div className="editor-container" style={{ height: '100%', width: '100%', flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  {tabs.length > 0 && activeTab ? (
                    isMediaFile(tabs.find(t => t.id === activeTab)?.title || '') ? (
                      <div className="media-preview" style={{ flex: 1, height: '100%', width: '100%' }}>
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
                        key={activeTab || 'editor'}
                        value={activeTabContent}
                        language={(() => {
                          const file = tabs.find(t => t.id === activeTab)?.path || '';
                          const ext = file.split('.').pop()?.toLowerCase();
                          switch (ext) {
                            case 'js': return 'javascript';
                            case 'ts': return 'typescript';
                            case 'tsx': return 'typescript';
                            case 'jsx': return 'javascript';
                            case 'json': return 'json';
                            case 'css': return 'css';
                            case 'html': return 'html';
                            case 'md': return 'markdown';
                            case 'py': return 'python';
                            case 'sh': return 'shell';
                            case 'yml':
                            case 'yaml': return 'yaml';
                            case 'txt': return 'plaintext';
                            default: return 'plaintext';
                          }
                        })()}
                        onChange={handleEditorChange}
                        theme="vs-dark"
                        options={{ automaticLayout: true }}
                      />
                    )
                  ) : (
                    <div className="editor-empty-ui" style={{ flex: 1, height: '100%', width: '100%', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FaRegFile size={64} color="#888" style={{marginBottom: 16}} />
                      <div className="editor-empty-title">Keine Datei geöffnet</div>
                      <div className="editor-empty-desc">Wähle links eine Datei aus oder erstelle eine neue Datei, um loszulegen.</div>
                    </div>
                  )}
                </div>
              </div>
              {isAIPanelOpen && (
                <div style={{ width: 340, minWidth: 260, maxWidth: 600, height: '100%', position: 'relative', display: 'flex' }}>
                  <AIChatPanel />
                </div>
              )}
            </div>
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
}; 