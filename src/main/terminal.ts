import * as os from 'os';
import * as pty from 'node-pty-prebuilt-multiarch';
import { ipcMain } from 'electron';

interface TerminalOptions {
  shell: string;
  args: string[];
  env: { [key: string]: string };
  cwd: string;
}

export class Terminal {
  private ptyProcess: pty.IPty;

  constructor(options: TerminalOptions) {
    this.ptyProcess = pty.spawn(options.shell, options.args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
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