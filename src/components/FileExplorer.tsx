import React, { useState, useEffect, useRef } from 'react';
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
  onLiveUpdate?: (() => void) | undefined;
  onClose: () => void;
  isHtml?: boolean;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onOpen, onRename, onDelete, onLiveUpdate, onClose, isHtml }) => (
  <ul className="file-context-menu" style={{ top: y, left: x, position: 'fixed', zIndex: 1000 }}>
    <li onClick={onOpen}>Öffnen</li>
    <li onClick={onRename}>Umbenennen</li>
    <li onClick={onDelete}>Löschen</li>
    {isHtml && onLiveUpdate && <li onClick={onLiveUpdate}>Live-Update</li>}
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
  const [refreshKey, setRefreshKey] = useState<number>(0);

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

  // IPC-Hilfsfunktionen für Rename und Delete
  async function renameFile(oldPath: string, newName: string): Promise<boolean> {
    if (window.electron?.ipcRenderer.invoke) {
      try {
        // Versuche zuerst den neuen Handler
        await window.electron.ipcRenderer.invoke('fs:renameFile', oldPath, newName);
        return true;
      } catch (e: any) {
        alert('Fehler beim Umbenennen: ' + (typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
      }
    }
    return false;
  }
  async function deleteFile(filePath: string): Promise<boolean> {
    if (window.electron?.ipcRenderer.invoke) {
      try {
        await window.electron.ipcRenderer.invoke('fs:deleteFile', filePath);
        return true;
      } catch (e: any) {
        alert('Fehler beim Löschen: ' + (typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
      }
    }
    return false;
  }

  const handleDeleteFromMenu = async () => {
    if (contextMenu) {
      if (window.confirm('Datei wirklich löschen?')) {
        const success = await deleteFile(contextMenu.file);
        if (success) setRefreshKey(k => k + 1);
      }
      setContextMenu(null);
    }
  };

  // Umbenennen bestätigen
  const handleRenameConfirm = async () => {
    if (renamingFile && renameValue.trim() && renameValue !== renamingFile.split(/[\\/]/).pop()) {
      const dir = renamingFile.substring(0, renamingFile.lastIndexOf("/")) || renamingFile.substring(0, renamingFile.lastIndexOf("\\"));
      const newPath = dir ? dir + (dir.endsWith("/") || dir.endsWith("\\") ? '' : '/') + renameValue : renameValue;
      const success = await renameFile(renamingFile, newPath);
      setRenamingFile(null);
      setRenameValue('');
      if (success) setRefreshKey(k => k + 1);
    } else {
      setRenamingFile(null);
      setRenameValue('');
    }
  };

  // Live-Update für HTML-Dateien
  const [liveUpdateFile, setLiveUpdateFile] = useState<string | null>(null);
  const liveUpdateWindow = useRef<Window | null>(null);
  useEffect(() => {
    if (!liveUpdateFile) return;
    // Datei initial öffnen
    if (!liveUpdateWindow.current || liveUpdateWindow.current.closed) {
      liveUpdateWindow.current = window.open(`file://${liveUpdateFile}`, '_blank');
    } else {
      liveUpdateWindow.current.location.reload();
    }
    // Listener für Dateiänderungen (Tab-Änderung)
    const interval = setInterval(() => {
      if (liveUpdateWindow.current && !liveUpdateWindow.current.closed) {
        liveUpdateWindow.current.location.reload();
      }
    }, 2000); // alle 2 Sekunden reload (alternativ: auf echte Save-Events hören)
    return () => clearInterval(interval);
  }, [liveUpdateFile]);

  const handleLiveUpdate = (filePath: string) => {
    setLiveUpdateFile(filePath);
    // Direkt öffnen
    if (!liveUpdateWindow.current || liveUpdateWindow.current.closed) {
      liveUpdateWindow.current = window.open(`file://${filePath}`, '_blank');
    } else {
      liveUpdateWindow.current.location.href = `file://${filePath}`;
    }
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

  // Hilfsfunktion: Ordner oben, Dateien unten, alphabetisch sortiert
  function sortNodes(nodes: FileNode[]): FileNode[] {
    return [...nodes].sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      return a.type === 'directory' ? -1 : 1;
    }).map(node =>
      node.type === 'directory' && node.children
        ? { ...node, children: sortNodes(node.children) }
        : node
    );
  }

  const renderFileNode = (node: FileNode, level: number = 0) => {
    const isExpanded = expandedFolders.has(node.path);
    const isActive = activeFile === node.path;
    const isHtml = node.type === 'file' && node.name.toLowerCase().endsWith('.html');
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
              {sortNodes(node.children).map((child) => renderFileNode(child, level + 1))}
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
    <div className="file-explorer-root" style={{height:'100%',maxHeight:'100%',overflowY:'auto'}} key={refreshKey}>
      {sortNodes(fileStructure).map(node => renderFileNode(node))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onOpen={handleOpenFromMenu}
          onRename={handleRenameFromMenu}
          onDelete={handleDeleteFromMenu}
          onLiveUpdate={contextMenu.file.toLowerCase().endsWith('.html') ? () => handleLiveUpdate(contextMenu.file) : undefined}
          isHtml={contextMenu.file.toLowerCase().endsWith('.html')}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};