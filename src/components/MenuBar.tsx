import React, { useState, useRef, useEffect } from 'react';
import {
  FiFileText,
  FiEdit2,
  FiTarget,
  FiEye,
  FiNavigation,
  FiPlay,
  FiTerminal,
  FiHelpCircle,
  FiPlusSquare,
  FiFolderPlus,
  FiSave,
  FiDownload,
  FiShare2,
  FiRefreshCw,
  FiXCircle,
  FiScissors,
  FiCopy,
  FiClipboard,
  FiSearch,
  FiType,
  FiCommand,
  FiCheck,
  FiChevronRight,
  FiClock
} from 'react-icons/fi';
import './MenuBar.css';
import SettingsIcon from './SettingsIcon';

interface MenuBarProps {
  onHelpAction?: (action: string) => void;
  onFileAction?: (action: string, data?: any) => void;
  onEditAction?: (action: string, data?: any) => void;
  onMenuAction?: (menu: string, action: string, data?: any) => void;
  recentProjects?: string[];
  updateAvailable?: boolean;
  isCheckingUpdates?: boolean;
}

interface MenuItemConfig {
  id: string;
  label?: string;
  shortcut?: string;
  isDivider?: boolean;
  isToggle?: boolean;
  isChecked?: boolean;
  disabled?: boolean;
  hasSubmenu?: boolean;
  description?: string;
}

const TOP_LEVEL_MENUS: Array<{ id: string; label: string; icon: React.ReactNode }> = [
  { id: 'File', label: 'File', icon: <FiFileText /> },
  { id: 'Edit', label: 'Edit', icon: <FiEdit2 /> },
  { id: 'Selection', label: 'Selection', icon: <FiTarget /> },
  { id: 'View', label: 'View', icon: <FiEye /> },
  { id: 'Go', label: 'Go', icon: <FiNavigation /> },
  { id: 'Run', label: 'Run', icon: <FiPlay /> },
  { id: 'Terminal', label: 'Terminal', icon: <FiTerminal /> },
  { id: 'Help', label: 'Help', icon: <FiHelpCircle /> }
];

const ACTION_ICONS: Record<string, React.ReactNode> = {
  newTextFile: <FiPlusSquare />,
  newFolder: <FiFolderPlus />,
  save: <FiSave />,
  saveAs: <FiDownload />,
  saveAll: <FiDownload />,
  share: <FiShare2 />,
  revertFile: <FiRefreshCw />,
  closeEditor: <FiXCircle />,
  closeFolder: <FiXCircle />,
  closeWindow: <FiXCircle />,
  exit: <FiXCircle />,
  undo: <FiRefreshCw />,
  redo: <FiRefreshCw />,
  cut: <FiScissors />,
  copy: <FiCopy />,
  paste: <FiClipboard />,
  find: <FiSearch />,
  replace: <FiSearch />,
  findInFiles: <FiSearch />,
  replaceInFiles: <FiSearch />,
  toggleLineComment: <FiType />,
  toggleBlockComment: <FiType />,
  newTerminal: <FiTerminal />,
  runTask: <FiPlay />,
  checkUpdates: <FiRefreshCw />,
  openRecent: <FiClock />
};

