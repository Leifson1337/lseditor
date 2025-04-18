import React, { useState } from 'react';
import { FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon } from './Icons';
import '../styles/FileExplorer.css';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileExplorerProps {
  fileStructure: FileNode[];
  onOpenFile: (filePath: string) => void;
  activeFile?: string | null;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  fileStructure,
  onOpenFile,
  activeFile
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(path)) {
      newExpandedFolders.delete(path);
    } else {
      newExpandedFolders.add(path);
    }
    setExpandedFolders(newExpandedFolders);
  };

  const renderFileNode = (node: FileNode, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = activeFile === node.path;

    if (node.type === 'directory') {
      return (
        <div key={node.path}>
          <div
            className={`file-node folder ${isExpanded ? 'expanded' : ''}`}
            data-level={level}
            onClick={() => toggleFolder(node.path)}
          >
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <FolderIcon />
            <span className="file-name">{node.name}</span>
          </div>
          {isExpanded && node.children && (
            <div className="file-children">
              {node.children.map((child) => renderFileNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className={`file-node file ${isActive ? 'active' : ''}`}
        data-level={level}
        onClick={() => onOpenFile(node.path)}
      >
        <FileIcon />
        <span className="file-name">{node.name}</span>
      </div>
    );
  };

  if (!fileStructure || fileStructure.length === 0) {
    return (
      <div className="file-explorer empty">
        <p>No files available</p>
      </div>
    );
  }

  return (
    <div className="file-explorer">
      {fileStructure.map((node) => renderFileNode(node))}
    </div>
  );
}; 