import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import * as path from 'path';
import * as fs from 'fs';

// Import types
import type { ITerminalAddon, IEvent } from '@xterm/xterm';

// Import styles
import '@xterm/xterm/css/xterm.css';
import './TerminalPanel.css';

// Type for command handler
interface CommandHandler {
  (args: string[], term: Terminal, onExit?: () => void): Promise<number> | number;
}



// Built-in commands
const COMMANDS: Record<string, CommandHandler> = {
  help: async (args, term) => {
    term.writeln('\r\nAvailable commands:');
    term.writeln('  clear    - Clear the terminal');
    term.writeln('  help     - Show this help message');
    term.writeln('  echo     - Print arguments to the terminal');
    term.writeln('  pwd      - Print current working directory');
    term.writeln('  exit     - Close the terminal');
    return 0;
  },
  
  clear: (args, term) => {
    term.clear();
    return 0;
  },
  
  echo: (args, term) => {
    term.writeln(args.join(' '));
    return 0;
  },
  
  pwd: async (args, term) => {
    try {
      const cwd = process.cwd();
      term.writeln(`\r${cwd}`);
      return 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      term.writeln(`\x1b[31mError: ${errorMessage}\x1b[0m`);
      return 1;
    }
  },
  
  exit: (args, term, onExit) => {
    if (onExit) onExit();
    return 0;
  }
};

