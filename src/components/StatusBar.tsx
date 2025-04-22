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
  // Programmiersprache aus Dateiendung bestimmen
  let language = '';
  if (activeFile) {
    const ext = activeFile.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': language = 'JavaScript'; break;
      case 'jsx': language = 'JavaScript (React)'; break;
      case 'ts': language = 'TypeScript'; break;
      case 'tsx': language = 'TypeScript (React)'; break;
      case 'py': language = 'Python'; break;
      case 'java': language = 'Java'; break;
      case 'c': language = 'C'; break;
      case 'cpp': case 'cc': case 'cxx': language = 'C++'; break;
      case 'cs': language = 'C#'; break;
      case 'go': language = 'Go'; break;
      case 'rb': language = 'Ruby'; break;
      case 'php': language = 'PHP'; break;
      case 'html': language = 'HTML'; break;
      case 'css': language = 'CSS'; break;
      case 'json': language = 'JSON'; break;
      case 'xml': language = 'XML'; break;
      case 'md': language = 'Markdown'; break;
      case 'sh': language = 'Shell'; break;
      case 'rs': language = 'Rust'; break;
      case 'swift': language = 'Swift'; break;
      case 'kt': language = 'Kotlin'; break;
      case 'dart': language = 'Dart'; break;
      case 'scala': language = 'Scala'; break;
      case 'sql': language = 'SQL'; break;
      default: language = ext ? ext.toUpperCase() : '';
    }
  }

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {activeFile && (
          <div className="status-item">
            <span className="status-label">File:</span>
            <span className="status-value">{activeFile}</span>
            {language && (
              <span className="status-language">[{language}]</span>
            )}
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