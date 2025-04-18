import React, { useState } from 'react';
import './Layout.css';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import AIToolbar from './AIToolbar';
import AIChat from './AIChat';
import { FileExplorer } from './FileExplorer';
import { Terminal } from './Terminal';

interface LayoutProps {
  children: React.ReactNode;
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

  const renderSidebarContent = () => {
    switch (activeTab) {
      case 'explorer':
        return (
          <FileExplorer 
            fileStructure={fileStructure} 
            onOpenFile={onOpenFile}
            activeFile={activeFile}
          />
        );
      case 'terminal':
        return (
          <div className="terminal-container">
            <Terminal 
              onData={(data) => console.log('Terminal data:', data)}
              onResize={(cols, rows) => console.log('Terminal resize:', cols, rows)}
            />
          </div>
        );
      default:
        return <div className="empty-sidebar-content">Wählen Sie eine Option aus</div>;
    }
  };

  return (
    <div className="app-container">
      <div className="main-content">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
        >
          <div className="sidebar-content">
            {renderSidebarContent()}
          </div>
        </Sidebar>
        <div className="editor-container">
          <div className="editor-area">
            <div className="editor-content">
              {children}
            </div>
          </div>
          <StatusBar
            activeFile={activeFile}
            terminalPort={terminalPort}
            isTerminalConnected={isTerminalOpen}
          />
        </div>
        <div className="right-panel">
          <div className="ai-sidebar">
            <AIToolbar onAction={handleAIAction} isVertical={true} />
          </div>
          <div className="ai-content">
            <AIChat
              isOpen={true}
              messages={messages}
              onSendMessage={handleSendMessage}
              onClose={() => setIsAIChatOpen(false)}
              onInsertCode={handleInsertCode}
              onExplain={handleExplain}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Layout; 