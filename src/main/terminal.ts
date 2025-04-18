import * as os from 'os';
import { EventEmitter } from 'events';
import { ipcMain } from 'electron';

interface TerminalOptions {
  shell?: string;
  args?: string[];
  env?: { [key: string]: string };
  cwd?: string;
  cols?: number;
  rows?: number;
}

// Mock PTY implementation
class MockPty extends EventEmitter {
  private shell: string;
  private args: string[];
  private options: any;

  constructor(shell: string, args: string[], options: any) {
    super();
    this.shell = shell;
    this.args = args;
    this.options = options;
    
    // Send initial message
    setTimeout(() => {
      this.emit('data', `Mock terminal initialized (${shell} ${args.join(' ')})\n`);
      this.emit('data', `Current directory: ${options.cwd}\n`);
      this.emit('data', `$ `);
    }, 100);
  }

  write(data: string): void {
    // Echo the input
    this.emit('data', data);
    
    // Simulate command execution
    if (data.trim().endsWith('\r')) {
      const command = data.trim();
      if (command === 'clear') {
        this.emit('data', '\x1b[2J\x1b[H');
      } else if (command === 'exit') {
        this.emit('exit', { exitCode: 0, signal: 0 });
      } else {
        this.emit('data', `\nCommand not implemented in mock terminal: ${command}\n`);
      }
      this.emit('data', `$ `);
    }
  }

  resize(cols: number, rows: number): void {
    this.options.cols = cols;
    this.options.rows = rows;
  }

  kill(): void {
    this.emit('exit', { exitCode: 0, signal: 0 });
  }

  onData(callback: (data: string) => void): void {
    this.on('data', callback);
  }

  onExit(callback: (exitData: { exitCode: number, signal: number }) => void): void {
    this.on('exit', callback);
  }
}

export class Terminal {
  private ptyProcess: MockPty;

  constructor(options: TerminalOptions) {
    this.ptyProcess = new MockPty(options.shell || '', options.args || [], {
      name: 'xterm-color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd,
      env: options.env
    });
  }

  public onData(callback: (data: string) => void): void {
    this.ptyProcess.onData(callback);
  }

  public write(data: string): void {
    this.ptyProcess.write(data);
  }

  public resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
  }

  public dispose(): void {
    this.ptyProcess.kill();
  }
}

class TerminalManager {
  private terminals: Map<number, Terminal>;
  private nextTerminalId: number;

  constructor() {
    this.terminals = new Map();
    this.nextTerminalId = 0;
    this.setupIPC();
  }

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

  closeTerminal(terminalId: number): void {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(terminalId);
    }
  }

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

export const terminalManager = new TerminalManager(); 