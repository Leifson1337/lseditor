import React from 'react';
import './Layout.css';
import StatusBar from './StatusBar';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';
import { EditorLayout } from './EditorLayout';

// Props for the Layout component
interface LayoutProps {
  children: React.ReactNode; // Child components to render inside the layout
  initialContent?: string;   // Optional initial content for the editor
  initialLanguage?: string;  // Optional initial language for the editor
  fileStructure?: any[];     // Optional file structure for the project
  projectPath?: string;      // Optional project path
}

// Layout provides the main application structure, including titlebar, menubar, statusbar, and editor area
const Layout: React.FC<LayoutProps> = ({
  children,
  initialContent = '',
  initialLanguage = 'plaintext',
  fileStructure = [],
  projectPath = ''
}) => {
  return (
    <div className="app-container">
      {/* Titlebar with embedded MenuBar */}
      <Titlebar>
        <MenuBar onHelpAction={() => {}} onFileAction={() => {}} onEditAction={() => {}} recentProjects={[]} />
      </Titlebar>
      <div className="main-content">
        <div className="left-panel">
          {/* StatusBar displays file/terminal/project status */}
          <StatusBar activeFile={''} terminalPort={3001} isTerminalConnected={false} errorCount={0} problemCount={0} portForwardCount={0} />
        </div>
        <div className="editor-container" style={{width:'100%'}}>
          {/* EditorLayout handles the main editor and file navigation UI */}
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