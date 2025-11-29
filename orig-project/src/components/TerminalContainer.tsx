import React, { useEffect, useState } from 'react';
import { Terminal } from './Terminal';
import StatusBar from './StatusBar';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { store } from '../store/store';
import { TerminalServer } from '../server/terminalServer';
import '../styles/Terminal.css';

// Props for the TerminalContainer component
interface TerminalContainerProps {
  activeFile?: string; // Path of the currently active file (optional)
  port: number;        // Port number for the terminal server
}

// TerminalContainer manages the lifecycle and connection of the terminal UI and backend
export const TerminalContainer: React.FC<TerminalContainerProps> = ({ activeFile, port }) => {
  console.log('TerminalContainer rendering with initial port:', port);
  const [isConnected, setIsConnected] = useState(false); // Terminal connection state
  const [currentPort, setCurrentPort] = useState(port);  // Track the current port
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null); // Terminal manager instance
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null); // Active terminal session ID

  useEffect(() => {
    // Initialize terminal-related services and managers on mount
    console.log('TerminalContainer mounted, initializing services');
    
    // Use services from the store
    const { projectService, uiService, aiService } = store;
    
    // Create a new terminal server instance
    const terminalServer = new TerminalServer(port);
    
    // Get the singleton terminal service
    const terminalService = TerminalService.getInstance(
      null,
      aiService,
      projectService,
      uiService,
      terminalServer,
      store
    );
    
    // Create a new terminal manager
    const manager = new TerminalManager(
      port,
      terminalService,
      aiService,
      projectService,
      uiService
    );
    
    setTerminalManager(manager);
    console.log('TerminalManager initialized');
    
    return () => {
      // Clean up and disconnect terminal manager on unmount
      console.log('TerminalContainer unmounting, cleaning up');
      if (manager) {
        manager.disconnect();
      }
    };
  }, [port]);

  useEffect(() => {
    // Connect to the terminal and create a session when the manager is ready
    if (terminalManager) {
      console.log('Connecting to terminal');
      terminalManager.connect();
      setIsConnected(true);
      
      // Create a new session when connecting
      terminalManager.createSession({
        title: 'Default Terminal',
        cwd: process.cwd()
      }).then(session => {
        setActiveSessionId(session.id);
      });
      
      return () => {
        // Disconnect terminal manager on cleanup
        console.log('Disconnecting from terminal');
        terminalManager.disconnect();
        setIsConnected(false);
      };
    }
  }, [terminalManager]);

  // Handle data sent from the terminal UI to the backend
  const handleTerminalData = (data: string) => {
    if (terminalManager && isConnected) {
      terminalManager.send(data);
    }
  };

  // Handle terminal resize events
  const handleTerminalResize = (cols: number, rows: number) => {
    if (terminalManager && isConnected && activeSessionId) {
      terminalManager.resizeSession(activeSessionId, cols, rows);
    }
  };

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <span>Terminal</span>
        <StatusBar />
      </div>
      <div className="terminal-content">
        {/* Render the Terminal component with handlers */}
        <Terminal 
          onData={handleTerminalData} 
          onResize={handleTerminalResize} 
        />
      </div>
    </div>
  );
}; 