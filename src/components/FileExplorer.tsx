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
  activeFile?: string;
  projectPath?: string;
}

// Kontextmenü-Typen explizit deklarieren
interface ContextMenuProps {
  x: number;
  y: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onOpen, onRename, onDelete, onClose }) => (
  <ul className="file-context-menu" style={{ top: y, left: x, position: 'fixed', zIndex: 1000 }}>
    <li onClick={onOpen}>Öffnen</li>
    <li onClick={onRename}>Umbenennen</li>
    <li onClick={onDelete}>Löschen</li>
    <li onClick={onClose}>Abbrechen</li>
  </ul>
);

export const FileExplorer: React.FC<FileExplorerProps> = ({
  fileStructure,
  onOpenFile,
  activeFile = '',
  projectPath = ''
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, file: string} | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  // SCROLL-FIX: Explorer-Liste scrollbar machen
  // (max-height: 100%; overflow-y: auto)

  // Doppelklick öffnet Datei IMMER im Editor (rechter Bereich)
  const handleFileDoubleClick = (filePath: string) => {
    let absPath = filePath;
    if (!filePath.match(/^([a-zA-Z]:\\|\\\\)/)) {
      absPath = projectPath
        ? (projectPath.endsWith('\\') ? `${projectPath}${filePath}` : `${projectPath}\\${filePath}`)
        : filePath;
    }
    onOpenFile(absPath);
  };

  const toggleFolder = (path: string) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(path)) {
      newExpandedFolders.delete(path);
    } else {
      newExpandedFolders.add(path);
    }
    setExpandedFolders(newExpandedFolders);
  };

  // Kontextmenü-Handler
  const handleContextMenu = (e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file: filePath });
  };

  const handleOpenFromMenu = () => {
    if (contextMenu) {
      onOpenFile(contextMenu.file);
      setContextMenu(null);
    }
  };
  const handleRenameFromMenu = () => {
    if (contextMenu) {
      setRenamingFile(contextMenu.file);
      setRenameValue(contextMenu.file.split(/[\\/]/).pop() || '');
      setContextMenu(null);
    }
  };
  const handleDeleteFromMenu = () => {
    if (contextMenu) {
      // TODO: Datei löschen implementieren
      alert('Löschen: ' + contextMenu.file);
      setContextMenu(null);
    }
  };

  // Umbenennen bestätigen
  const handleRenameConfirm = () => {
    // TODO: Datei wirklich umbenennen (IPC/Backend)
    alert(`Datei umbenennen: ${renamingFile} => ${renameValue}`);
    setRenamingFile(null);
    setRenameValue('');
  };

  // Hilfsfunktion für Dateispezifische Icons
  function getFileIconByExtension(filename: string) {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return <span title="JavaScript" style={{color: '#f7e018'}}>[JS]</span>;
      case 'ts': case 'tsx': return <span title="TypeScript" style={{color: '#3178c6'}}>[TS]</span>;
      case 'json': return <span title="JSON" style={{color: '#cbcb41'}}>&#123;&#125;</span>;
      case 'md': return <span title="Markdown" style={{color: '#519975'}}>[MD]</span>;
      case 'css': return <span title="CSS" style={{color: '#563d7c'}}>[CSS]</span>;
      case 'html': return <span title="HTML" style={{color: '#e34c26'}}>[HTML]</span>;
      case 'py': return <span title="Python" style={{color: '#3572A5'}}>[PY]</span>;
      default: return <FileIcon />;
    }
  }

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
        tabIndex={0}
        onDoubleClick={() => handleFileDoubleClick(node.path)}
        onContextMenu={e => handleContextMenu(e, node.path)}
      >
        {getFileIconByExtension(node.name)}
        {renamingFile === node.path ? (
          <input
            type="text"
            value={renameValue}
            autoFocus
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRenameConfirm}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setRenamingFile(null); }}
            style={{ marginLeft: 8, fontSize: 14 }}
          />
        ) : (
          <span className="file-name">{node.name}</span>
        )}
      </div>
    );
  };

  return (
    <div className="file-explorer-root" style={{height:'100%',maxHeight:'100%',overflowY:'auto'}}>
      {fileStructure.map(node => renderFileNode(node))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onOpen={handleOpenFromMenu}
          onRename={handleRenameFromMenu}
          onDelete={handleDeleteFromMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};