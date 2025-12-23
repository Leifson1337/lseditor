import React, { useEffect, useState } from 'react';
import './SettingsIcon.css';
import { useTheme } from '../contexts/ThemeContext';
import { useAI } from '../contexts/AIContext';

// Props for the SettingsIcon component
interface SettingsIconProps {
  onClick?: () => void; // Optional callback for when the icon is clicked
}

// SettingsIcon renders a gear icon that opens a dropdown for settings
const SettingsIcon: React.FC<SettingsIconProps> = ({ onClick }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const {
    settings: aiSettings,
    updateSettings: updateAISettings,
    models,
    refreshModels,
    isFetchingModels,
    connectionStatus
  } = useAI();
  const [baseUrlInput, setBaseUrlInput] = useState(aiSettings.baseUrl);

  useEffect(() => {
    setBaseUrlInput(aiSettings.baseUrl);
  }, [aiSettings.baseUrl]);

  // Handle click on the settings icon
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) onClick();
    setIsOpen(!isOpen);
  };

  // Toggle the settings dropdown open/closed
  const toggleSettings = () => {
    setIsOpen(!isOpen);
  };

  const commitBaseUrl = () => {
    if (!baseUrlInput.trim()) {
      return;
    }
    updateAISettings({ baseUrl: baseUrlInput });
    refreshModels();
  };

  const renderConnectionStatus = () => {
    switch (connectionStatus) {
      case 'ready':
        return 'Connected to LM Studio';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'No Connection';
      default:
        return 'Ready';
    }
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
              <h4>AI (LM Studio)</h4>
              <div className="setting-item">
                <label>API URL</label>
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={event => setBaseUrlInput(event.target.value)}
                  onBlur={commitBaseUrl}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitBaseUrl();
                    }
                  }}
                />
              </div>
              <div className="setting-item">
                <label>Model</label>
                <div className="setting-inline">
                  <select
                    value={aiSettings.model}
                    onChange={event => updateAISettings({ model: event.target.value })}
                    disabled={!models.length}
                  >
                    {models.length === 0 && <option value="">No models found</option>}
                    {models.map(model => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={refreshModels} disabled={isFetchingModels}>
                    {isFetchingModels ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <small className="settings-hint">{renderConnectionStatus()}</small>
              </div>
              <div className="setting-item">
                <label>Max Tokens per Request</label>
                <input
                  type="number"
                  min={256}
                  max={8192}
                  step={128}
                  value={aiSettings.maxTokens}
                  onChange={event =>
                    updateAISettings({ maxTokens: Math.max(256, Number(event.target.value) || 256) })
                  }
                />
                <small className="settings-hint">
                  Automatically sends a second request if the token limit is reached for long responses.
                </small>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsIcon;
