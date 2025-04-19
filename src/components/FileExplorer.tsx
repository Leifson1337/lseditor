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
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const toggleFolder = (path: string) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(path)) {
      newExpandedFolders.delete(path);
    } else {
      newExpandedFolders.add(path);
    }
    setExpandedFolders(newExpandedFolders);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, node: FileNode) => {
    if (node.type !== 'file') return;
    if (e.key === 'Enter') {
      onOpenFile(node.path);
    }
  };

  const renderFileNode = (node: FileNode, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = activeFile === node.path;
    const isSelected = selectedFile === node.path;

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
        className={`file-node file ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
        data-level={level}
        tabIndex={0}
        onClick={() => setSelectedFile(node.path)}
        onDoubleClick={() => onOpenFile(node.path)}
        onKeyDown={(e) => handleKeyDown(e, node)}
      >
        {getFileIconByExtension(node.name)}
        <span className="file-name">{node.name}</span>
      </div>
    );
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && selectedFile) {
      onOpenFile(selectedFile);
    }
  };

  // Hilfsfunktion zur Auswahl eines passenden Icons anhand der Dateiendung
  const getFileIconByExtension = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
        return <span title="JavaScript" style={{color: '#f7e018'}}>[JS]</span>;
      case 'ts':
      case 'tsx':
        return <span title="TypeScript" style={{color: '#3178c6'}}>[TS]</span>;
      case 'json':
        return <span title="JSON" style={{color: '#cbcb41'}}>[&#123;&#125;]</span>;
      case 'md':
        return <span title="Markdown" style={{color: '#519975'}}>[MD]</span>;
      case 'css':
        return <span title="CSS" style={{color: '#563d7c'}}>[CSS]</span>;
      case 'html':
        return <span title="HTML" style={{color: '#e34c26'}}>[HTML]</span>;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
        return <span title="Bild" style={{color: '#c678dd'}}>[IMG]</span>;
      case 'svg':
        return <span title="SVG" style={{color: '#ffb13b'}}>[SVG]</span>;
      case 'sh':
      case 'bash':
        return <span title="Shell" style={{color: '#4ec9b0'}}>[SH]</span>;
      case 'py':
        return <span title="Python" style={{color: '#3572A5'}}>[PY]</span>;
      case 'lock':
        return <span title="Lockfile" style={{color: '#a0a0a0'}}>[LOCK]</span>;
      case 'yml':
      case 'yaml':
        return <span title="YAML" style={{color: '#cb171e'}}>[YML]</span>;
      case 'txt':
        return <span title="Text" style={{color: '#888'}}>[TXT]</span>;
      default:
        return <FileIcon />;
    }
  };

  return (
    <div className="file-explorer" tabIndex={0} onKeyDown={handleContainerKeyDown}>
      {fileStructure.map((node) => renderFileNode(node))}
    </div>
  );
};