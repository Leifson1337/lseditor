import React from 'react';
import '../styles/StatusBar.css';

interface StatusBarProps {
  activeFile?: string | null;
  terminalPort?: number;
  isTerminalConnected?: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  terminalPort,
  isTerminalConnected
}) => {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {activeFile && (
          <div className="status-item">
            <span className="status-label">File:</span>
            <span className="status-value">{activeFile}</span>
          </div>
        )}
      </div>
      <div className="status-bar-right">
        {terminalPort && (
          <div className="status-item">
            <span className="status-label">Terminal Port:</span>
            <span className="status-value">{terminalPort}</span>
          </div>
        )}
        <div className="status-item">
          <span className="status-label">Terminal:</span>
          <span className={`status-value ${isTerminalConnected ? 'connected' : 'disconnected'}`}>
            {isTerminalConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar; 