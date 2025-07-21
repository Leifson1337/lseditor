// Import necessary dependencies
import React, { useState, useRef, useEffect } from 'react';
import './MenuBar.css';
import SettingsIcon from './SettingsIcon'; // Import the SettingsIcon component

// Props for the MenuBar component
interface MenuBarProps {
  onHelpAction?: (action: string) => void;         // Callback for Help menu actions
  onFileAction?: (action: string, data?: any) => void; // Callback for File menu actions
  onEditAction?: (action: string, data?: any) => void; // Callback for Edit menu actions
  recentProjects?: string[];                      // List of recent projects
}

// MenuBar renders the main application menu bar with File, Edit, View, etc.
const MenuBar: React.FC<MenuBarProps> = ({ onHelpAction, onFileAction, onEditAction, recentProjects = [] }) => {
  // State for the currently active/open menu
  const [activeMenu, setActiveMenu] = useState<string | null>(null); // State to track the currently active menu
  // Ref for detecting clicks outside the menu
  const menuRef = useRef<HTMLDivElement>(null); // Ref to detect clicks outside the menu

  // Top-level menu items
  const menuItems = [
    'File',
    'Edit',
    'Selection',
    'View',
    'Go',
    'Run',
    'Terminal',
    'Help'
  ]; // Array of top-level menu items

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
  ]; // Array of File menu items

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
  ]; // Array of Edit menu items

  // Run menu items with their corresponding actions
  const runMenuItems = [
    { id: 'startDebugging', label: 'Start Debugging' },
    { id: 'runWithoutDebugging', label: 'Run Without Debugging' },
    { id: 'stopDebugging', label: 'Stop Debugging' },
    { id: 'restartDebugging', label: 'Restart Debugging' },
    { id: 'openConfigurations', label: 'Open Configurations' },
    { id: 'addConfiguration', label: 'Add Configuration...' },
    { id: 'stepOver', label: 'Step Over' },
    { id: 'stepInto', label: 'Step Into' },
    { id: 'stepOut', label: 'Step Out' },
    { id: 'continue', label: 'Continue' },
    { id: 'toggleBreakpoint', label: 'Toggle Breakpoint' },
    { id: 'newBreakpoint', label: 'New Breakpoint...' },
    { id: 'enableAllBreakpoints', label: 'Enable All Breakpoints' },
    { id: 'disableAllBreakpoints', label: 'Disable All Breakpoints' },
    { id: 'removeAllBreakpoints', label: 'Remove All Breakpoints' },
    { id: 'installAdditionalDebuggers', label: 'Install Additional Debuggers...' },
  ]; // Array of Run menu items

  // Terminal menu items with their corresponding actions
  const terminalMenuItems = [
    { id: 'newTerminal', label: 'New Terminal' },
    { id: 'splitTerminal', label: 'Split Terminal' },
    { id: 'runTask', label: 'Run Task...' },
    { id: 'runBuildTask', label: 'Run Build Task...' },
    { id: 'runActiveFile', label: 'Run Active File' },
    { id: 'runSelectedText', label: 'Run Selected Text' },
    { id: 'showRunningTasks', label: 'Show Running Tasks' },
    { id: 'restartRunningTask', label: 'Restart Running Task' },
    { id: 'terminateTask', label: 'Terminate Task' },
    { id: 'configureTasks', label: 'Configure Tasks...' },
    { id: 'configureDefaultBuildTask', label: 'Configure Default Build Task...' },
  ]; // Array of Terminal menu items

  // Selection menu items with their corresponding actions
  const selectionMenuItems = [
    { id: 'selectAll', label: 'Select All' },
    { id: 'expandSelection', label: 'Expand Selection' },
    { id: 'shrinkSelection', label: 'Shrink Selection' },
    { id: 'copyLineUp', label: 'Copy Line Up' },
    { id: 'copyLineDown', label: 'Copy Line Down' },
    { id: 'moveLineUp', label: 'Move Line Up' },
    { id: 'moveLineDown', label: 'Move Line Down' },
    { id: 'duplicateSelection', label: 'Duplicate Selection' },
    { id: 'addCursorAbove', label: 'Add Cursor Above' },
    { id: 'addCursorBelow', label: 'Add Cursor Below' },
    { id: 'addCursorToLineEnds', label: 'Add Cursor to Line Ends' },
    { id: 'addNextOccurrence', label: 'Add Next Occurrence' },
    { id: 'addPreviousOccurrence', label: 'Add Previous Occurrence' },
    { id: 'selectAllOccurrences', label: 'Select All Occurrences' },
    { id: 'switchToCtrlClickMultiCursor', label: 'Switch to Ctrl+Click for Multi-Cursor' },
    { id: 'columnSelectionMode', label: 'Column Selection Mode' },
  ]; // Array of Selection menu items

  // Go menu items with their corresponding actions
  const goMenuItems = [
    { id: 'goBack', label: 'Back' },
    { id: 'goForward', label: 'Forward' },
    { id: 'lastEditLocation', label: 'Last Edit Location' },
    { id: 'switchEditor', label: 'Switch Editor' },
    { id: 'switchGroup', label: 'Switch Group' },
    { id: 'goToFile', label: 'Go to File...' },
    { id: 'goToSymbolInWorkspace', label: 'Go to Symbol in Workspace...' },
    { id: 'goToSymbolInEditor', label: 'Go to Symbol in Editor...' },
    { id: 'goToDefinition', label: 'Go to Definition' },
    { id: 'goToDeclaration', label: 'Go to Declaration' },
    { id: 'goToTypeDefinition', label: 'Go to Type Definition' },
    { id: 'goToImplementations', label: 'Go to Implementations' },
    { id: 'addSymbolToCurrentChat', label: 'Add Symbol to Current Chat' },
    { id: 'goToReferences', label: 'Go to References' },
    { id: 'addSymbolToNewChat', label: 'Add Symbol to New Chat' },
    { id: 'goToLineColumn', label: 'Go to Line/Column...' },
    { id: 'goToBracket', label: 'Go to Bracket' },
    { id: 'nextProblem', label: 'Next Problem' },
    { id: 'previousProblem', label: 'Previous Problem' },
    { id: 'nextChange', label: 'Next Change' },
    { id: 'previousChange', label: 'Previous Change' },
  ]; // Array of Go menu items

  // Function to open the About window
  const openAboutWindow = () => {
    // Create a new browser window with the about page
    const aboutWindow = window.open('', '_blank', 
      'width=700,height=600,resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no'
    );
    
    if (aboutWindow) {
      // Set the content of the new window
      aboutWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>About LSEditor</title>
          <link rel="icon" href="${window.location.origin}/logo.png" />
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              background: linear-gradient(135deg, #1e1e2e 0%, #1e1e1e 100%);
              color: #e0e0e0;
              height: 100vh;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              -webkit-font-smoothing: antialiased;
            }
            .about-container {
              flex: 1;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: flex-start;
              padding: 40px 50px 20px;
              text-align: center;
              overflow-y: auto;
              max-height: 100%;
            }
            .logo {
              width: 160px;
              height: 160px;
              margin: 0 auto 30px;
              position: relative;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            }
            .logo img {
              max-width: 100%;
              max-height: 100%;
              border-radius: 20px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            }
            @keyframes shine {
              0% { transform: rotate(45deg) translateX(-100%); }
              20% { transform: rotate(45deg) translateX(100%); }
              100% { transform: rotate(45deg) translateX(100%); }
            }
            .logo-placeholder {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              background: linear-gradient(135deg, #0078d4 0%, #1e88e5 100%);
              border-radius: 20px;
              color: white;
              font-size: 40px;
              font-weight: 800;
              text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            }
            h1 {
              margin: 0 0 8px 0;
              font-size: 24px;
              font-weight: 600;
              background: linear-gradient(90deg, #e0e0e0, #a0a0a0);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
            }
            .version {
              font-size: 14px;
              color: #a0a0a0;
              margin: 10px 0 20px;
              padding: 6px 12px;
              background: rgba(255, 255, 255, 0.05);
              border-radius: 12px;
              display: inline-block;
            }
            .features {
              display: flex;
              justify-content: center;
              gap: 15px;
              margin: 20px 0;
              flex-wrap: wrap;
              max-width: 100%;
            }
            .feature {
              background: rgba(255, 255, 255, 0.05);
              padding: 10px 15px;
              border-radius: 6px;
              font-size: 13px;
              color: #a0a0a0;
              transition: all 0.3s ease;
              white-space: nowrap;
            }
            .footer {
              padding: 15px 20px;
              background: rgba(25, 25, 35, 0.95);
              text-align: center;
              font-size: 13px;
              color: #aaa;
              border-top: 1px solid #333;
              display: flex;
              justify-content: space-between;
              align-items: center;
              position: relative;
              z-index: 10;
            }
            .copyright {
              font-size: 12px;
              color: #999;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .copyright::before {
              content: '©';
              font-size: 14px;
              color: #777;
            }
            .license-button {
              background: rgba(0, 120, 212, 0.2);
              border: 1px solid rgba(0, 120, 212, 0.4);
              color: #4db3ff;
              padding: 6px 14px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s ease;
              text-decoration: none;
              display: inline-flex;
              align-items: center;
              gap: 6px;
            }
            .license-button:hover {
              background: rgba(0, 120, 212, 0.3);
              border-color: rgba(0, 120, 212, 0.6);
              color: #66c1ff;
              transform: translateY(-1px);
            }
          </style>
        </head>
        <body>
          <div class="about-container">
            <div class="logo">
              <img src="${window.location.origin}/logo.png" alt="LSEditor Logo" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'logo-placeholder\'>LS</div>'" />
            </div>
            <h1>LSEditor</h1>
            <div class="version">Version 1.0.0</div>
            <div style="margin-bottom: 20px; color: #888; max-width: 80%; line-height: 1.5; font-size: 14px;">
              A powerful code editor for modern development.
            </div>
            <div class="features">
              <div class="feature">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                Fast & Lightweight
              </div>
              <div class="feature">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                Cross-Platform
              </div>
              <div class="feature">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                Built for Performance
              </div>
            </div>
          </div>
          <div class="footer">
            <span class="copyright">2025 Leifson1337. All rights reserved.</span>
            <a href="https://github.com/Leifson1337/lseditor/blob/master/LICENSE" target="_blank" class="license-button">
              <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 4px;">
                <path d="M11 13V5C11 4.44772 10.5523 4 10 4H2C1.44772 4 1 4.44772 1 5V13C1 13.5523 1.44772 14 2 14H10C10.5523 14 11 13.5523 11 13Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M3 4V2C3 1.44772 3.44772 1 4 1H8C8.55228 1 9 1.44772 9 2V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 7H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M4 10H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              View License
            </a>
          </div>
          <script>
            // Prevent right-click context menu
            document.addEventListener('contextmenu', e => e.preventDefault());
          </script>
        </body>
        </html>
      `);
      aboutWindow.document.close();
    }
  };

  // Help menu items with their corresponding actions
  const helpMenuItems = [
    { id: 'showCommands', label: 'Show all Commands' },
    { id: 'editorPlayground', label: 'Editor Playground' },
    { id: 'accessibility', label: 'Get started with accessibility features' },
    { 
      id: 'reportIssue', 
      label: 'Report Issue',
      onClick: () => {
        window.electron?.ipcRenderer?.invoke('open-external', 'https://github.com/Leifson1337/lseditor/issues/new')
          .catch(() => {
            // Fallback to window.open if IPC fails
            window.open('https://github.com/Leifson1337/lseditor/issues/new', '_blank');
          });
      }
    },
    { id: 'devTools', label: 'Toggle Developer Tools' },
    { id: 'processExplorer', label: 'Open Process Explorer' },
    { id: 'checkUpdates', label: 'Check for Updates' },
    { 
      id: 'about', 
      label: 'About',
      onClick: openAboutWindow
    }
  ]; // Array of Help menu items

  // View menu items with their corresponding actions
  const viewMenuItems = [
    { id: 'commandPalette', label: 'Command Palette...' },
    { id: 'openView', label: 'Open View...' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'editorLayout', label: 'Editor Layout' },
    { id: 'explorer', label: 'Explorer' },
    { id: 'search', label: 'Search' },
    { id: 'sourceControl', label: 'Source Control' },
    { id: 'run', label: 'Run' },
    { id: 'extensions', label: 'Extensions' },
    { id: 'problems', label: 'Problems' },
    { id: 'output', label: 'Output' },
    { id: 'debugConsole', label: 'Debug Console' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'wordWrap', label: 'Word Wrap' },
  ]; // Array of View menu items

  // Function to get menu items for a specific menu
  const getMenuItemsForMenu = (menu: string) => {
    switch (menu) {
      case 'File':
        return fileMenuItems;
      case 'Edit':
        return editMenuItems;
      case 'Selection':
        return selectionMenuItems;
      case 'View':
        return viewMenuItems;
      case 'Go':
        return goMenuItems;
      case 'Run':
        return runMenuItems;
      case 'Terminal':
        return terminalMenuItems;
      case 'Help':
        return helpMenuItems;
      default:
        return [];
    }
  }; // Function to get menu items for a specific menu

  // Function to handle menu item click
  const handleMenuItemClick = (menuItem: any, menu: string) => {
    if (menuItem.onClick) {
      // For menu items with custom click handlers
      menuItem.onClick();
    } else if (menu === 'Help') {
      // Handle Help menu items
      if (menuItem.id === 'devTools') {
        // Toggle dev tools
        window.electron?.ipcRenderer?.invoke('toggle-dev-tools');
      } else {
        handleHelpItemClick(menuItem.id);
      }
    } else if (menu === 'File') {
      handleFileItemClick(menuItem.id);
    } else if (menu === 'Edit') {
      handleEditItemClick(menuItem.id);
    }
    // Close the menu after clicking an item
    setActiveMenu(null);
  };

  // Function to render a menu item
  const renderMenuItem = (menuItem: any, menu: string) => {
    if (menuItem.isDivider) {
      return <div key={menuItem.id} className="menu-divider" />;
    }
    if (menuItem.hasSubmenu && menuItem.id === 'openRecent') {
      return (
        <div key={menuItem.id} className="menu-item menu-item-has-submenu">
          <span>Open Recent</span>
          <div className="menu-submenu recent-projects-dropdown">
            {recentProjects.length === 0 ? (
              <div className="menu-item disabled">No recent projects</div>
            ) : (
              recentProjects.map((project, idx) => (
                <div
                  key={project}
                  className="menu-item"
                  onClick={() => handleFileItemClick('openRecent', { path: project })}
                >
                  {project}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }
    return (
      <div
        key={menuItem.id}
        className="menu-item"
        onClick={() => handleMenuItemClick(menuItem, menu)}
      >
        {menuItem.label}
        {typeof (menuItem as any).shortcut === 'string' && (
          <span className="menu-shortcut">{(menuItem as any).shortcut}</span>
        )}
      </div>
    );
  }; // Function to render a menu item

  // Effect to handle clicks outside the menu
  useEffect(() => {
    // Close dropdown when clicking outside or ESC
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []); // Effect to handle clicks outside the menu

  // Function to handle menu click
  const handleMenuClick = (item: string) => {
    if (activeMenu === item) {
      setActiveMenu(null);
    } else {
      setActiveMenu(item);
    }
  }; // Function to handle menu click

  // Function to handle Help menu item click
  const handleHelpItemClick = (actionId: string) => {
    setActiveMenu(null);
    if (onHelpAction) {
      onHelpAction(actionId);
    }
  }; // Function to handle Help menu item click

  // Function to handle File menu item click
  const handleFileItemClick = (actionId: string, data?: any) => {
    setActiveMenu(null);
    if (onFileAction) {
      onFileAction(actionId, data);
    }
  }; // Function to handle File menu item click

  // Function to handle Edit menu item click
  const handleEditItemClick = (actionId: string, data?: any) => {
    setActiveMenu(null);
    if (onEditAction) {
      onEditAction(actionId, data);
    }
  }; // Function to handle Edit menu item click

  // Function to handle toggle item
  const handleToggleItem = (actionId: string, currentState: boolean) => {
    if (onFileAction) {
      onFileAction(actionId, { isChecked: !currentState });
    }
  }; // Function to handle toggle item

  // Function to handle search key down events
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      // Focus the search input when Ctrl+Shift+F is pressed
      e.currentTarget.select();
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  // Render the menu bar
  return (
    <div className="menu-bar" ref={menuRef}>
      <div className="menu-bar-menus">
        {menuItems.map((item) => (
          <div
            key={item}
            className={`menu-item-container${activeMenu === item ? ' active' : ''}`}
            onClick={() => handleMenuClick(item)}
            tabIndex={0}
          >
            <span className="menu-item-label">{item}</span>
            {activeMenu === item && (
              <div className="menu-dropdown">
                {getMenuItemsForMenu(item).map((menuItem) => renderMenuItem(menuItem, item))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="menu-searchbar-wrapper">
        <input
          type="text"
          className="menu-searchbar"
          placeholder="Search (Ctrl+Shift+F)"
          onKeyDown={handleSearchKeyDown}
        />
        <SettingsIcon 
          className="settings-icon-container" 
          onClick={() => onHelpAction?.('settings')} 
        />
      </div>
    </div>
  );
};

export default MenuBar;