import React, { useState, useEffect } from 'react';
import { Editor } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import Sidebar from './Sidebar';
import AIChatPanel from './AIChatPanel';
import { TerminalPanel } from './TerminalPanel'; // Import TerminalPanel
import { ThemeProvider } from '../contexts/ThemeContext';
import { EditorProvider } from '../contexts/EditorContext';
import { AIProvider } from '../contexts/AIContext';
import '../styles/EditorLayout.css';
import { FaRegFile } from 'react-icons/fa';

// Props for the EditorLayout component
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
  // State for AI panel visibility
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  // State for currently active tab
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // State for all open tabs
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string; content: string; dirty: boolean }>>([]);
  // State for selected sidebar tab
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');
  // State for terminal panel visibility
  const [isTerminalPanelOpen, setIsTerminalPanelOpen] = useState(false); // State für Terminal-Panel

  // Get the content of the currently active tab
  const activeTabContent = tabs.find(t => t.id === activeTab)?.content || '';

  // Open a file in a new or existing tab and load its content
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

  // When activeFile changes, open the file in a tab
  useEffect(() => {
    if (activeFile) openFileInTab(activeFile);
    // eslint-disable-next-line
  }, [activeFile]);

  // Handle editor content change
  const handleEditorChange = (val: string | undefined) => {
    if (!activeTab) return;
    setTabs(tabs.map(tab =>
      tab.id === activeTab ? { ...tab, content: val ?? '', dirty: true } : tab
    ));
    if (onEditorChange) onEditorChange(val ?? '');
  };

  // Save the currently active tab
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    if (window.electron && window.electron.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('file:save', tab.path, tab.content);
      setTabs(tabs.map(t => t.id === tab.id ? { ...t, dirty: false } : t));
    }
    if (onSave && tab) onSave(tab.content);
  };

  // Listen for CTRL+S (or CMD+S) to trigger save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line
  }, [activeTab, tabs]);

  // Handle closing a tab
  const handleTabClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null);
    }
  };

  // Helper function to check if a file is a media file
  const isMediaFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    return imageExts.includes(ext) || videoExts.includes(ext);
  };

  // Toggle terminal panel visibility when sidebar tab changes
  useEffect(() => {
    setIsTerminalPanelOpen(sidebarTab === 'terminal');
  }, [sidebarTab]);

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout-root" style={{ display: 'flex', height: '100vh', width: '100vw' }}>
            {/* Sidebar is always visible */}
            <Sidebar activeTab={sidebarTab} onTabChange={setSidebarTab} />
            {/* Main content area, editor remains the same size */}
            <div className="editor-layout-main" style={{ flex: 1, position: 'relative', height: '100%' }}>
              {/* Editor content area (tabs, editor, etc.) */}
              <div style={{ height: '100%', width: '100%', position: 'relative' }}>
                <TabBar
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabClose={handleTabClose}
                  onTabSelect={setActiveTab}
                />
                {tabs.length > 0 && activeTab ? (
                  <Editor
                    height="100%"
                    defaultLanguage={initialLanguage}
                    defaultValue={activeTabContent}
                    value={activeTabContent}
                    onChange={handleEditorChange}
                    theme="vs-dark"
                    options={{
                      fontSize: 16,
                      minimap: { enabled: false },
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                ) : (
                  <div className="editor-empty-ui" style={{ flex: 1, height: '100%', width: '100%', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FaRegFile size={64} color="#888" style={{marginBottom: 16}} />
                    <div className="editor-empty-title">No file opened</div>
                    <div className="editor-empty-desc">Select a file in the explorer or create a new file to get started.</div>
                  </div>
                )}
              </div>
              {/* Terminal panel as an overlay */}
              {isTerminalPanelOpen && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 320,
                  zIndex: 20,
                  background: '#181818',
                  borderTop: '1px solid #333'
                }}>
                  <TerminalPanel onClose={() => setIsTerminalPanelOpen(false)} />
                </div>
              )}
              {/* File explorer */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 260, background: '#222', zIndex: 10 }}>
                <FileExplorer
                  fileStructure={fileStructure}
                  onOpenFile={openFileInTab}
                  activeFile={tabs.find(t => t.id === activeTab)?.path || ''}
                  projectPath={projectPath}
                />
              </div>
            </div>
            {isAIPanelOpen && (
              <div style={{ width: 340, minWidth: 260, maxWidth: 600, height: '100%', position: 'relative', display: 'flex' }}>
                <AIChatPanel />
              </div>
            )}
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
};