interface TerminalPanelProps {
  onClose: () => void;
  isVisible: boolean;
  initialCwd?: string;
  port?: number;
  onTerminalInit?: (term: Terminal) => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  onClose, 
  isVisible, 
  initialCwd = process.cwd(),
  port,
  onTerminalInit
}) => {
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState(initialCwd);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentInput, setCurrentInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon>(new FitAddon());
  const [terminalInitialized, setTerminalInitialized] = useState(false);
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isProcessingRef = useRef(false);
  const cwdRef = useRef(cwd);
  
  // Update refs when state changes
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);
  
  // Initialize terminal
  useEffect(() => {
    if (!isVisible || !containerRef.current || terminalInitialized) return;
    
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    });
    
    const fitAddon = fitAddonRef.current;
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    
    // Load addons
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new Unicode11Addon());
    
    // Try to enable WebGL renderer
    try {
      const webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
      // Handle context loss if the method exists
      if ('onContextLoss' in webglAddon) {
        (webglAddon as any).onContextLoss(() => {
          webglAddon.dispose();
        });
      }
    } catch (e) {
      console.warn('WebGL addon could not be loaded, falling back to canvas renderer');
    }
    
    // Open terminal in container
    term.open(containerRef.current);
    fitAddon.fit();
    
    // Set initial prompt and welcome message
    term.writeln('Welcome to LS Editor Terminal');
    term.writeln('Type \'help\' to see available commands');
    showPrompt(term);
    
    // Handle terminal input
    const onData = (data: string) => {
      if (isProcessingRef.current) return;
      
      const printable = ![
        '\r', '\x7f', '\x1b[A', '\x1b[B', '\x1b[D', '\x1b[C',
        '\x1b[1;5D', '\x1b[1;5C', '\x1b[H', '\x1b[F', '\x03', '\x04', '\x0c', '\t'
      ].includes(data);
      
      // Handle special keys
      switch (data) {
        case '\r': { // Enter
          const input = currentInput;
          term.write('\r\n');
          handleCommand(input, term);
          commandHistoryRef.current = [input, ...commandHistoryRef.current].slice(0, 50);
          setCommandHistory(commandHistoryRef.current);
          setCurrentInput('');
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
          break;
        }
          
        case '\x7f': // Backspace
          if (currentInput.length > 0) {
            term.write('\b \b');
            setCurrentInput(prev => prev.slice(0, -1));
          }
          break;
          
        case '\t': // Tab
          if (currentInput.trim()) {
            handleTabCompletion(currentInput, term);
          }
          break;
          
        case '\x1b[A': // Up arrow
          if (commandHistoryRef.current.length > 0 && historyIndexRef.current < commandHistoryRef.current.length - 1) {
            const newIndex = historyIndexRef.current + 1;
            const historyCommand = commandHistoryRef.current[newIndex];
            historyIndexRef.current = newIndex;
            setCurrentInput(historyCommand);
            term.write('\x1b[2K\r$ ' + historyCommand);
          }
          break;
          
        case '\x1b[B': // Down arrow
          if (historyIndexRef.current > 0) {
            const newIndex = historyIndexRef.current - 1;
            const historyCommand = commandHistoryRef.current[newIndex];
            historyIndexRef.current = newIndex;
            setCurrentInput(historyCommand);
            term.write('\x1b[2K\r$ ' + historyCommand);
          } else if (historyIndexRef.current === 0) {
            historyIndexRef.current = -1;
            setCurrentInput('');
            term.write('\x1b[2K\r$ ');
          }
          break;
          
        case '\x03': // Ctrl+C
          term.write('^C\r\n');
          showPrompt(term);
          break;
          
        case '\x0c': // Ctrl+L
          term.clear();
          showPrompt(term);
          break;
          
        default:
          if (printable) {
            term.write(data);
            setCurrentInput(prev => prev + data);
          }
      }
    };
    
    // Handle window resize
    const onResize = () => fitAddon.fit();
    window.addEventListener('resize', onResize);
    
    // Set up event listeners
    term.onData(onData);
    
    // Store terminal reference
    terminalRef.current = term;
    setTerminalInitialized(true);
    
    // Notify parent component
    if (onTerminalInit) {
      onTerminalInit(term);
    }
    
    // Cleanup function
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
    };
  }, [isVisible, onTerminalInit]);
  
  // Show prompt with current working directory and optional input
  const showPrompt = useCallback((term: Terminal, currentInput: string = '') => {
    // Clear the current line and move cursor to start
    term.write('\x1b[2K\r');
    
    // Write prompt with current working directory
    const prompt = `\x1b[1;32m${cwdRef.current} $\x1b[0m`;
    term.write(prompt);
    
    // Set current input if provided
    if (currentInput) {
      term.write(currentInput);
      setCurrentInput(currentInput);
    } else {
      setCurrentInput('');
    }
    
    // Ensure cursor is visible and focused
    term.focus();
  }, []);

  // Update refs when state changes
  useEffect(() => {
    commandHistoryRef.current = commandHistory;
    historyIndexRef.current = historyIndex;
    isProcessingRef.current = isProcessing;
  }, [commandHistory, historyIndex, isProcessing]);
  
  // Handle command execution
  const handleCommand = useCallback(async (command: string, term: Terminal) => {
    if (!command.trim()) return 0;
    
    setIsProcessing(true);
    term.write('\r\n');
    
    const [cmd, ...args] = command.trim().split(/\s+/);
    const handler = COMMANDS[cmd.toLowerCase()];
    
    try {
      if (handler) {
        const exitCode = await handler(args, term, onClose);
        if (exitCode !== 0) {
          term.writeln(`\x1b[31mCommand failed with exit code ${exitCode}\x1b[0m`);
        }
        return exitCode;
      } else {
        // Execute system command using Node's child_process
        return new Promise<number>((resolve) => {
          const childProcess = require('child_process').spawn(cmd, args, {
            cwd: cwdRef.current,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          childProcess.stdout.on('data', (data: Buffer) => {
            term.write(data);
          });
          
          childProcess.stderr.on('data', (data: Buffer) => {
            term.write(`\x1b[31m${data}\x1b[0m`);
          });
          
          childProcess.on('close', (code: number) => {
            resolve(code || 0);
          });
          
          childProcess.on('error', (error: Error) => {
            term.writeln(`\x1b[31mError: ${error.message}\x1b[0m`);
            resolve(1);
          });
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      term.writeln(`\x1b[31mError: ${errorMessage}\x1b[0m`);
      return 1;
    } finally {
      setIsProcessing(false);
      showPrompt(term, '');
    }
  }, [onClose, showPrompt]);

  // Handle tab completion
  const handleTabCompletion = useCallback(async (input: string, term: Terminal) => {
    const parts = input.split(/\s+/);
    const lastPart = parts[parts.length - 1] || '';
    
    if (!lastPart) return;
    
    try {
      const dir = lastPart.includes(path.sep) ? path.dirname(lastPart) : '.';
      const prefix = lastPart.includes(path.sep) ? path.basename(lastPart) : lastPart;
      
      const dirPath = path.join(cwdRef.current, dir);
      const files = await fs.promises.readdir(dirPath);
      
      const matches = files.filter(file => file.startsWith(prefix));
      
      if (matches.length === 0) {
        return;
      } else if (matches.length === 1) {
        const match = matches[0];
        const fullPath = path.join(dir, match);
        let isDir = false;
        
        try {
          const stats = await fs.promises.stat(path.join(dirPath, match));
          isDir = stats.isDirectory();
        } catch (error) {
          console.error('Error getting file stats:', error);
          return;
        }
        
        parts[parts.length - 1] = isDir ? `${fullPath}${path.sep}` : fullPath;
        const completed = parts.join(' ');
        
        setCurrentInput(completed);
        term.write(match.slice(prefix.length) + (isDir ? path.sep : ''));
      } else {
        // Find common prefix
        let commonPrefix = '';
        const first = matches[0];
        const last = matches[matches.length - 1];
        const minLength = Math.min(first.length, last.length);
        
        for (let i = 0; i < minLength; i++) {
          if (first[i] === last[i]) {
            commonPrefix += first[i];
          } else {
            break;
          }
        }
        
        if (commonPrefix.length > prefix.length) {
          parts[parts.length - 1] = lastPart.replace(new RegExp(`${prefix}$`), commonPrefix);
          const completed = parts.join(' ');
          setCurrentInput(completed);
          term.write(commonPrefix.substring(prefix.length));
        } else {
          term.writeln('');
          term.writeln(matches.join('  '));
          showPrompt(term, input);
        }
      }
    } catch (error) {
      console.error('Tab completion error:', error);
      term.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
    }
  }, [showPrompt]);
  


  const COMMANDS: Record<string, (args: string[], term: Terminal, onClose?: () => void) => Promise<number> | number> = {
    help: async (_, term) => {
      term.writeln('Available commands:');
      term.writeln('  help     - Show this help message');
      term.writeln('  clear    - Clear the terminal');
      term.writeln('  ls       - List directory contents');
      term.writeln('  cd <dir> - Change directory');
      term.writeln('  pwd      - Print working directory');
      term.writeln('  exit     - Close the terminal');
      return 0;
    },
    clear: (_, term) => {
      term.clear();
      return 0;
    },
    ls: async (args, term) => {
      try {
        const dir = args[0] || '.';
        const files = await fs.promises.readdir(path.join(cwdRef.current, dir));
        term.writeln(files.join('  '));
        return 0;
      } catch (error) {
        term.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
        return 1;
      }
    },
    cd: async (args, term) => {
      if (!args[0]) {
        term.writeln('Usage: cd <directory>');
        return 1;
      }
      
      try {
        const newDir = path.resolve(cwdRef.current, args[0]);
        const stats = await fs.promises.stat(newDir);
        
        if (!stats.isDirectory()) {
          term.writeln(`\x1b[31mError: ${newDir} is not a directory\x1b[0m`);
          return 1;
        }
        
        setCwd(newDir);
        return 0;
      } catch (error) {
        term.writeln(`\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m`);
        return 1;
      }
    },
    pwd: (_, term) => {
      term.writeln(cwdRef.current);
      return 0;
    },
    exit: (_, __, onClose) => {
      onClose?.();
      return 0;
    }
  };

  if (!isVisible) return null;

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span>Terminal</span>
        <button className="terminal-close" onClick={onClose}>&times;</button>
      </div>
      <div 
        ref={containerRef} 
        className="terminal-container"
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1e1e1e',
          padding: '8px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      />
    </div>
  );
};

// Export the component
export default TerminalPanel;