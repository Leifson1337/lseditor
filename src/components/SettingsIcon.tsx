import React, { useState } from 'react';
import './SettingsIcon.css';
import { useTheme } from '../contexts/ThemeContext';

interface SettingsIconProps {
  onClick?: () => void;
}

const SettingsIcon: React.FC<SettingsIconProps> = ({ onClick }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) onClick();
    setIsOpen(!isOpen);
  };

  const toggleSettings = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="settings-container">
      <button 
        className="settings-button"
        onClick={handleClick}
        title="Einstellungen"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09c0 .66.38 1.26 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09c0 .66.38 1.26 1 1.51a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.26.38-1.51 1z" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="settings-dropdown">
          <div className="settings-header">
            <h3>Einstellungen</h3>
            <button className="close-button" onClick={toggleSettings}>×</button>
          </div>
          <div className="settings-content">
            <div className="settings-section">
              <h4>Editor</h4>
              <div className="setting-item">
                <label>Theme</label>
                <select value={theme} onChange={toggleTheme}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="setting-item">
                <label>Schriftgröße</label>
                <input type="range" min="10" max="20" defaultValue="14" />
              </div>
            </div>
            <div className="settings-section">
              <h4>AI</h4>
              <div className="setting-item">
                <label>Modell</label>
                <select defaultValue="gpt-4">
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsIcon;