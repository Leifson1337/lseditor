import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
}

export const Terminal: React.FC<TerminalProps> = ({ onData, onResize }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (terminalRef.current) {
      const xterm = new XTerm();
      const fitAddon = new FitAddon();
      
      xterm.loadAddon(fitAddon);
      xterm.open(terminalRef.current);
      fitAddon.fit();

      xtermRef.current = xterm;
      fitAddonRef.current = fitAddon;

      if (onData) {
        xterm.onData(onData);
      }

      const handleResize = () => {
        fitAddon.fit();
        if (onResize) {
          onResize(xterm.cols, xterm.rows);
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        xterm.dispose();
      };
    }
  }, [onData, onResize]);

  return <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />;
}; 