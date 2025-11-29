import React, { useState, useEffect, useRef } from 'react';
import { FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon } from './Icons';
import '../styles/FileExplorer.css';

// FileNode describes a node in the file tree (either a file or directory)
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// Props for the FileExplorer component
interface FileExplorerProps {
  fileStructure: FileNode[];
  onOpenFile: (filePath: string) => void;
  activeFile?: string;
  projectPath?: string;
}

// Props for the context menu (right-click menu) in the file explorer
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

// ContextMenu renders the right-click context menu for files
const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onOpen, onRename, onDelete, onLiveUpdate, onClose, isHtml }) => (
  <ul className="file-context-menu" style={{ top: y, left: x, position: 'fixed', zIndex: 1000 }}>
    <li onClick={onOpen}>Open</li>
    <li onClick={onRename}>Rename</li>
    <li onClick={onDelete}>Delete</li>
    {isHtml && onLiveUpdate && <li onClick={onLiveUpdate}>Live-Update</li>}
    <li onClick={onClose}>Cancel</li>
  </ul>
);

export const FileExplorer: React.FC<FileExplorerProps> = ({
  fileStructure,
  onOpenFile,
  activeFile = '',
  projectPath = ''
}) => {
  // Tracks expanded (open) folders in the explorer
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Context menu state: coordinates and file path
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, file: string} | null>(null);
  // File currently being renamed
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  // Value for the rename input
  const [renameValue, setRenameValue] = useState<string>('');
  // Used to force refresh the explorer (e.g., after rename/delete)
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Double-clicking a file always opens it in the editor
  const handleFileDoubleClick = (filePath: string) => {
    let absPath = filePath;
    if (!filePath.match(/^([a-zA-Z]:\\|\\\\)/)) {
      absPath = projectPath
        ? (projectPath.endsWith('\\') ? `${projectPath}${filePath}` : `${projectPath}\\${filePath}`)
        : filePath;
    }
    onOpenFile(absPath);
  };

  // Toggle folder open/closed state
  const toggleFolder = (path: string) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(path)) {
      newExpandedFolders.delete(path);
    } else {
      newExpandedFolders.add(path);
    }
    setExpandedFolders(newExpandedFolders);
  };

  // Show context menu on right-click
  const handleContextMenu = (e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file: filePath });
  };

  // Context menu handler: open file
  const handleOpenFromMenu = () => {
    if (contextMenu) {
      onOpenFile(contextMenu.file);
      setContextMenu(null);
    }
  };
  // Context menu handler: start renaming file
  const handleRenameFromMenu = () => {
    if (contextMenu) {
      setRenamingFile(contextMenu.file);
      setRenameValue(contextMenu.file.split(/[\\/]/).pop() || '');
      setContextMenu(null);
    }
  };

  // Rename a file via IPC
  async function renameFile(oldPath: string, newName: string): Promise<boolean> {
    if (window.electron?.ipcRenderer.invoke) {
      try {
        await window.electron.ipcRenderer.invoke('fs:renameFile', oldPath, newName);
        return true;
      } catch (e: any) {
        alert('Error renaming: ' + (typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
      }
    }
    return false;
  }
  // Delete a file via IPC
  async function deleteFile(filePath: string): Promise<boolean> {
    if (window.electron?.ipcRenderer.invoke) {
      try {
        await window.electron.ipcRenderer.invoke('fs:deleteFile', filePath);
        return true;
      } catch (e: any) {
        alert('Error deleting: ' + (typeof e === 'object' && 'message' in e ? (e as any).message : String(e)));
      }
    }
    return false;
  }

  // Context menu handler: delete file
  const handleDeleteFromMenu = async () => {
    if (contextMenu) {
      if (window.confirm('Really delete file?')) {
        const success = await deleteFile(contextMenu.file);
        if (success) setRefreshKey(k => k + 1);
      }
      setContextMenu(null);
    }
  };

  // Confirm file rename
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

  // Live preview for HTML files in a separate window
  const [liveUpdateFile, setLiveUpdateFile] = useState<string | null>(null);
  const liveUpdateWindow = useRef<Window | null>(null);
  useEffect(() => {
    if (!liveUpdateFile) return;
    // Open file in new window or reload if already open
    if (!liveUpdateWindow.current || liveUpdateWindow.current.closed) {
      liveUpdateWindow.current = window.open(`file://${liveUpdateFile}`, '_blank');
    } else {
      liveUpdateWindow.current.location.reload();
    }
    // Reload every 2 seconds for live updates (could be improved to listen for save events)
    const interval = setInterval(() => {
      if (liveUpdateWindow.current && !liveUpdateWindow.current.closed) {
        liveUpdateWindow.current.location.reload();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [liveUpdateFile]);

  // Trigger live update for an HTML file
  const handleLiveUpdate = (filePath: string) => {
    setLiveUpdateFile(filePath);
    // Open or reload the preview window
    if (!liveUpdateWindow.current || liveUpdateWindow.current.closed) {
      liveUpdateWindow.current = window.open(`file://${filePath}`, '_blank');
    } else {
      liveUpdateWindow.current.location.href = `file://${filePath}`;
    }
  };

  // Return an icon based on file extension
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

  // Sort nodes: folders first, then files, both alphabetically
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

  // Render a file or folder node recursively
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

  // Main render: file explorer root, context menu
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