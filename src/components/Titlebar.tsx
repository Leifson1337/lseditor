import React from 'react';
import './Titlebar.css';

const Titlebar: React.FC = () => {
  const handleMinimize = () => window.electron?.windowControls.minimize();
  const handleMaximize = () => window.electron?.windowControls.maximize();
  const handleUnmaximize = () => window.electron?.windowControls.unmaximize();
  const handleClose = () => window.electron?.windowControls.close();

  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-title">lseditor</div>
      <div className="titlebar-buttons">
        <button className="titlebar-btn" title="Minimize" onClick={handleMinimize}>
          <span>&#x2013;</span>
        </button>
        <button className="titlebar-btn" title="Maximize" onClick={handleMaximize}>
          <span>&#x25A1;</span>
        </button>
        <button className="titlebar-btn close" title="Close" onClick={handleClose}>
          <span>&#x2715;</span>
        </button>
      </div>
    </div>
  );
};

export default Titlebar;
