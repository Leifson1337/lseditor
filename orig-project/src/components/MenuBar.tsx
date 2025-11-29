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
        onClick={() => handleFileItemClick(menuItem.id)}
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
      <div className="menu-bar-center">
        <div className="menu-searchbar-wrapper">
          <input
            type="text"
            className="menu-searchbar"
            placeholder="Search..."
          />
        </div>
      </div>
      <div className="menu-bar-right">
        <SettingsIcon />
      </div>
    </div>
  );
};

export default MenuBar;