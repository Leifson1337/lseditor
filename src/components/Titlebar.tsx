import React, { useState, useEffect, ReactNode } from 'react';
import './Titlebar.css';

interface TitlebarProps {
  children: ReactNode;
}

const Titlebar: React.FC<TitlebarProps> = ({ children }) => {
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    // Initialen Fensterstatus abfragen
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

    // Event-Listener für Fensterstatusänderungen hinzufügen
    const handleMaximize = () => setIsMaximized(true);
    const handleUnmaximize = () => setIsMaximized(false);

    // Sichere Prüfung, ob die Methoden existieren
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('window:maximized', handleMaximize);
      window.electron.ipcRenderer.on('window:unmaximized', handleUnmaximize);
    }

    // Event-Listener beim Aufräumen entfernen
    return () => {
      if (window.electron?.ipcRenderer) {
        // Verwenden einer sicheren Methode zum Entfernen der Listener
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

  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-title">lseditor</div>
      {children}
      <div className="titlebar-buttons">
        <button className="titlebar-btn" title="Minimize" onClick={handleMinimize}>
          <span>&#x2013;</span>
        </button>
        {isMaximized ? (
          <button 
            className="titlebar-btn" 
            title="Restore" 
            onClick={handleMaximizeToggle}
          >
            <span>⧉</span>
          </button>
        ) : (
          <button 
            className="titlebar-btn" 
            title="Maximize" 
            onClick={handleMaximizeToggle}
          >
            <span>□</span>
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
