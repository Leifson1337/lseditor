import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from './Terminal';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { useServices } from '../contexts/ServiceContext'; // Import useServices hook
import { TerminalSession } from '../types/terminal'; // Keep this if TerminalSession is used for event types
import './TerminalPanel.css';

// Props for the TerminalPanel component
interface TerminalPanelProps {
  onClose: () => void; // Callback to close the terminal panel
}

// TerminalPanel manages terminal sessions and renders the terminal UI
export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { terminalService, terminalManager, aiService, projectService, uiService, store } = useServices();
  
  // terminalServiceRef might not be needed if terminalService from context is always used
  // const terminalServiceRef = useRef<TerminalService | null>(null); 
  
  const [sessionData, setSessionData] = useState<TerminalSession[]>([]); // Store full session objects
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // const [isTerminalInitialized, setIsTerminalInitialized] = useState(false); // May not be needed if we rely on service readiness

  // Ref for the DOM element where the active XTerm instance will be mounted
  const activeTerminalRef = useRef<HTMLDivElement>(null);

  // Effect for initializing and handling service readiness + event listeners
  useEffect(() => {
    if (!terminalService || !terminalManager) {
      console.log('TerminalPanel: Services not yet available.');
      return;
    }

    let mounted = true;

    const setupTerminalEnvironment = async () => {
      console.log('TerminalPanel: Setting up terminal environment...');
      try {
        // TerminalService should be initialized by App.tsx via ServiceContext provider
        // We just need to ensure TerminalManager is ready (which TerminalService's init should ensure)
        if (!terminalManager.isInitialized) { // Assuming isInitialized on TerminalManager
          await terminalManager.initialize(); // Should be lightweight if already done
        }

        if (!mounted) return;

        const currentSessions = terminalManager.getAllSessions();
        setSessionData(currentSessions);

        let currentActiveId = terminalManager.getActiveSession()?.id || null;
        if (!currentActiveId && currentSessions.length > 0) {
          currentActiveId = currentSessions[0].id;
          terminalManager.activateSession(currentActiveId); // Ensure manager knows
        }
        setActiveSessionId(currentActiveId);

      } catch (error) {
        console.error('Failed to setup terminal environment:', error);
      }
    };

    setupTerminalEnvironment();
    
    // Event listeners from TerminalManager (forwarded by TerminalService if necessary, or direct)
    // Assuming TerminalManager is the source of truth for these events now.
    const handleSessionCreated = (session: TerminalSession) => {
      if (mounted) {
        setSessionData(prev => [...prev, session]);
        // Optionally activate the new session
        // setActiveSessionId(session.id); 
        // terminalManager.activateSession(session.id);
      }
    };
    const handleSessionRemoved = (sessionId: string) => { // Manager emits sessionId
      if (mounted) {
        setSessionData(prev => prev.filter(s => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          const remainingSessions = terminalManager.getAllSessions().filter(s => s.id !== sessionId);
          const newActiveId = remainingSessions.length > 0 ? remainingSessions[0].id : null;
          setActiveSessionId(newActiveId);
          if (newActiveId) terminalManager.activateSession(newActiveId);
        }
      }
    };
     const handleSessionActivated = (session: TerminalSession | string) => { // Manager emits session object or ID
        if (mounted) {
            const newActiveId = typeof session === 'string' ? session : session.id;
            setActiveSessionId(newActiveId);
        }
    };

    terminalManager.on('sessionCreated', handleSessionCreated);
    terminalManager.on('sessionRemoved', handleSessionRemoved);
    terminalManager.on('sessionActivated', handleSessionActivated); // Listen for activation changes

    return () => {
      mounted = false;
      terminalManager.off('sessionCreated', handleSessionCreated);
      terminalManager.off('sessionRemoved', handleSessionRemoved);
      terminalManager.off('sessionActivated', handleSessionActivated);
    };

  }, [terminalService, terminalManager, activeSessionId]); // Rerun if services change

  // Effect for attaching/detaching XTerm instance to the DOM
  useEffect(() => {
    if (!activeSessionId || !terminalService || !activeTerminalRef.current) {
      // Clear the container if no active session or if terminal is not ready
      if(activeTerminalRef.current) {
        while (activeTerminalRef.current.firstChild) {
          activeTerminalRef.current.removeChild(activeTerminalRef.current.firstChild);
        }
      }
      return;
    }
    
    console.log(`TerminalPanel: Attaching XTerm for session ${activeSessionId}`);
    terminalService.attachXTermToElement(activeSessionId, activeTerminalRef.current);
    
    // Optional: Fit the terminal after attaching
    const xtermInstance = terminalManager?.getSessionXTerm(activeSessionId);
    const fitAddon = xtermInstance?.['_core'].viewport?._characterMeasure?.parentElement ? new FitAddon() : null; // Hacky way to check if DOM is ready
    if (xtermInstance && fitAddon && xtermInstance.element) { // Check if xterm.element is available
        try {
            // xtermInstance.loadAddon(fitAddon); // Load addon only if not already loaded
            // fitAddon.fit();
        } catch (e) {
            console.warn("FitAddon might already be loaded or failed to load", e);
        }
    }


    // No explicit detach needed here, as the activeTerminalRef will be cleared
    // or reused by the next active session. If specific cleanup per session on deactivation
    // is needed, TerminalService.detachXTermFromElement could be called.
  }, [activeSessionId, terminalService, terminalManager]);


  const handleCreateNewSession = async () => {
    if (!terminalService) return;
    try {
      const newSession = await terminalService.createSession({}); // Default config
      // The 'sessionCreated' event should update sessionData.
      // We might want to activate it immediately.
      if (terminalManager && newSession) {
        terminalManager.activateSession(newSession.id); // This will trigger 'sessionActivated'
      }
    } catch (error) {
      console.error("Failed to create new session:", error);
    }
  };
  
  const handleSwitchSession = (sessionId: string) => {
    if (terminalManager) {
        terminalManager.activateSession(sessionId); // This will trigger 'sessionActivated'
    }
  };

  const handleCloseSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent tab selection when clicking close
    if (!terminalService) return;
    try {
      await terminalService.removeSession(sessionId);
      // 'sessionRemoved' event should handle UI update
    } catch (error) {
      console.error("Failed to close session:", sessionId, error);
    }
  };


  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-tabs">
          {sessionData.map(session => (
            <button
              key={session.id}
              className={`terminal-tab-button ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => handleSwitchSession(session.id)}
              title={session.config.title || `Session ${session.id.substring(0, 4)}`}
            >
              {session.config.title || `Terminal ${sessionData.findIndex(s => s.id === session.id) + 1}`}
              <span 
                className="close-tab-button" 
                onClick={(e) => handleCloseSession(session.id, e)}
                title="Close Session"
              >
                &times;
              </span>
            </button>
          ))}
          <button onClick={handleCreateNewSession} className="new-tab-button" title="New Terminal Session">+</button>
        </div>
        <button onClick={onClose} className="close-panel-button" title="Close Panel">×</button>
      </div>
      <div ref={activeTerminalRef} className="terminal-active-container" style={{ height: 'calc(100% - 32px)', width: '100%' }} />
    </div>
  );
};