import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from './Terminal';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { TerminalService } from '../services/TerminalService';
import { TerminalManager } from '../services/TerminalManager';
import { AIService } from '../services/AIService';
import { ProjectService } from '../services/ProjectService';
import { UIService } from '../services/UIService';
import { TerminalServer } from '../server/terminalServer';
import { Store } from '../store';
import { TerminalSession } from '../types/terminal';
import { AIConfig } from '../types/AITypes';
import './TerminalPanel.css';

// Props for the TerminalPanel component
interface TerminalPanelProps {
  onClose: () => void; // Callback to close the terminal panel
  isVisible: boolean;   // Controls the visibility of the panel
}

// TerminalPanel manages terminal sessions and renders the terminal UI
export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose, isVisible }) => {
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the terminal container
  const terminalServiceRef = useRef<TerminalService | null>(null); // Ref for the terminal service instance
  const [sessions, setSessions] = useState<string[]>([]); // List of session IDs
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null); // ID of the active session

  // Initialize terminal services and UI
  const initializeTerminal = useCallback(async () => {
    console.log('Initializing terminal...');
    if (!containerRef.current) {
      console.error('Terminal container ref is not available');
      return;
    }
    
    try {
      // Set up backend services and dependencies
      const terminalServer = new TerminalServer(3001);
      const store = new Store();
      const uiService = new UIService();
      const projectService = new ProjectService(process.cwd());
      const aiService = AIService.getInstance({
        useLocalModel: false,
        model: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 2048,
        contextWindow: 4096,
        stopSequences: ['\n\n', '```'],
        topP: 1,
        openAIConfig: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'gpt-3.5-turbo',
          temperature: 0.7,
          maxTokens: 2048
        }
      });

      console.log('Creating terminal service and manager...');
      // Create the terminal service and manager
      let terminalService: TerminalService;
      let terminalManager: TerminalManager;

      try {
        terminalService = TerminalService.getInstance(
          null,
          aiService,
          projectService,
          uiService,
          terminalServer,
          store
        );
        console.log('Terminal service created');

        terminalManager = new TerminalManager(
          3001,
          terminalService,
          aiService,
          projectService,
          uiService
        );
        console.log('Terminal manager created');
      } catch (error) {
        console.error('Failed to create terminal service/manager:', error);
        throw error;
      }

      // Initialize services
      try {
        console.log('Initializing terminal service...');
        await terminalService.initialize();
        console.log('Terminal service initialized');
        
        // @ts-ignore - Accessing private property for now
        terminalService.terminalManager = terminalManager;
        terminalServiceRef.current = terminalService;
        console.log('Terminal manager set on service');
      } catch (error) {
        console.error('Failed to initialize terminal service:', error);
        throw error;
      }

      // Create initial terminal session
      const session = await terminalManager.createSession({
        title: 'Terminal',
        cwd: process.cwd(),
        profile: 'default',
        theme: 'default'
      });

      setActiveSessionId(session.id);
      setSessions([session.id]);

      // Set up event listeners
      const onSessionCreated = (newSession: TerminalSession) => {
        setSessions(prev => [...prev, newSession.id]);
      };

      const onSessionRemoved = (sessionId: string) => {
        setSessions(prev => {
          const newSessions = prev.filter(id => id !== sessionId);
          if (activeSessionId === sessionId) {
            setActiveSessionId(newSessions[0] || null);
          }
          return newSessions;
        });
      };

      terminalManager.on('sessionCreated', onSessionCreated);
      terminalManager.on('sessionRemoved', onSessionRemoved);
      terminalManager.on('error', (error: Error) => {
        console.error('Terminal error:', error);
      });

      // Cleanup function
      return () => {
        terminalManager.removeListener('sessionCreated', onSessionCreated);
        terminalManager.removeListener('sessionRemoved', onSessionRemoved);
        if (terminalServiceRef.current) {
          terminalServiceRef.current.dispose();
        }
      };
    } catch (error) {
      console.error('Failed to initialize terminal:', error);
    }
  }, [activeSessionId]);

  // Initialize terminal when component mounts and when visibility changes
  useEffect(() => {
    if (!isVisible) return;
    
    let cleanup: (() => void) | undefined;
    
    const init = async () => {
      cleanup = await initializeTerminal();
    };
    
    init();
    
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [isVisible, initializeTerminal]);

  // Handle terminal data input
  const handleTerminalData = useCallback((data: string) => {
    if (terminalServiceRef.current && activeSessionId) {
      terminalServiceRef.current.writeToSession(activeSessionId, data);
    }
  }, [activeSessionId]);

  // Handle terminal resize
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    try {
      if (!terminalServiceRef.current) {
        console.warn('Terminal service not available');
        return;
      }
      
      if (!activeSessionId) {
        console.warn('No active terminal session');
        return;
      }

      // @ts-ignore - Accessing private property
      const terminalManager = terminalServiceRef.current.terminalManager;
      if (!terminalManager) {
        console.warn('Terminal manager not available');
        return;
      }

      console.log(`Resizing terminal to ${cols}x${rows}`);
      terminalManager.resizeSession(activeSessionId, cols, rows).catch(error => {
        console.error('Failed to resize terminal:', error);
      });
    } catch (error) {
      console.error('Error in handleTerminalResize:', error);
    }
  }, [activeSessionId]);

  if (!isVisible) return null;

  // Prevent click events from bubbling up
  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div 
      className="terminal-panel" 
      onClick={handlePanelClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'transparent',
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.2s ease-in-out',
        position: 'relative',
        zIndex: 1,
      }}>
      {/* Terminal panel header with close button */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '6px 12px', 
          backgroundColor: '#252526', 
          borderBottom: '1px solid #333',
          height: '32px',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 2,
        }}
        onClick={handlePanelClick}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          fontSize: '12px',
          fontWeight: 500,
          color: '#cccccc'
        }}>
          <span>Terminal</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button 
            onClick={onClose} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: '#cccccc', 
              fontSize: '16px', 
              cursor: 'pointer', 
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              transition: 'background-color 0.2s, color 0.2s'
            }} 
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#333', e.currentTarget.style.color = '#ffffff')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent', e.currentTarget.style.color = '#cccccc')}
            title="Close Terminal"
          >
            ×
          </button>
        </div>
      </div>
      {/* Container for the terminal UI */}
      <div 
        ref={containerRef} 
        className="terminal-container" 
        style={{ 
          flex: 1, 
          overflow: 'hidden',
          backgroundColor: '#1e1e1e',
          padding: '8px',
          boxSizing: 'border-box'
        }}
      >
        <Terminal 
          onData={handleTerminalData}
          onResize={handleTerminalResize}
        />
      </div>
    </div>
  );
};