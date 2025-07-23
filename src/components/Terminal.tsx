import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { Unicode11Addon } from 'xterm-addon-unicode11';
// import { LigaturesAddon } from '@xterm/addon-ligatures';
import '../styles/Terminal.css';

// Props for the Terminal component
interface TerminalProps {
  isOpen: boolean;
  onToggle: () => void;
  terminalManager: any;
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
  onExit?: () => void;
  options?: any;
  addMessage?: (message: string) => void;
  onInit?: () => void;
  onTitleChange?: (title: string) => void;
  onActive?: () => void;
  [key: string]: any; // For any additional props
}

// Terminal component wraps xterm.js and manages its lifecycle
export const Terminal: React.FC<TerminalProps> = ({
  isOpen,
  onToggle,
  terminalManager,
  onResize = () => {},
  onData = () => {},
  onExit = () => {},
  options = {},
  addMessage = () => {},
  onInit = () => {},
  onTitleChange = () => {},
  onActive = () => {},
  ...rest
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);    // Ref for the terminal container div
  const xtermRef = useRef<XTerm | null>(null);         // Ref for the xterm.js instance
  const fitAddonRef = useRef<FitAddon | null>(null);   // Ref for the fit addon

  useEffect(() => {
    // Mount xterm.js terminal when component mounts
    console.log('Terminal component mounted');
    
    if (!terminalRef.current) {
      console.error('Terminal container not found');
      return;
    }

    let xterm: XTerm | null = null;
    let fitAddon: FitAddon | null = null;

    try {
      // Initialize xterm.js with common options
      console.log('Initializing xterm.js');
      xterm = new XTerm({ 
        allowProposedApi: true, 
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, Monaco, monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
        disableStdin: false,
        cursorStyle: 'bar',
        scrollback: 1000,
        screenReaderMode: true,
        convertEol: true,
        allowTransparency: true,
        windowsMode: true,
        macOptionIsMeta: true,
      });

      // Add Unicode, fit, web links, and search addons
      try {
        const unicodeAddon = new Unicode11Addon();
        xterm.loadAddon(unicodeAddon);
        xterm.unicode.activeVersion = '11';
        console.log('Unicode addon loaded');

        fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);
        console.log('Fit addon loaded');

        xterm.loadAddon(new WebLinksAddon());
        console.log('Web links addon loaded');

        xterm.loadAddon(new SearchAddon());
        console.log('Search addon loaded');
      } catch (addonError) {
        console.error('Failed to load terminal addons:', addonError);
      }

      // Attach terminal to the DOM
      console.log('Opening terminal in container');
      xterm.open(terminalRef.current);
      
      try {
        fitAddon?.fit();
        console.log('Terminal fitted to container');
      } catch (fitError) {
        console.error('Failed to fit terminal:', fitError);
      }

      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      // Set up data handler for terminal input
      if (onData) {
        console.log('Setting up data handler');
        xterm.onData(onData);
      }

      // Handle terminal resize events
      const handleResize = () => {
        if (!xterm || !fitAddon) return;
        
        try {
          console.log('Handling terminal resize');
          fitAddon.fit();
          if (onResize && xterm.cols && xterm.rows) {
            onResize(xterm.cols, xterm.rows);
          }
        } catch (resizeError) {
          console.error('Error during terminal resize:', resizeError);
        }
      };

      // Debounce resize events
      let resizeTimeout: NodeJS.Timeout;
      const debouncedResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleResize, 50);
      };

      window.addEventListener('resize', debouncedResize);

      // Initial resize after a short delay to ensure DOM is ready
      const initTimeout = setTimeout(() => {
        try {
          handleResize();
        } catch (error) {
          console.error('Error during initial terminal resize:', error);
        }
      }, 100);

      return () => {
        // Clean up on unmount
        console.log('Terminal component unmounting');
        clearTimeout(resizeTimeout);
        clearTimeout(initTimeout);
        window.removeEventListener('resize', debouncedResize);
        
        try {
          if (xterm) {
            xterm.dispose();
            console.log('Terminal disposed');
          }
        } catch (disposeError) {
          console.error('Error disposing terminal:', disposeError);
        }
      };
    } catch (error) {
      console.error('Failed to initialize terminal:', error);
      // Try to clean up partially initialized components
      try {
        xterm?.dispose();
      } catch (e) {
        console.error('Error during cleanup after failed init:', e);
      }
    }
  }, [onResize, onData]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="terminal-container">
      <div 
        ref={terminalRef} 
        className="terminal"
        style={{ width: '100%', height: '100%' }}
      />
      <button 
        className="terminal-toggle" 
        onClick={onToggle}
        title="Toggle terminal"
      >
        {isOpen ? '▼' : '▲'}
      </button>
    </div>
  );
};