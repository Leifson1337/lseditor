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

interface TerminalPanelProps {
  onClose: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalServiceRef = useRef<TerminalService | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const initializeTerminal = async () => {
      try {
        if (!containerRef.current) return;

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

        const terminalService = new TerminalService(
          null,
          aiService,
          projectService,
          uiService,
          terminalServer,
          store
        );

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

        const element = terminalService.getElement();
        containerRef.current.appendChild(element);

        if (!mounted) return;

        // Create initial terminal session
        const session = await terminalManager.createSession({});
        setActiveSessionId(session.id);

        // Set up event listeners
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
        console.error('Failed to initialize terminal:', error);
      }
    };

    initializeTerminal();

    return () => {
      mounted = false;
      if (terminalServiceRef.current) {
        terminalServiceRef.current.dispose();
      }
    };
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#23272e', borderBottom: '1px solid #333' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Terminal</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', padding: '0 8px' }} title="Schließen">×</button>
      </div>
      <div ref={containerRef} className="terminal-container" style={{ height: 'calc(100% - 32px)' }} />
    </div>
  );
}; 