import React from 'react';
import '../styles/StatusBar.css';

// Props for the StatusBar component
interface StatusBarProps {
  activeFile?: string | null; // Path of the currently active file
  terminalPort?: number; // Port number of the terminal connection
  isTerminalConnected?: boolean; // Terminal connection status
  errorCount?: number; // Number of errors in the current file/project
  problemCount?: number; // Number of problems/warnings
  portForwardCount?: number; // Number of active port forwards
}

// StatusBar displays file info, error/warning counts, port status, and terminal connection status
const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  terminalPort,
  isTerminalConnected,
  errorCount = 0,
  problemCount = 0,
  portForwardCount = 0
}) => {
  // Determine programming language from file extension
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
        {/* Errors, Warnings und Port Forwards GANZ LINKS */}
        <div className="status-item error-count">
          <span className={`status-value ${errorCount > 0 ? 'error' : ''}`}>Errors: {errorCount}</span>
        </div>
        <div className="status-item warning-count">
          <span className={`status-value ${problemCount > 0 ? 'warning' : ''}`}>Warnings: {problemCount}</span>
        </div>
        <div className="status-item port-count">
          <span className={`status-value ${portForwardCount > 0 ? 'info' : ''}`}>Port Forwards: {portForwardCount}</span>
        </div>
        {/* Show active file and detected language */}
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
      <div className="status-bar-center"></div>
      <div className="status-bar-right">
        {/* Show terminal port and connection status */}
        {terminalPort && (
          <div className="status-item">
            <span className="status-label">Terminal Port:</span>
            <span className="status-value">{terminalPort}</span>
          </div>
        )}
        <div className="status-item">
          <span className="status-label">Terminal:</span>
          <span className={`status-value ${isTerminalConnected ? 'connected' : 'disconnected'}`}>{isTerminalConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;