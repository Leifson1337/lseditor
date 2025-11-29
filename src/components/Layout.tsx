import React, { ReactNode } from 'react';
import './Layout.css';
import StatusBar, { StatusBarProps } from './StatusBar';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';
import { EditorLayout } from './EditorLayout';

// Props for the Layout component
interface LayoutProps {
  children?: ReactNode; // Child components to render inside the layout
  initialContent?: string;   // Optional initial content for the editor
  initialLanguage?: string;  // Optional initial language for the editor
  fileStructure?: any[];     // Optional file structure for the project
  projectPath?: string;      // Optional project path
  onHelpAction?: (action: string) => void;
  onFileAction?: (action: string, data?: any) => void;
  onEditAction?: (action: string, data?: any) => void;
  onMenuAction?: (menu: string, actionId: string, data?: any) => void;
  recentProjects?: string[];
  updateAvailable?: boolean;
  isCheckingUpdates?: boolean;
  statusBar?: StatusBarProps;
}

// Layout provides the main application structure, including titlebar, menubar, statusbar, and editor area
const Layout: React.FC<LayoutProps> = ({
  children,
  initialContent = '',
  initialLanguage = 'plaintext',
  fileStructure = [],
  projectPath = '',
  onHelpAction,
  onFileAction,
  onEditAction,
  onMenuAction,
  recentProjects = [],
  updateAvailable = false,
  isCheckingUpdates = false,
  statusBar
}) => {
  const editorContent =
    children ?? (
      <EditorLayout
        initialContent={initialContent}
        initialLanguage={initialLanguage}
        fileStructure={fileStructure}
        projectPath={projectPath}
      />
    );

  return (
    <div className="app-container">
      {/* Titlebar with embedded MenuBar */}
      <Titlebar>
        <MenuBar
          onHelpAction={onHelpAction}
          onFileAction={onFileAction}
          onEditAction={onEditAction}
          onMenuAction={onMenuAction}
          recentProjects={recentProjects}
          updateAvailable={updateAvailable}
          isCheckingUpdates={isCheckingUpdates}
        />
      </Titlebar>
      <div className="main-content">
        <div className="left-panel">
          <StatusBar
            activeFile={statusBar?.activeFile}
            terminalPort={statusBar?.terminalPort}
            isTerminalConnected={statusBar?.isTerminalConnected}
            errorCount={statusBar?.errorCount}
            problemCount={statusBar?.problemCount}
            portForwardCount={statusBar?.portForwardCount}
          />
        </div>
        <div className="editor-container" style={{width:'100%'}}>
          {/* EditorLayout handles the main editor and file navigation UI */}
          {editorContent}
        </div>
      </div>
    </div>
  );
};

export default Layout;
