import React, { useState } from 'react';
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
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  initialContent = '',
  initialLanguage = 'typescript',
  onSave,
  onFileOpen,
  fileStructure,
  activeFile
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string }>>([]);

  const handleFileOpen = (path: string) => {
    if (onFileOpen) {
      onFileOpen(path);
    }
    
    // Add new tab if it doesn't exist
    if (!tabs.find(tab => tab.path === path)) {
      const newTab = {
        id: Math.random().toString(36).substr(2, 9),
        title: path.split('/').pop() || path,
        path
      };
      setTabs([...tabs, newTab]);
      setActiveTab(newTab.id);
    } else {
      setActiveTab(tabs.find(tab => tab.path === path)?.id || null);
    }
  };

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
                <Sidebar>
                  <FileExplorer
                    fileStructure={fileStructure}
                    onOpenFile={handleFileOpen}
                    activeFile={activeFile}
                  />
                </Sidebar>
              )}
              
              <div className="editor-container">
                <Editor
                  height="100%"
                  defaultLanguage={initialLanguage}
                  defaultValue={initialContent}
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
                />
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