import React, { useState, useEffect } from 'react';
import { FileExplorer } from './FileExplorer';
import { Editor } from './Editor';
import { TerminalContainer } from './TerminalContainer';
import { AIService } from '../services/AIService';
import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { store } from '../store/store';
import { FileNode } from '../types/FileNode';
import '../styles/Layout.css';

interface LayoutProps {
  fileStructure: FileNode[];
  onOpenFile: (path: string) => void;
  activeFile: string;
  terminalPort: number;
  isTerminalOpen: boolean;
  onTerminalOpen: () => void;
  onTerminalClose: () => void;
}

const Layout: React.FC<LayoutProps> = ({
  fileStructure,
  onOpenFile,
  activeFile,
  terminalPort,
  isTerminalOpen,
  onTerminalOpen,
  onTerminalClose
}) => {
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('Layout component mounted');
    console.log('File structure:', fileStructure);
    console.log('Active file:', activeFile);
    
    // If there's an active file, load its content
    if (activeFile) {
      loadFileContent(activeFile);
    } else {
      setIsLoading(false);
    }
  }, [activeFile]);

  const loadFileContent = async (filePath: string) => {
    setIsLoading(true);
    try {
      // In a real implementation, you would load the file content from the file system
      // For now, we'll just set a placeholder
      setFileContent(`// Content of ${filePath}`);
      setCurrentFile(filePath);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file content');
      setIsLoading(false);
    }
  };

  const handleFileOpen = (path: string) => {
    console.log('Opening file in Layout:', path);
    onOpenFile(path);
  };

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="sidebar">
        <FileExplorer
          fileStructure={fileStructure}
          onOpenFile={handleFileOpen}
          activeFile={currentFile}
        />
      </div>
      <div className="main-content">
        <Editor
          filePath={currentFile}
          content={fileContent}
          isLoading={isLoading}
        />
        {isTerminalOpen && (
          <TerminalContainer
            activeFile={currentFile}
            port={terminalPort}
          />
        )}
      </div>
    </div>
  );
};

export default Layout; 