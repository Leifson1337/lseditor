import React, { useEffect } from 'react';
import { FolderIcon, FileIcon } from '../components/Icons';
import '../styles/FileExplorer.css';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileExplorerProps {
  onOpenFile: (path: string) => void;
  fileStructure?: FileNode[];
  activeFile?: string;
  onFileSelect?: (file: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ 
  onOpenFile, 
  fileStructure = [], 
  activeFile,
  onFileSelect 
}) => {
  useEffect(() => {
    console.log('FileExplorer component mounted');
    console.log('FileExplorer fileStructure:', fileStructure);
    console.log('FileExplorer activeFile:', activeFile);
  }, [fileStructure, activeFile]);

  const renderFileNode = (node: FileNode, level: number = 0) => {
    const Icon = node.type === 'directory' ? FolderIcon : FileIcon;
    const className = `file-node ${node.type} ${level > 0 ? 'file-tree-indent' : ''} ${node.path === activeFile ? 'active' : ''}`;

    const handleClick = () => {
      onOpenFile(node.path);
      if (onFileSelect && node.type === 'file') {
        onFileSelect(node.path);
      }
    };

    return (
      <div key={node.path}>
        <div className={className} onClick={handleClick}>
          <Icon />
          <span className="file-name">{node.name}</span>
        </div>
        {node.type === 'directory' && node.children && (
          <div className="file-children">
            {node.children.map(child => renderFileNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  console.log('FileExplorer rendering');

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <h3>Explorer</h3>
      </div>
      <div className="file-tree">
        {fileStructure.length > 0 ? (
          fileStructure.map(node => renderFileNode(node))
        ) : (
          <div className="empty-file-explorer">
            <p>No files available</p>
            <p>Open a project to see files</p>
          </div>
        )}
      </div>
    </div>
  );
}; 