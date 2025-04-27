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
  onResize?: (cols: number, rows: number) => void; // Callback for terminal resize events
  onData?: (data: string) => void;                // Callback for terminal input data
}

// Terminal component wraps xterm.js and manages its lifecycle
export const Terminal: React.FC<TerminalProps> = ({ onResize, onData }) => {
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

    // Initialize xterm.js with common options
    console.log('Initializing xterm.js');
    const xterm = new XTerm({ allowProposedApi: true, 
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, Monaco, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    // Add Unicode, fit, web links, and search addons
    const unicodeAddon = new Unicode11Addon();
    xterm.loadAddon(unicodeAddon);
    xterm.unicode.activeVersion = '11';

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.loadAddon(new SearchAddon());

    // Attach terminal to the DOM
    console.log('Opening terminal in container');
    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Set up data handler for terminal input
    if (onData) {
      console.log('Setting up data handler');
      xterm.onData(onData);
    }

    // Handle terminal resize events
    const handleResize = () => {
      console.log('Handling terminal resize');
      fitAddon.fit();
      if (onResize) {
        onResize(xterm.cols, xterm.rows);
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial resize
    handleResize();

    return () => {
      // Clean up on unmount
      console.log('Terminal component unmounting');
      window.removeEventListener('resize', handleResize);
      xterm.dispose();
    };
  }, [onResize, onData]);

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper">
        {/* Container for the xterm.js terminal */}
        <div ref={terminalRef} className="terminal" />
      </div>
    </div>
  );
};