const fileMenuItems: MenuItemConfig[] = [
  { id: 'newTextFile', label: 'New Text File' },
  { id: 'newFolder', label: 'New Folder' },
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

const editMenuItems: MenuItemConfig[] = [
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

const selectionMenuItems: MenuItemConfig[] = [
  { id: 'selectAll', label: 'Select All', shortcut: 'Ctrl+A' },
  { id: 'expandSelection', label: 'Expand Selection', shortcut: 'Ctrl+Shift+Right' },
  { id: 'shrinkSelection', label: 'Shrink Selection', shortcut: 'Ctrl+Shift+Left' },
  { id: 'copyLineUp', label: 'Copy Line Up', shortcut: 'Shift+Alt+Up' },
  { id: 'copyLineDown', label: 'Copy Line Down', shortcut: 'Shift+Alt+Down' },
  { id: 'moveLineUp', label: 'Move Line Up', shortcut: 'Alt+Up' },
  { id: 'moveLineDown', label: 'Move Line Down', shortcut: 'Alt+Down' },
  { id: 'duplicateSelection', label: 'Duplicate Selection', shortcut: 'Ctrl+Shift+D' },
  { id: 'addCursorAbove', label: 'Add Cursor Above', shortcut: 'Ctrl+Alt+Up' },
  { id: 'addCursorBelow', label: 'Add Cursor Below', shortcut: 'Ctrl+Alt+Down' },
  { id: 'addCursorToLineEnds', label: 'Add Cursor to Line Ends', shortcut: 'Ctrl+Shift+L' },
  { id: 'addNextOccurrence', label: 'Add Next Occurrence', shortcut: 'Ctrl+D' },
  { id: 'addPreviousOccurrence', label: 'Add Previous Occurrence', shortcut: 'Ctrl+Shift+K' },
  { id: 'selectAllOccurrences', label: 'Select All Occurrences', shortcut: 'Ctrl+Shift+L' },
  { id: 'columnSelectionMode', label: 'Column Selection Mode', shortcut: 'Shift+Alt+Drag' }
];

const viewMenuItems: MenuItemConfig[] = [
  { id: 'commandPalette', label: 'Command Palette...', shortcut: 'Ctrl+Shift+P' },
  { id: 'search', label: 'Search', shortcut: 'Ctrl+Shift+F' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'run', label: 'Run' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'wordWrap', label: 'Toggle Word Wrap', isToggle: true, isChecked: true },
  { id: 'divider1', isDivider: true },
  { id: 'toggleFullScreen', label: 'Toggle Full Screen', shortcut: 'F11' },
  { id: 'reload', label: 'Reload', shortcut: 'Ctrl+R' }
];

const goMenuItems: MenuItemConfig[] = [
  { id: 'goBack', label: 'Back', shortcut: 'Alt+Left' },
  { id: 'goForward', label: 'Forward', shortcut: 'Alt+Right' },
  { id: 'goToLineColumn', label: 'Go to Line/Column...', shortcut: 'Ctrl+G' },
  { id: 'goToBracket', label: 'Go to Bracket', shortcut: 'Ctrl+Shift+\\' },
  { id: 'goToDefinition', label: 'Go to Definition', shortcut: 'F12' },
  { id: 'goToDeclaration', label: 'Go to Declaration', shortcut: 'Ctrl+F12' },
  { id: 'goToTypeDefinition', label: 'Go to Type Definition', shortcut: 'Ctrl+Shift+F12' },
  { id: 'goToImplementations', label: 'Go to Implementations', shortcut: 'Ctrl+Alt+F12' },
  { id: 'goToReferences', label: 'Go to References', shortcut: 'Shift+F12' },
  { id: 'goToSymbolInEditor', label: 'Go to Symbol in Editor...', shortcut: 'Ctrl+Shift+O' }
];

const runMenuItems: MenuItemConfig[] = [
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
  { id: 'installAdditionalDebuggers', label: 'Install Additional Debuggers...' }
];

const terminalMenuItems: MenuItemConfig[] = [
  { id: 'newTerminal', label: 'New Terminal' },
  { id: 'splitTerminal', label: 'Split Terminal' },
  { id: 'runTask', label: 'Run Task...' },
  { id: 'runBuildTask', label: 'Run Build Task...' },
  { id: 'runActiveFile', label: 'Run Active File' },
  { id: 'showRunningTasks', label: 'Show Running Tasks' },
  { id: 'configureTasks', label: 'Configure Tasks...' },
  { id: 'divider1', isDivider: true },
  { id: 'terminalSettings', label: 'Terminal Settings' }
];

const helpMenuItems: MenuItemConfig[] = [
  { id: 'documentation', label: 'Documentation' },
  { id: 'releaseNotes', label: 'Release Notes' },
  { id: 'keyboardShortcuts', label: 'Keyboard Shortcuts' },
  { id: 'tipsAndTricks', label: 'Tips and Tricks' },
  { id: 'divider1', isDivider: true },
  { id: 'checkUpdates', label: 'Check for Updates...' },
  { id: 'about', label: 'About' }
];

const MENU_MAP: Record<string, MenuItemConfig[]> = {
  File: fileMenuItems,
  Edit: editMenuItems,
  Selection: selectionMenuItems,
  View: viewMenuItems,
  Go: goMenuItems,
  Run: runMenuItems,
  Terminal: terminalMenuItems,
  Help: helpMenuItems
};

const MenuBar: React.FC<MenuBarProps> = ({
  onHelpAction,
  onFileAction,
  onEditAction,
  onMenuAction,
  recentProjects = [],
  updateAvailable = false,
  isCheckingUpdates = false
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, []);

  const triggerAction = (menuName: string, actionId: string, data?: any) => {
    if (menuName === 'File') {
      switch (actionId) {
        case 'newWindow':
          window.electron?.ipcRenderer.invoke('app:newWindow');
          break;
        case 'openFile':
          window.electron?.ipcRenderer.invoke('app:openFile');
          break;
        case 'openFolder':
          window.electron?.ipcRenderer.invoke('app:openFolder');
          break;
        case 'exit':
          window.electron?.ipcRenderer.invoke('app:exit');
          break;
        default:
          onFileAction?.(actionId, data);
          break;
      }
    } else if (menuName === 'Help') {
      onHelpAction?.(actionId);
    } else if (menuName === 'Edit') {
      switch (actionId) {
        case 'undo':
          window.electron?.ipcRenderer.invoke('edit:undo');
          break;
        case 'redo':
          window.electron?.ipcRenderer.invoke('edit:redo');
          break;
        case 'cut':
          window.electron?.ipcRenderer.invoke('edit:cut');
          break;
        case 'copy':
          window.electron?.ipcRenderer.invoke('edit:copy');
          break;
        case 'paste':
          window.electron?.ipcRenderer.invoke('edit:paste');
          break;
        case 'find':
          window.electron?.ipcRenderer.invoke('edit:find');
          break;
        case 'replace':
          window.electron?.ipcRenderer.invoke('edit:replace');
          break;
        default:
          onEditAction?.(actionId, data);
          break;
      }
    } else if (menuName === 'View') {
      switch (actionId) {
        case 'toggleFullScreen':
          window.electron?.ipcRenderer.invoke('view:toggleFullScreen');
          break;
        case 'reload':
          window.electron?.ipcRenderer.invoke('view:reload');
          break;
        default:
          onMenuAction?.(menuName, actionId, data);
          break;
      }
    } else {
      onMenuAction?.(menuName, actionId, data);
    }
  };

  const handleToggleItem = (actionId: string, currentState: boolean) => {
    onFileAction?.(actionId, { isChecked: !currentState });
  };

  const renderRecentProjects = () => {
    if (!recentProjects.length) {
      return <div className="menu-item-row disabled">No recent projects</div>;
    }
    return recentProjects.map((project) => (
      <button
        type="button"
        key={project}
        className="menu-item-row"
        onClick={() => {
          triggerAction('File', 'openRecent', { path: project });
          setActiveMenu(null);
        }}
      >
        <span className="recent-project-name">{project}</span>
      </button>
    ));
  };

  const renderMenuItem = (menuItem: MenuItemConfig, menu: string) => {
    if (menuItem.isDivider) {
      return <div key={menuItem.id} className="menu-divider" />;
    }

    if (menuItem.hasSubmenu && menuItem.id === 'openRecent') {
      return (
        <div key={menuItem.id} className="menu-item-row submenu-container">
          <div className="menu-item-left">
            <span className="menu-item-icon">{ACTION_ICONS.openRecent}</span>
            <span className="menu-item-text">
              <span>{menuItem.label}</span>
              <small>Recently opened folders</small>
            </span>
          </div>
          <FiChevronRight className="submenu-arrow" />
          <div className="menu-submenu recent-projects-dropdown">{renderRecentProjects()}</div>
        </div>
      );
    }

    const isToggle = menuItem.isToggle;
    const isCheckUpdatesItem = menu === 'Help' && menuItem.id === 'checkUpdates';
    const isDisabled = (isCheckUpdatesItem && isCheckingUpdates) || !!menuItem.disabled;
    const label = isCheckUpdatesItem && isCheckingUpdates ? 'Checking for Updates...' : menuItem.label;
    const shortcut = menuItem.shortcut;
    const icon = ACTION_ICONS[menuItem.id];

    const handleClick = () => {
      if (isDisabled) {
        return;
      }
      if (isToggle) {
        handleToggleItem(menuItem.id, !!menuItem.isChecked);
        return;
      }
      triggerAction(menu, menuItem.id);
      setActiveMenu(null);
    };

    return (
      <button
        key={menuItem.id}
        type="button"
        className={`menu-item-row${isDisabled ? ' disabled' : ''}${isToggle && menuItem.isChecked ? ' checked' : ''}`}
        onClick={handleClick}
        disabled={isDisabled}
      >
        <div className="menu-item-left">
          {isToggle ? (
            <span className={`menu-toggle${menuItem.isChecked ? ' checked' : ''}`}>
              {menuItem.isChecked ? <FiCheck /> : null}
            </span>
          ) : (
            icon && <span className="menu-item-icon">{icon}</span>
          )}
          <span className="menu-item-text">{label}</span>
        </div>
        <div className="menu-item-right">
          {shortcut && <span className="menu-shortcut">{shortcut}</span>}
          {isCheckUpdatesItem && updateAvailable && !isCheckingUpdates && (
            <span className="menu-item-chip">Neu</span>
          )}
        </div>
      </button>
    );
  };

  const handleMenuClick = (id: string) => {
    setActiveMenu((current) => (current === id ? null : id));
  };

  return (
    <div className="menu-bar" ref={menuRef}>
      <div className="menu-bar-menus">
        {TOP_LEVEL_MENUS.map((menu) => {
          const isActive = activeMenu === menu.id;
          const showUpdateIndicator = menu.id === 'Help' && updateAvailable;
          return (
            <div
              key={menu.id}
              className={`menu-tab${isActive ? ' active' : ''}`}
              onClick={() => handleMenuClick(menu.id)}
              tabIndex={0}
            >
              <span className="menu-tab-label">
                <span className="menu-tab-icon">{menu.icon}</span>
                {menu.label}
                {showUpdateIndicator && <span className="menu-item-indicator" title="Update verfügbar">●</span>}
              </span>
              {isActive && (
                <div className="menu-dropdown">
                  {MENU_MAP[menu.id]?.map((entry) => renderMenuItem(entry, menu.id))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="menu-bar-center">
        <div className="menu-searchbar-wrapper">
          <FiSearch className="menu-search-icon" />
          <input type="text" className="menu-searchbar" placeholder="Search commands or files..." />
        </div>
      </div>
      <div className="menu-bar-right">
        <SettingsIcon />
      </div>
    </div>
  );
};

export default MenuBar;
