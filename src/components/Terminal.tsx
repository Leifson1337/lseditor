import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { Unicode11Addon } from 'xterm-addon-unicode11';
// import { LigaturesAddon } from '@xterm/addon-ligatures';
import '../styles/Terminal.css';

interface TerminalProps {
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
}

export const Terminal: React.FC<TerminalProps> = ({ onResize, onData }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    console.log('Terminal component mounted');
    if (!terminalRef.current) {
      console.error('Terminal container not found');
      return;
    }

    console.log('Initializing xterm.js');
    // Terminal mit allowProposedApi: true initialisieren
    const xterm = new XTerm({ allowProposedApi: true, 
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, Monaco, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const unicodeAddon = new Unicode11Addon();
    xterm.loadAddon(unicodeAddon);
    xterm.unicode.activeVersion = '11';

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());
    xterm.loadAddon(new SearchAddon());

    console.log('Opening terminal in container');
    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    if (onData) {
      console.log('Setting up data handler');
      xterm.onData(onData);
    }

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
      console.log('Terminal component unmounting');
      window.removeEventListener('resize', handleResize);
      xterm.dispose();
    };
  }, [onResize, onData]);

  return (
    <div className="terminal-container">
      <div className="terminal-wrapper">
        <div ref={terminalRef} className="terminal" />
      </div>
    </div>
  );
}; 