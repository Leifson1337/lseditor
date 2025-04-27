import React, { useState, useEffect, ReactNode } from 'react';
import { FaWindowRestore } from 'react-icons/fa';
import './Titlebar.css';

// Props for the Titlebar component
interface TitlebarProps {
  children?: ReactNode; // Optional children to render in the titlebar
  minimal?: boolean;   // If true, show only window controls (no title)
}

// Titlebar renders the draggable app title bar and window control buttons
const Titlebar: React.FC<TitlebarProps> = ({ children, minimal = false }) => {
  // State for whether the window is maximized
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    // Check initial maximized state on mount
    const checkMaximizedState = async () => {
      try {
        if (window.electron?.windowControls?.isMaximized) {
          const maximized = await window.electron.windowControls.isMaximized();
          setIsMaximized(!!maximized);
        }
      } catch (error) {
        console.error('Error querying window maximized state:', error);
      }
    };
    checkMaximizedState();
    // Listen for maximize/unmaximize events from main process
    const handleMaximize = () => setIsMaximized(true);
    const handleUnmaximize = () => setIsMaximized(false);
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('window:maximized', handleMaximize);
      window.electron.ipcRenderer.on('window:unmaximized', handleUnmaximize);
    }
    return () => {
      if (window.electron?.ipcRenderer) {
        try {
          window.electron.ipcRenderer.removeListener('window:maximized', handleMaximize);
          window.electron.ipcRenderer.removeListener('window:unmaximized', handleUnmaximize);
        } catch (error) {
          console.error('Error removing window event listeners:', error);
        }
      }
    };
  }, []);

  // Handle minimize button click
  const handleMinimize = () => window.electron?.windowControls?.minimize();
  // Handle maximize/restore button click
  const handleMaximizeToggle = () => {
    if (isMaximized) {
      window.electron?.windowControls?.unmaximize();
    } else {
      window.electron?.windowControls?.maximize();
    }
  };
  // Handle close button click
  const handleClose = () => window.electron?.windowControls?.close();

  if (minimal) {
    // Minimal mode: show only window controls, no title
    return (
      <div className="titlebar minimal" style={{position: 'relative', justifyContent: 'flex-end'}}>
        <div className="titlebar-drag" />
        <div className="titlebar-buttons no-drag">
          <button className="titlebar-btn" title="Minimize" onClick={handleMinimize}>
            <span>&#x2013;</span>
          </button>
          {isMaximized ? (
            <button className="titlebar-btn" title="Restore" onClick={handleMaximizeToggle}>
              <FaWindowRestore />
            </button>
          ) : (
            <button className="titlebar-btn" title="Maximize" onClick={handleMaximizeToggle}>
              <span>&#x25A1;</span>
            </button>
          )}
          <button className="titlebar-btn close" title="Close" onClick={handleClose}>
            <span>&#x2715;</span>
          </button>
        </div>
      </div>
    );
  }

  // Default mode: show title, children, and window controls
  return (
    <div className="titlebar" style={{position: 'relative'}}>
      <div className="titlebar-drag" />
      <div className="titlebar-title no-drag">lseditor</div>
      {children}
      <div className="titlebar-buttons no-drag">
        <button className="titlebar-btn" title="Minimize" onClick={handleMinimize}>
          <span>&#x2013;</span>
        </button>
        {isMaximized ? (
          <button className="titlebar-btn" title="Restore" onClick={handleMaximizeToggle}>
            <FaWindowRestore />
          </button>
        ) : (
          <button className="titlebar-btn" title="Maximize" onClick={handleMaximizeToggle}>
            <span>&#x25A1;</span>
          </button>
        )}
        <button className="titlebar-btn close" title="Close" onClick={handleClose}>
          <span>&#x2715;</span>
        </button>
      </div>
    </div>
  );
};

export default Titlebar;
