import React, { useEffect, useState } from 'react';
import { Terminal } from './Terminal';
import StatusBar from './StatusBar';
import { TerminalManager } from '../services/TerminalManager';
import { TerminalService } from '../services/TerminalService';
import { store } from '../store/store';
import { TerminalServer } from '../server/terminalServer';
import '../styles/Terminal.css';

interface TerminalContainerProps {
  activeFile?: string;
  port: number;
}

export const TerminalContainer: React.FC<TerminalContainerProps> = ({ activeFile, port }) => {
  console.log('TerminalContainer rendering with initial port:', port);
  const [isConnected, setIsConnected] = useState(false);
  const [currentPort, setCurrentPort] = useState(port);
  const [terminalManager, setTerminalManager] = useState<TerminalManager | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    console.log('TerminalContainer mounted, initializing services');
    
    // Use services from the store
    const { projectService, uiService, aiService } = store;
    
    // Create terminal server
    const terminalServer = new TerminalServer(port);
    
    // Get terminal service instance
    const terminalService = TerminalService.getInstance(
      null,
      aiService,
      projectService,
      uiService,
      terminalServer,
      store
    );
    
    // Create terminal manager
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
      console.log('TerminalContainer unmounting, cleaning up');
      if (manager) {
        manager.disconnect();
      }
    };
  }, [port]);

  useEffect(() => {
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
        console.log('Disconnecting from terminal');
        terminalManager.disconnect();
        setIsConnected(false);
      };
    }
  }, [terminalManager]);

  const handleTerminalData = (data: string) => {
    if (terminalManager && isConnected) {
      terminalManager.send(data);
    }
  };

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
        <Terminal 
          onData={handleTerminalData} 
          onResize={handleTerminalResize} 
        />
      </div>
    </div>
  );
}; 