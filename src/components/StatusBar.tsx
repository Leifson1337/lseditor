import React from 'react';
import './StatusBar.css';

interface StatusBarProps {
  activeFile?: string;
  terminalPort: number;
  isTerminalConnected: boolean;
  language?: string;
  branch?: string;
  aiStatus?: 'connected' | 'waiting' | 'disconnected';
  linterStatus?: 'ok' | 'warning' | 'error';
}

const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  terminalPort,
  isTerminalConnected,
  language = 'Plain Text',
  branch = 'main',
  aiStatus = 'disconnected',
  linterStatus = 'ok'
}) => {
  const getAIStatusIcon = () => {
    switch (aiStatus) {
      case 'connected':
        return '🧠';
      case 'waiting':
        return '⌛';
      case 'disconnected':
        return '❌';
    }
  };

  const getLinterStatusIcon = () => {
    switch (linterStatus) {
      case 'ok':
        return '✓';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
    }
  };

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-icon">🌿</span>
        <span className="status-text">{branch}</span>
      </div>
      <div className="status-item">
        <span className="status-icon">📝</span>
        <span className="status-text">{language}</span>
      </div>
      <div className="status-item">
        <span className="status-icon">{getLinterStatusIcon()}</span>
        <span className="status-text">Linter</span>
      </div>
      <div className="status-item">
        <span className="status-icon">{getAIStatusIcon()}</span>
        <span className="status-text">AI</span>
      </div>
      <div className="status-item">
        {activeFile ? `File: ${activeFile}` : 'No file selected'}
      </div>
      <div className="status-item">
        <span>Terminal: {isTerminalConnected ? 'Connected' : 'Disconnected'}</span>
        <span className="port">(Port: {terminalPort})</span>
      </div>
    </div>
  );
};

export default StatusBar; 