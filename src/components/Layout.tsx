import React, { useState, useEffect } from 'react';
import { FileExplorer } from './FileExplorer';
import { AIChat } from './AIChat';
import { CodeEditor } from './Editor';
import StatusBar from './StatusBar';
import '../styles/Layout.css';
import Sidebar from './Sidebar';
import AIToolbar from './AIToolbar';
import { Terminal } from './Terminal';

interface LayoutProps {
  children?: React.ReactNode;
  initialContent?: string;
  initialLanguage?: string;
  fileStructure?: any[];
  onOpenFile?: (filePath: string) => void;
  activeFile?: string;
  terminalPort?: number;
  isTerminalOpen?: boolean;
  onTerminalOpen?: () => void;
  onTerminalClose?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  initialContent = '', 
  initialLanguage = 'plaintext',
  fileStructure = [],
  onOpenFile = () => {},
  activeFile = '',
  terminalPort = 3001,
  isTerminalOpen = false,
  onTerminalOpen = () => {},
  onTerminalClose = () => {}
}) => {
  const [activeTab, setActiveTab] = useState('explorer');
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    console.log('Layout component mounted');
    // Initialisiere die Anwendung
    setIsInitialized(true);
    console.log('Layout initialization complete');
  }, []);

  const handleAIAction = (action: string) => {
    setIsAIChatOpen(true);
    console.log('AI Action:', action);
  };

  const handleSendMessage = (message: string) => {
    console.log('Sending message:', message);
  };

  const handleInsertCode = (code: string) => {
    console.log('Inserting code:', code);
  };

  const handleExplain = (code: string) => {
    console.log('Explaining code:', code);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'terminal' && onTerminalOpen) {
      onTerminalOpen();
    }
  };

  const toggleAIPanel = () => setIsAIPanelOpen(!isAIPanelOpen);
  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleFileSelect = (file: string) => {
    setCurrentFile(file);
  };

  const handleSave = (content: string) => {
    // TODO: Implement file saving logic
    console.log('Saving content:', content);
  };

  const renderSidebarContent = () => {
    console.log('Rendering sidebar content, activeTab:', activeTab);
    switch (activeTab) {
      case 'explorer':
        return (
          <FileExplorer 
            fileStructure={fileStructure} 
            onOpenFile={onOpenFile}
            activeFile={activeFile}
            onFileSelect={handleFileSelect}
          />
        );
      case 'terminal':
        console.log('Rendering terminal tab');
        return (
          <div className="terminal-container">
            <Terminal 
              onData={(data: string) => {
                console.log('Terminal data received:', data);
              }}
              onResize={(cols: number, rows: number) => {
                console.log('Terminal resize:', cols, rows);
              }}
            />
          </div>
        );
      default:
        return <div className="empty-sidebar-content">Select an option</div>;
    }
  };

  console.log('Layout rendering, isInitialized:', isInitialized);

  if (!isInitialized) {
    return <div className="app-container">Loading...</div>;
  }

  return (
    <div className="app-container">
      <div className="main-content">
        {isSidebarOpen && (
          <div className="sidebar">
            <Sidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
            >
              {renderSidebarContent()}
            </Sidebar>
          </div>
        )}
        
        <div className="editor-container">
          <div className="editor-area">
            <div className="editor-content">
              <CodeEditor 
                file={currentFile}
                onSave={handleSave}
                initialContent={initialContent}
                initialLanguage={initialLanguage}
              />
            </div>
          </div>
        </div>

        {isAIPanelOpen && (
          <div className="right-panel">
            <div className="ai-sidebar">
              <AIToolbar onAction={handleAIAction} isVertical={true} />
            </div>
            <div className="ai-content">
              <AIChat
                isOpen={isAIChatOpen}
                messages={messages}
                onSendMessage={handleSendMessage}
                onClose={() => setIsAIChatOpen(false)}
                onInsertCode={handleInsertCode}
                onExplain={handleExplain}
              />
            </div>
          </div>
        )}
      </div>
      
      <StatusBar
        activeFile={activeFile}
        terminalPort={terminalPort}
        isTerminalConnected={isTerminalOpen}
      />
    </div>
  );
};

export default Layout; 