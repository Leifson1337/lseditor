import { EventEmitter } from '../utils/EventEmitter';
import { TerminalService } from '../services/TerminalService';
import { v4 as uuidv4 } from 'uuid';
import { AIService } from '../services/AIService';
import { UIService } from '../services/UIService';

// Sichere ipcRenderer-Initialisierung
let ipcRenderer: any = null;
// Prüfe, ob wir im Renderer-Prozess sind
const isRenderer = typeof window !== 'undefined' && typeof process !== 'undefined' && process.type === 'renderer';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in terminalServer', e);
}

// Hilfsfunktion für sichere IPC-Aufrufe
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
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

// Define the pty interface
interface IPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitData: { exitCode: number, signal: number }) => void): void;
}

// Define the pty module interface
interface PtyModule {
  spawn(file: string, args: string[], options: any): IPty;
}

// Create mock pty module
const pty: PtyModule = {
  spawn: (file: string, args: string[], options: any) => {
    return new MockPty(file, args, options);
  }
};

interface TerminalSession {
  id: string;
  pty: IPty;
  ws: WebSocket;
}

type TerminalMessageType = 'input' | 'output' | 'resize' | 'session' | 'error';

interface BaseTerminalMessage {
  type: TerminalMessageType;
  sessionId?: string;
}

interface DataTerminalMessage extends BaseTerminalMessage {
  type: 'input' | 'output';
  data: string;
}

interface ResizeTerminalMessage extends BaseTerminalMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface SessionTerminalMessage extends BaseTerminalMessage {
  type: 'session';
  sessionId: string;
}

interface ErrorTerminalMessage extends BaseTerminalMessage {
  type: 'error';
  error: string;
}

type TerminalMessage = DataTerminalMessage | ResizeTerminalMessage | SessionTerminalMessage | ErrorTerminalMessage;

interface TerminalOptions {
  shell?: string;
  args?: string[];
  env?: { [key: string]: string };
  cwd?: string;
  cols?: number;
  rows?: number;
}

interface TerminalServerConfig {
  shell: string;
  args: string[];
  cwd: string;
  env?: { [key: string]: string };
  cols: number;
  rows: number;
}

export class TerminalServer extends EventEmitter {
  private wss: any = null;
  private port: number;
  private terminalService!: TerminalService;
  private aiService: AIService;
  private uiService: UIService;
  private sessions: Map<string, TerminalSession> = new Map();

  constructor(port: number) {
    super();
    this.port = port;
    this.aiService = AIService.getInstance({
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
    this.uiService = new UIService();
    console.log('TerminalServer constructor called with port:', port);
    this.initialize();
  }

  public async findAvailablePort(startPort: number): Promise<number> {
    // Im Renderer-Prozess: Delegiere an den Main-Prozess
    if (isRenderer) {
      return safeIpcInvoke('findAvailablePort', startPort);
    }
    
    // Fallback für Tests
    return startPort;
  }

  public async isPortAvailable(port: number): Promise<boolean> {
    // Im Renderer-Prozess: Delegiere an den Main-Prozess
    if (isRenderer) {
      return safeIpcInvoke('isPortAvailable', port);
    }
    
    // Fallback für Tests
    return true;
  }

  public async initialize() {
    console.log('Initializing TerminalServer');
    
    // Im Renderer-Prozess: Delegiere an den Main-Prozess
    if (isRenderer) {
      // Initialisiere den WebSocket-Server im Main-Prozess
      await safeIpcInvoke('initTerminalServer', this.port);
      
      // Registriere Event-Handler für WebSocket-Nachrichten
      if (ipcRenderer) {
        ipcRenderer.on('terminal:data', (event: any, sessionId: string, data: string) => {
          // Handle terminal data from main process
          this.emit('data', { sessionId, data });
        });
      }
    }
  }

  public send(data: string) {
    // Im Renderer-Prozess: Delegiere an den Main-Prozess
    if (isRenderer) {
      safeIpcInvoke('terminalSend', data);
    }
  }

  public close() {
    // Im Renderer-Prozess: Delegiere an den Main-Prozess
    if (isRenderer) {
      safeIpcInvoke('closeTerminalServer', this.port);
    }
  }

  public dispose() {
    this.close();
  }

  public getPort(): number {
    return this.port;
  }
}