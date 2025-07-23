import React from 'react';
import './Layout.css';
import StatusBar from './StatusBar';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';
import { EditorLayout } from './EditorLayout';
import Sidebar from './Sidebar';
import { TerminalPanel } from './TerminalPanel';

interface LayoutProps {
  children: React.ReactNode;
  initialContent?: string;
  initialLanguage?: string;
  fileStructure?: any[];
  projectPath?: string;
  onTabChange?: (tab: string) => void;
  activeTab?: string;
  isTerminalOpen?: boolean;
  onTerminalToggle?: () => void;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  fileStructure = [],
  projectPath = '',
  onTabChange = () => {},
  activeTab = 'explorer',
  isTerminalOpen = false,
  onTerminalToggle = () => {}
}) => {
  return (
    <div className="app-container">
      <Titlebar>
        <MenuBar 
          onHelpAction={() => {}} 
          onFileAction={() => {}} 
          onEditAction={() => {}} 
          recentProjects={[]} 
        />
      </Titlebar>
      
      <div className="main-content">
        <div className="left-panel">
          <Sidebar onTabChange={onTabChange} activeTab={activeTab} />
          <StatusBar 
            activeFile={''} 
            terminalPort={3001} 
            isTerminalConnected={false} 
            errorCount={0} 
            problemCount={0} 
            portForwardCount={0} 
          />
        </div>
        
        <div className="editor-container" style={{ 
          display: 'flex', 
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          position: 'relative'
        }}>
          <div style={{ 
            flex: isTerminalOpen ? '1 1 70%' : '1 1 100%',
            minHeight: 0,
            overflow: 'hidden'
          }}>
            {children}
          </div>
          
          <TerminalPanel 
            onClose={onTerminalToggle} 
            isVisible={isTerminalOpen} 
          />
        </div>
      </div>
    </div>
  );
};

export default Layout;