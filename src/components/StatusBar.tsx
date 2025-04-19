import React from 'react';
import '../styles/StatusBar.css';

interface StatusBarProps {
  activeFile?: string | null;
  terminalPort?: number;
  isTerminalConnected?: boolean;
  errorCount?: number;
  problemCount?: number;
  portForwardCount?: number;
}

const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  terminalPort,
  isTerminalConnected,
  errorCount = 0,
  problemCount = 0,
  portForwardCount = 0
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
      <div className="status-bar-center">
        <div className="status-item error-count">
          <span className={`status-value ${errorCount > 0 ? 'error' : ''}`}>
            Fehler: {errorCount}
          </span>
        </div>
        <div className="status-item warning-count">
          <span className={`status-value ${problemCount > 0 ? 'warning' : ''}`}>
            Probleme: {problemCount}
          </span>
        </div>
        <div className="status-item port-count">
          <span className={`status-value ${portForwardCount > 0 ? 'info' : ''}`}>
            Port-Forwards: {portForwardCount}
          </span>
        </div>
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