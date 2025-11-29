// terminal.ts
// Entry point for terminal-related logic in the application
// Handles initialization, event handling, and integration with main process

import * as os from 'os';
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';

// TerminalOptions defines the options for creating a terminal instance
/**
 * Interface for terminal options.
 * 
 * @property {string} [shell] Path to the shell executable
 * @property {string[]} [args] Shell arguments
 * @property {{ [key: string]: string }} [env] Environment variables
 * @property {string} [cwd] Working directory
 * @property {number} [cols] Number of columns
 * @property {number} [rows] Number of rows
 */
interface TerminalOptions {
  shell?: string;                         // Path to the shell executable
  args?: string[];                        // Shell arguments
  env?: { [key: string]: string };        // Environment variables
  cwd?: string;                           // Working directory
  cols?: number;                          // Number of columns
  rows?: number;                          // Number of rows
}

// MockPty simulates a pseudo-terminal for testing without a real shell
/**
 * MockPty class simulates a pseudo-terminal for testing without a real shell.
 * 
 * @extends EventEmitter
 */
class MockPty extends EventEmitter {
  private shell: string;
  private args: string[];
  private options: any;

  /**
   * Creates a new MockPty instance.
   * 
   * @param {string} shell Path to the shell executable
   * @param {string[]} args Shell arguments
   * @param {any} options Terminal options
   */
  constructor(shell: string, args: string[], options: any) {
    super();
    this.shell = shell;
    this.args = args;
    this.options = options;
    
    // Send initial message to simulate terminal startup
    setTimeout(() => {
      this.emit('data', `Mock terminal initialized (${shell} ${args.join(' ')})\n`);
      this.emit('data', `Current directory: ${options.cwd}\n`);
      this.emit('data', `$ `);
    }, 100);
  }

  /**
   * Simulate writing data to the terminal.
   * 
   * @param {string} data Data to write to the terminal
   */
  write(data: string): void {
    // Echo the input
    this.emit('data', data);
    
    // Simulate command execution
    if (data.trim().endsWith('\r')) {
      const command = data.trim();
      if (command === 'clear') {
        this.emit('data', '\x1b[2J\x1b[H'); // ANSI escape to clear screen
      } else if (command === 'exit') {
        this.emit('exit', { exitCode: 0, signal: 0 });
      } else {
        this.emit('data', `\nCommand not implemented in mock terminal: ${command}\n`);
      }
      this.emit('data', `$ `);
    }
  }

  /**
   * Simulate resizing the terminal.
   * 
   * @param {number} cols New number of columns
   * @param {number} rows New number of rows
   */
  resize(cols: number, rows: number): void {
    this.options.cols = cols;
    this.options.rows = rows;
  }

  /**
   * Simulate killing the terminal process.
   */
  kill(): void {
    this.emit('exit', { exitCode: 0, signal: 0 });
  }

  /**
   * Register a callback for data events.
   * 
   * @param {(data: string) => void} callback Callback function to handle data events
   */
  onData(callback: (data: string) => void): void {
    this.on('data', callback);
  }

  /**
   * Register a callback for exit events.
   * 
   * @param {({ exitCode: number, signal: number }) => void} callback Callback function to handle exit events
   */
  onExit(callback: (exitData: { exitCode: number, signal: number }) => void): void {
    this.on('exit', callback);
  }
}

// Terminal provides a high-level API for managing a mock terminal session
/**
 * Terminal class provides a high-level API for managing a mock terminal session.
 */
export class Terminal {
  private ptyProcess: MockPty;

  /**
   * Creates a new Terminal instance.
   * 
   * @param {TerminalOptions} options Terminal options
   */
  constructor(options: TerminalOptions) {
    this.ptyProcess = new MockPty(options.shell || '', options.args || [], {
      name: 'xterm-color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd,
      env: options.env
    });
  }

  /**
   * Register a callback for terminal output.
   * 
   * @param {(data: string) => void} callback Callback function to handle terminal output
   */
  public onData(callback: (data: string) => void): void {
    this.ptyProcess.onData(callback);
  }

  /**
   * Write data to the terminal.
   * 
   * @param {string} data Data to write to the terminal
   */
  public write(data: string): void {
    this.ptyProcess.write(data);
  }

  /**
   * Resize the terminal.
   * 
   * @param {number} cols New number of columns
   * @param {number} rows New number of rows
   */
  public resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
  }

  /**
   * Dispose of the terminal instance.
   */
  public dispose(): void {
    this.ptyProcess.kill();
  }
}

// TerminalManager manages multiple terminal sessions
/**
 * TerminalManager class manages multiple terminal sessions.
 */
class TerminalManager {
  private terminals: Map<number, Terminal>;
  private nextTerminalId: number;

  /**
   * Creates a new TerminalManager instance.
   */
  constructor() {
    this.terminals = new Map();
    this.nextTerminalId = 0;
    this.setupIPC();
  }

  /**
   * Create a new terminal session.
   * 
   * @returns {number} The ID of the newly created terminal session
   */
  createTerminal(): number {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const terminal = new Terminal({
      shell,
      args: [],
      env: process.env as { [key: string]: string },
      cwd: homeDir
    });

    const id = this.nextTerminalId++;
    this.terminals.set(id, terminal);
    return id;
  }

  /**
   * Close a terminal session.
   * 
   * @param {number} terminalId The ID of the terminal session to close
   */
  closeTerminal(terminalId: number): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(terminalId);
    }
  }

  /**
   * Set up IPC event listeners.
   */
  private setupIPC(): void {
    ipcMain.on('terminal:create', (event) => {
      const id = this.createTerminal();
      event.reply('terminal:created', id);
    });

    ipcMain.on('terminal:close', (event, id: number) => {
      this.closeTerminal(id);
      event.reply('terminal:closed', id);
    });

    ipcMain.on('terminal:write', (event, { id, data }: { id: number; data: string }) => {
      const terminal = this.terminals.get(id);
      if (terminal) {
        terminal.write(data);
      }
    });

    ipcMain.on('terminal:resize', (event, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
      const terminal = this.terminals.get(id);
      if (terminal) {
        terminal.resize(cols, rows);
      }
    });
  }
}

// Export a singleton instance of TerminalManager
/**
 * Export a singleton instance of TerminalManager.
 */
export const terminalManager = new TerminalManager();