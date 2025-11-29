import React, { useEffect, useRef, useState } from 'react';
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
}

// TerminalPanel manages terminal sessions and renders the terminal UI
export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the terminal container
  const terminalServiceRef = useRef<TerminalService | null>(null); // Ref for the terminal service instance
  const [sessions, setSessions] = useState<string[]>([]); // List of session IDs
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null); // ID of the active session

  useEffect(() => {
    let mounted = true;

    // Initialize terminal services and UI
    const initializeTerminal = async () => {
      try {
        if (!containerRef.current) return;

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

        // Create the terminal service and manager
        const terminalService = new TerminalService(
          null,
          aiService,
          projectService,
          uiService,
          terminalServer,
          store
        );

        // Create and set the terminal manager
        const [terminalManager] = useState(() => new TerminalManager(
          3001,
          terminalService,
          aiService,
          projectService,
          uiService
        ));

        terminalService.setTerminalManager(terminalManager);

        await terminalService.initialize();
        terminalServiceRef.current = terminalService;

        // Append the terminal element to the container
        const element = terminalService.getElement();
        containerRef.current.appendChild(element);

        if (!mounted) return;

        // Create initial terminal session
        const session = await terminalManager.createSession({});
        setActiveSessionId(session.id);

        // Listen for session creation/removal events
        terminalManager.on('sessionCreated', (session: TerminalSession) => {
          if (mounted) {
            setSessions(prev => [...prev, session.id]);
          }
        });

        terminalManager.on('sessionRemoved', (sessionId: string) => {
          if (mounted) {
            setSessions(prev => prev.filter(s => s !== sessionId));
            if (activeSessionId === sessionId) {
              setActiveSessionId(sessions[0] || null);
            }
          }
        });

        terminalManager.on('error', (error: Error) => {
          console.error('Terminal error:', error);
        });
      } catch (error) {
        // Handle initialization errors
        console.error('Failed to initialize terminal:', error);
      }
    };

    initializeTerminal();

    return () => {
      // Cleanup on unmount
      mounted = false;
      if (terminalServiceRef.current) {
        terminalServiceRef.current.dispose();
      }
    };
  }, []);

  return (
    <div className="terminal-panel">
      {/* Terminal panel header with close button */}
      <div className="terminal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#23272e', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Terminal</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: '0 8px' }} title="Close">×</button>
      </div>
      {/* Container for the terminal UI */}
      <div ref={containerRef} className="terminal-container" style={{ height: 'calc(100% - 32px)' }} />
    </div>
  );
};