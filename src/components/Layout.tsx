import React from 'react';
import './Layout.css';
import StatusBar from './StatusBar';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';
import { EditorLayout } from './EditorLayout';

interface LayoutProps {
  children: React.ReactNode;
  initialContent?: string;
  initialLanguage?: string;
  fileStructure?: any[];
  projectPath?: string;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  initialContent = '',
  initialLanguage = 'plaintext',
  fileStructure = [],
  projectPath = ''
}) => {
  return (
    <div className="app-container">
      <Titlebar>
        <MenuBar onHelpAction={() => {}} onFileAction={() => {}} onEditAction={() => {}} recentProjects={[]} />
      </Titlebar>
      <div className="main-content">
        <div className="left-panel">
          <StatusBar activeFile={''} terminalPort={3001} isTerminalConnected={false} errorCount={0} problemCount={0} portForwardCount={0} />
        </div>
        <div className="editor-container" style={{width:'100%'}}>
          <EditorLayout
            fileStructure={fileStructure}
            projectPath={projectPath}
          />
        </div>
      </div>
    </div>
  );
};

export default Layout;