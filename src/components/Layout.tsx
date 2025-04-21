import React, { useState } from 'react';
import './Layout.css';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import { FileExplorer } from './FileExplorer';
import { Terminal } from './Terminal';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';

function getLanguageFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    default:
      return 'plaintext';
  }
}

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
  const [openedFile, setOpenedFile] = useState<string>('');
  const [currentFileContent, setCurrentFileContent] = useState<string>('');
  const [currentLanguage, setCurrentLanguage] = useState<string>('plaintext');

  // Datei öffnen (wird vom FileExplorer aufgerufen)
  const handleOpenFile = async (filePath: string) => {
    if (!filePath) return;
    let fileContent = '';
    try {
      if (window.electron?.ipcRenderer?.invoke) {
        try {
          fileContent = await window.electron.ipcRenderer.invoke('fs:readFile', filePath) || '';
        } catch {
          fileContent = await window.electron.ipcRenderer.invoke('readFile', filePath) || '';
        }
      }
    } catch {
      fileContent = '';
    }
    setOpenedFile(filePath);
    setCurrentFileContent(fileContent);
    setCurrentLanguage(getLanguageFromExtension(filePath));
  };

  return (
    <div className="app-container">
      <Titlebar>
        <MenuBar onHelpAction={() => {}} onFileAction={() => {}} onEditAction={() => {}} recentProjects={[]} />
      </Titlebar>
      <div className="main-content">
        <div className="left-panel">
          <StatusBar activeFile={openedFile} terminalPort={3001} isTerminalConnected={false} errorCount={0} problemCount={0} portForwardCount={0} />
          <Sidebar activeTab={"explorer"} onTabChange={() => {}} />
          <div className="sidebar-content-panel">
            <FileExplorer fileStructure={fileStructure} onOpenFile={handleOpenFile} activeFile={openedFile} projectPath={projectPath} />
          </div>
        </div>
        <div className="editor-container">
          <div className="editor-area">
            <div className="editor-content">
              {openedFile ? (
                <div className="simple-editor-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '8px', background: '#1e1e1e', color: '#ddd', borderBottom: '1px solid #333' }}>
                    <strong>Datei:</strong> {openedFile}
                  </div>
                  <textarea 
                    style={{ 
                      flex: 1, 
                      background: '#1e1e1e', 
                      color: '#ddd', 
                      border: 'none', 
                      padding: '12px',
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      resize: 'none',
                      outline: 'none'
                    }}
                    value={currentFileContent}
                    onChange={e => setCurrentFileContent(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              ) : (
                <div className="empty-editor">
                  <h2>Keine Datei geöffnet</h2>
                  <p>Wählen Sie eine Datei aus dem Explorer aus, um sie zu bearbeiten.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Layout;