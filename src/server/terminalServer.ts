import * as os from 'os';
import * as WebSocket from 'ws';
import * as http from 'http';
import { EventEmitter } from 'events';
import { TerminalService } from '../services/TerminalService';
import { v4 as uuidv4 } from 'uuid';
import * as net from 'net';
import { WebSocketServer } from 'ws';
import { AIService } from '../services/AIService';
import { UIService } from '../services/UIService';

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
  private wss!: WebSocketServer;
  private port: number;
  private terminalService!: TerminalService;
  private aiService: AIService;
  private uiService: UIService;

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

  private async findAvailablePort(startPort: number): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port);
      });
    };

    let port = startPort;
    while (!(await isPortAvailable(port))) {
      port++;
    }
    return port;
  }

  private async initialize() {
    console.log('Initializing TerminalServer');
    try {
      this.port = await this.findAvailablePort(this.port);
      console.log('Found available port:', this.port);
      
      this.wss = new WebSocketServer({ port: this.port });
      console.log('Terminal server listening on port', this.port);

      this.wss.on('connection', (ws) => {
        console.log('New terminal connection established');
        this.emit('connection', ws);

        ws.on('message', (data) => {
          console.log('Received terminal data:', data.toString());
          this.emit('data', data.toString());
        });

        ws.on('close', () => {
          console.log('Terminal connection closed');
          this.emit('disconnection');
        });

        ws.on('error', (error) => {
          console.error('Terminal connection error:', error);
          this.emit('error', error);
        });
      });

      this.wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
        this.emit('error', error);
      });

      this.terminalService = TerminalService.getInstance(
        null,
        this.aiService,
        undefined, // projectService explizit undefined
        this.uiService,
        this
      );
    } catch (error) {
      console.error('Failed to initialize terminal server:', error);
      this.emit('error', error);
    }
  }

  public send(data: string) {
    console.log('Sending data to all clients:', data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  public close() {
    console.log('Closing terminal server');
    this.wss.close();
  }

  public dispose() {
    console.log('Disposing terminal server');
    this.close();
    this.removeAllListeners();
  }

  public getPort(): number {
    return this.port;
  }
} 