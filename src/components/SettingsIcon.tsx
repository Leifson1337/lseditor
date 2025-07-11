import React, { useState, useEffect } from 'react';
import './SettingsIcon.css';
import { useTheme } from '../contexts/ThemeContext';
import { store } from '../store/store';

// Props for the SettingsIcon component
interface SettingsIconProps {
  onClick?: () => void; // Optional callback for when the icon is clicked
}

// SettingsIcon renders a gear icon that opens a dropdown for settings
const SettingsIcon: React.FC<SettingsIconProps> = ({ onClick }) => {
  const [isOpen, setIsOpen] = useState(false); // State for dropdown visibility
  const { theme, toggleTheme } = useTheme();   // Theme context for toggling theme
  const [aiSettings, setAISettings] = useState({
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2048,
  });

  // Load settings from store on mount
  useEffect(() => {
    const settings = store.get('ai');
    if (settings) {
      setAISettings(prev => ({
        ...prev,
        ...settings
      }));
    }
  }, []);

  // Update AI settings in both local state and store
  const updateAISettings = (updates: Partial<typeof aiSettings>) => {
    const newSettings = { ...aiSettings, ...updates };
    setAISettings(newSettings);
    
    // Update the store with the new settings
    store.set('ai', {
      ...store.get('ai'),
      ...updates
    });
  };

  // Handle click on the settings icon
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) onClick();
    setIsOpen(!isOpen);
  };

  // Toggle the settings dropdown open/closed
  const toggleSettings = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="settings-container">
      <button 
        className="settings-button"
        onClick={handleClick}
        title="Settings"
      >
        {/* Gear icon (SVG) */}
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
      {/* Settings dropdown menu */}
      {isOpen && (
        <div className="settings-dropdown">
          <div className="settings-header">
            <h3>Settings</h3>
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
                <label>Font Size</label>
                <input type="range" min="10" max="20" defaultValue="14" />
              </div>
            </div>
            <div className="settings-section">
              <h4>AI</h4>
              <div className="setting-item">
                <label>Model</label>
                <select 
                  value={aiSettings.model}
                  onChange={(e) => updateAISettings({ model: e.target.value })}
                >
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