import React, { useState, useEffect, ReactNode } from 'react';
import { FaWindowRestore } from 'react-icons/fa';
import './Titlebar.css';

interface TitlebarProps {
  children?: ReactNode;
  minimal?: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({ children, minimal = false }) => {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    const checkMaximizedState = async () => {
      try {
        if (window.electron?.windowControls?.isMaximized) {
          const maximized = await window.electron.windowControls.isMaximized();
          setIsMaximized(!!maximized);
        }
      } catch (error) {
        console.error('Fehler beim Abfragen des Fensterstatus:', error);
      }
    };
    checkMaximizedState();
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
          console.error('Fehler beim Entfernen der Event-Listener:', error);
        }
      }
    };
  }, []);

  const handleMinimize = () => window.electron?.windowControls?.minimize();
  const handleMaximizeToggle = () => {
    if (isMaximized) {
      window.electron?.windowControls?.unmaximize();
    } else {
      window.electron?.windowControls?.maximize();
    }
  };
  const handleClose = () => window.electron?.windowControls?.close();

  if (minimal) {
    // Nur die drei Punkte oben rechts anzeigen
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
