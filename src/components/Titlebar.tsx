import React, { useState, useEffect, ReactNode } from 'react';
import { FaWindowRestore } from 'react-icons/fa';
import './Titlebar.css';

// Get the base URL for static assets
const getAssetUrl = (path: string) => {
  // In development, assets are served from the public folder
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.origin}/${path}`;
  }
  // In production, use the relative path
  return `./${path}`;
};

const logoUrl = getAssetUrl('logo.png');

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
  const handleMinimize = () => window.electron?.ipcRenderer?.invoke('window:minimize');
  // Handle maximize/restore button click
  const handleMaximizeToggle = () => {
    if (isMaximized) {
      window.electron?.ipcRenderer?.invoke('window:unmaximize');
    } else {
      window.electron?.ipcRenderer?.invoke('window:maximize');
    }
  };
  // Handle close button click
  const handleClose = () => window.electron?.ipcRenderer?.invoke('window:close');

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

  // Default mode: show logo, title, children, and window controls
  return (
    <div className="titlebar" style={{position: 'relative'}}>
      <div className="titlebar-drag" />
      <div className="menu-bar">
        <div className="titlebar-logo no-drag">
          <img 
            src={logoUrl} 
            alt="LSEditor Logo" 
            onError={(e) => {
              // If logo fails to load, show text fallback
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              const textFallback = document.createElement('div');
              textFallback.className = 'titlebar-logo-text';
              textFallback.textContent = 'LSEditor';
              target.parentNode?.insertBefore(textFallback, target.nextSibling);
            }}
          />
          <div className="titlebar-title">
            {children || 'LSEditor'}
          </div>
        </div>
      </div>
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
