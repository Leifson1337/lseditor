import * as os from 'os';
import * as WebSocket from 'ws';
import * as http from 'http';
import { EventEmitter } from 'events';
import { TerminalService } from '../services/TerminalService';
import { v4 as uuidv4 } from 'uuid';
import * as net from 'net';

// Define the pty interface to match what we expect from node-pty-prebuilt-multiarch
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

let pty: PtyModule;
try {
  pty = require('node-pty-prebuilt-multiarch');
} catch (error) {
  console.warn('Failed to load node-pty-prebuilt-multiarch:', error);
  // Provide a mock implementation for development
  pty = {
    spawn: (file: string, args: string[], options: any) => {
      const mockPty = new EventEmitter() as any;
      mockPty.write = (data: string) => {
        mockPty.emit('data', `Mock terminal: ${data}`);
      };
      mockPty.resize = () => {};
      mockPty.kill = () => {};
      mockPty.onData = (callback: (data: string) => void) => {
        mockPty.on('data', callback);
      };
      mockPty.onExit = (callback: (exitData: { exitCode: number, signal: number }) => void) => {
        mockPty.on('exit', callback);
      };
      // Send initial message
      setTimeout(() => {
        mockPty.emit('data', 'Mock terminal initialized. Native terminal functionality is not available.\n');
      }, 100);
      return mockPty;
    }
  } as PtyModule;
}

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

const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
};

const findAvailablePort = async (startPort: number, maxAttempts: number = 10): Promise<number> => {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
};

export class TerminalServer extends EventEmitter {
  public port: number = 3003;
  private server: http.Server;
  private wss: WebSocket.Server;
  private sessions: Map<string, TerminalSession> = new Map();
  private isShuttingDown: boolean = false;
  private terminalService: TerminalService;
  private terminals: Map<string, IPty> = new Map();

  constructor(config: number | TerminalServerConfig) {
    super();
    this.server = http.createServer();
    this.wss = new WebSocket.Server({ server: this.server });
    
    if (typeof config === 'object') {
      this.setupTerminal(config);
    } else {
      this.setupTerminal({
        shell: process.platform === 'win32' ? 'powershell.exe' : 'bash',
        args: [],
        cwd: process.cwd(),
        cols: 80,
        rows: 30
      });
    }
    
    this.terminalService = TerminalService.getInstance(
      null,
      null as any,
      null as any,
      null as any,
      this,
      null as any
    );

    // Initialize the server
    this.setupServer().catch(error => {
      console.error('Failed to initialize terminal server:', error);
      this.emit('error', error);
    });

    // Handle process termination
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
  }

  private async setupServer(): Promise<void> {
    try {
      this.port = await findAvailablePort(3003);
      this.wss.on('connection', this.handleConnection.bind(this));

      this.server.on('error', (error) => {
        console.error('Terminal server error:', error);
        this.emit('error', error);
      });

      await new Promise<void>((resolve, reject) => {
        this.server.listen(this.port, () => {
          console.log(`Terminal server listening on port ${this.port}`);
          resolve();
        });
        this.server.on('error', reject);
      });
    } catch (error) {
      console.error('Failed to start terminal server:', error);
      throw error;
    }
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    try {
      const sessionId = this.generateSessionId();
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      
      const options: TerminalOptions = {
        shell,
        args: [],
        env: Object.fromEntries(
          Object.entries(process.env)
            .filter(([_, value]) => value !== undefined)
            .map(([key, value]) => [key, value as string])
        ),
        cwd: process.env.HOME || process.cwd(),
        cols: 80,
        rows: 24
      };

      const ptyProcess = pty.spawn(options.shell!, options.args || [], {
        name: 'xterm-color',
        cols: options.cols!,
        rows: options.rows!,
        cwd: options.cwd!,
        env: options.env
      });

      const session: TerminalSession = {
        id: sessionId,
        pty: ptyProcess,
        ws
      };

      this.sessions.set(sessionId, session);

      ws.on('message', (rawMessage: WebSocket.RawData) => {
        try {
          const message = JSON.parse(rawMessage.toString()) as TerminalMessage;
          
          switch (message.type) {
            case 'input':
              ptyProcess.write(message.data);
              break;
            case 'resize':
              ptyProcess.resize(message.cols, message.rows);
              break;
          }
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendError(ws, 'Failed to process message');
        }
      });

      ptyProcess.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            const message: DataTerminalMessage = {
              type: 'output',
              data
            };
            ws.send(JSON.stringify(message));
          } catch (error) {
            console.error('Error sending output:', error);
          }
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        this.emit('exit', { sessionId, exitCode, signal });
        this.cleanupSession(sessionId);
      });

      ws.on('close', () => {
        this.cleanupSession(sessionId);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.cleanupSession(sessionId);
      });

      const initMessage: SessionTerminalMessage = {
        type: 'session',
        sessionId
      };
      ws.send(JSON.stringify(initMessage));
    } catch (error) {
      console.error('Error creating terminal session:', error);
      this.sendError(ws, 'Failed to create terminal session');
    }
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.pty.kill();
        session.ws.close();
      } catch (error: unknown) {
        console.error('Error cleaning up session:', error);
      }
      this.sessions.delete(sessionId);
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      const errorMessage: ErrorTerminalMessage = {
        type: 'error',
        error: message
      };
      ws.send(JSON.stringify(errorMessage));
    }
  }

  private generateSessionId(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('hex');
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('Shutting down terminal server...');

    // Close all WebSocket connections
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    });

    // Kill all PTY processes
    for (const [sessionId, session] of this.sessions) {
      this.cleanupSession(sessionId);
    }

    // Close the WebSocket server
    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });

    // Close the HTTP server
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });

    console.log('Terminal server shutdown complete');
  }

  public dispose(): void {
    this.shutdown().catch(error => {
      console.error('Error during terminal server disposal:', error);
    });
  }

  public onExit(callback: (data: { sessionId: string; exitCode: number; signal: number }) => void): void {
    this.on('exit', callback);
  }

  public write(sessionId: string, data: string): void {
    const terminal = this.sessions.get(sessionId)?.pty;
    if (terminal) {
      terminal.write(data);
    }
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const terminal = this.sessions.get(sessionId)?.pty;
    if (terminal) {
      terminal.resize(cols, rows);
    }
  }

  public kill(sessionId: string): void {
    const terminal = this.sessions.get(sessionId)?.pty;
    if (terminal) {
      terminal.kill();
      this.sessions.delete(sessionId);
    }
  }

  private setupTerminal(config: TerminalServerConfig): void {
    const sessionId = uuidv4();
    const terminal = pty.spawn(config.shell, config.args, {
      name: 'xterm-color',
      cols: config.cols,
      rows: config.rows,
      cwd: config.cwd,
      env: config.env
    });

    this.terminals.set(sessionId, terminal);

    terminal.onData((data: string) => {
      this.emit('data', { sessionId, data });
    });

    terminal.onExit(({ exitCode, signal }) => {
      this.emit('exit', { sessionId, exitCode, signal });
      this.terminals.delete(sessionId);
    });
  }

  public onData(callback: (data: { sessionId: string; data: string }) => void): void {
    this.on('data', callback);
  }
} 