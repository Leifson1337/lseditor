import React, { useState, useRef, useEffect } from 'react';
import './MenuBar.css';

interface MenuBarProps {
  onHelpAction?: (action: string) => void;
  onFileAction?: (action: string, data?: any) => void;
  onEditAction?: (action: string, data?: any) => void;
  recentProjects?: string[];
}

const MenuBar: React.FC<MenuBarProps> = ({ onHelpAction, onFileAction, onEditAction, recentProjects = [] }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems = [
    'File',
    'Edit',
    'Selection',
    'View',
    'Go',
    'Run',
    'Terminal',
    'Help'
  ];

  // File menu items with their corresponding actions
  const fileMenuItems = [
    { id: 'newTextFile', label: 'New Text File' },
    { id: 'newWindow', label: 'New Window' },
    { id: 'openFile', label: 'Open File...' },
    { id: 'openFolder', label: 'Open Folder...' },
    { id: 'openWorkspaceFromFile', label: 'Open Workspace from File...' },
    { id: 'openRecent', label: 'Open Recent', hasSubmenu: true },
    { id: 'addFolderToWorkspace', label: 'Add Folder to Workspace...' },
    { id: 'saveWorkspaceAs', label: 'Save Workspace As...' },
    { id: 'duplicateWorkspace', label: 'Duplicate Workspace' },
    { id: 'divider1', isDivider: true },
    { id: 'save', label: 'Save', shortcut: 'Ctrl+S' },
    { id: 'saveAs', label: 'Save As...', shortcut: 'Ctrl+Shift+S' },
    { id: 'saveAll', label: 'Save All', shortcut: 'Ctrl+Alt+S' },
    { id: 'divider2', isDivider: true },
    { id: 'share', label: 'Share' },
    { id: 'divider3', isDivider: true },
    { id: 'autoSave', label: 'Auto Save', isToggle: true, isChecked: true },
    { id: 'revertFile', label: 'Revert File' },
    { id: 'divider4', isDivider: true },
    { id: 'closeEditor', label: 'Close Editor', shortcut: 'Ctrl+F4' },
    { id: 'closeFolder', label: 'Close Folder' },
    { id: 'closeWindow', label: 'Close Window', shortcut: 'Alt+F4' },
    { id: 'divider5', isDivider: true },
    { id: 'exit', label: 'Exit' }
  ];

  // Edit menu items with their corresponding actions
  const editMenuItems = [
    { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
    { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
    { id: 'divider1', isDivider: true },
    { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
    { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
    { id: 'divider2', isDivider: true },
    { id: 'find', label: 'Find', shortcut: 'Ctrl+F' },
    { id: 'replace', label: 'Replace', shortcut: 'Ctrl+H' },
    { id: 'findInFiles', label: 'Find in Files', shortcut: 'Ctrl+Shift+F' },
    { id: 'replaceInFiles', label: 'Replace in Files', shortcut: 'Ctrl+Shift+H' },
    { id: 'divider3', isDivider: true },
    { id: 'toggleLineComment', label: 'Toggle Line Comment', shortcut: 'Ctrl+/' },
    { id: 'toggleBlockComment', label: 'Toggle Block Comment', shortcut: 'Ctrl+Shift+/' }
  ];

  // Help menu items with their corresponding actions
  const helpMenuItems = [
    { id: 'showCommands', label: 'Show all Commands' },
    { id: 'editorPlayground', label: 'Editor Playground' },
    { id: 'accessibility', label: 'Get started with accessibility features' },
    { id: 'reportIssue', label: 'Report issue' },
    { id: 'devTools', label: 'Toggle Developer Tools' },
    { id: 'processExplorer', label: 'Open Process Explorer' },
    { id: 'checkUpdates', label: 'Check for Updates' },
    { id: 'about', label: 'About' }
  ];

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleMenuClick = (item: string) => {
    if (activeMenu === item) {
      setActiveMenu(null);
    } else {
      setActiveMenu(item);
    }
  };

  const handleHelpItemClick = (actionId: string) => {
    setActiveMenu(null);
    if (onHelpAction) {
      onHelpAction(actionId);
    }
  };

  const handleFileItemClick = (actionId: string, data?: any) => {
    setActiveMenu(null);
    if (onFileAction) {
      onFileAction(actionId, data);
    }
  };

  const handleEditItemClick = (actionId: string, data?: any) => {
    setActiveMenu(null);
    if (onEditAction) {
      onEditAction(actionId, data);
    }
  };

  const handleToggleItem = (actionId: string, currentState: boolean) => {
    if (onFileAction) {
      onFileAction(actionId, { isChecked: !currentState });
    }
  };

  return (
    <div className="menu-bar" ref={menuRef}>
      {menuItems.map((item) => (
        <div key={item} className="menu-item-container">
          <button 
            className={`menu-item ${activeMenu === item ? 'active' : ''}`}
            onClick={() => handleMenuClick(item)}
          >
            {item}
          </button>
          
          {activeMenu === 'File' && item === 'File' && (
            <div className="menu-dropdown file-menu-dropdown">
              {fileMenuItems.map((fileItem) => {
                if (fileItem.isDivider) {
                  return <div key={fileItem.id} className="menu-divider"></div>;
                }
                
                if (fileItem.id === 'openRecent') {
                  return (
                    <div key={fileItem.id} className="submenu-container">
                      <button className="dropdown-item with-submenu">
                        {fileItem.label}
                        <span className="submenu-arrow">▶</span>
                      </button>
                      <div className="submenu">
                        {recentProjects && recentProjects.length > 0 ? (
                          <>
                            {recentProjects.map((project, index) => (
                              <button
                                key={`recent-${index}`}
                                className="dropdown-item"
                                onClick={() => handleFileItemClick('openRecent', { path: project })}
                              >
                                {project}
                              </button>
                            ))}
                            <div className="menu-divider"></div>
                            <button
                              className="dropdown-item"
                              onClick={() => handleFileItemClick('clearRecentProjects')}
                            >
                              Clear Recently Opened
                            </button>
                          </>
                        ) : (
                          <div className="dropdown-item disabled">No Recent Projects</div>
                        )}
                      </div>
                    </div>
                  );
                }
                
                if (fileItem.isToggle) {
                  return (
                    <button
                      key={fileItem.id}
                      className={`dropdown-item toggle-item ${fileItem.isChecked ? 'checked' : ''}`}
                      onClick={() => handleToggleItem(fileItem.id, !!fileItem.isChecked)}
                    >
                      <span className="toggle-checkbox">
                        {fileItem.isChecked ? '✓' : ''}
                      </span>
                      {fileItem.label}
                    </button>
                  );
                }
                
                return (
                  <button
                    key={fileItem.id}
                    className="dropdown-item"
                    onClick={() => handleFileItemClick(fileItem.id)}
                  >
                    {fileItem.label}
                    {fileItem.shortcut && (
                      <span className="shortcut">{fileItem.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          
          {activeMenu === 'Edit' && item === 'Edit' && (
            <div className="menu-dropdown edit-menu-dropdown">
              {editMenuItems.map((editItem) => {
                if (editItem.isDivider) {
                  return <div key={editItem.id} className="menu-divider"></div>;
                }
                
                return (
                  <button
                    key={editItem.id}
                    className="dropdown-item"
                    onClick={() => handleEditItemClick(editItem.id)}
                  >
                    {editItem.label}
                    {editItem.shortcut && (
                      <span className="shortcut">{editItem.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          
          {activeMenu === 'Help' && item === 'Help' && (
            <div className="menu-dropdown help-menu-dropdown">
              {helpMenuItems.map((helpItem) => (
                <button 
                  key={helpItem.id}
                  className="dropdown-item"
                  onClick={() => handleHelpItemClick(helpItem.id)}
                >
                  {helpItem.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default MenuBar;