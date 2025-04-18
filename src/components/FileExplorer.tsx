import React, { useState } from 'react';
import { FaFolder, FaFolderOpen, FaFile, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import './FileExplorer.css';

interface FileExplorerProps {
  fileStructure: any[];
  onOpenFile: (filePath: string) => void;
  activeFile: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const FileExplorer: React.FC<FileExplorerProps> = ({ fileStructure, onOpenFile, activeFile }) => {
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
    const indent = level * 20;

    if (node.type === 'directory') {
      return (
        <div key={node.path}>
          <div 
            className={`file-explorer-item ${isActive ? 'active' : ''}`}
            style={{ paddingLeft: `${indent}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className="file-explorer-icon">
              {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
            </span>
            <span className="file-explorer-icon">
              {isExpanded ? <FaFolderOpen /> : <FaFolder />}
            </span>
            <span className="file-explorer-name">{node.name}</span>
          </div>
          {isExpanded && node.children && (
            <div className="file-explorer-children">
              {node.children.map(child => renderFileNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <div 
          key={node.path}
          className={`file-explorer-item ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => onOpenFile(node.path)}
        >
          <span className="file-explorer-icon">
            <FaFile />
          </span>
          <span className="file-explorer-name">{node.name}</span>
        </div>
      );
    }
  };

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <h3>Explorer</h3>
      </div>
      <div className="file-explorer-content">
        {fileStructure.length > 0 ? (
          fileStructure.map(node => renderFileNode(node))
        ) : (
          <div className="empty-explorer">Keine Dateien gefunden</div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer; 