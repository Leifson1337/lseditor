import { EventEmitter } from '../utils/EventEmitter';
import { TerminalService } from '../services/TerminalService';
import { v4 as uuidv4 } from 'uuid';
import { AIService } from '../services/AIService';
import { UIService } from '../services/UIService';

// Safe ipcRenderer initialization for Electron renderer process
// ipcRenderer is used for inter-process communication in Electron
let ipcRenderer: any = null;

// Check if running in Electron renderer process
// This flag is used to determine if we are running in a renderer process
const isRenderer = typeof window !== 'undefined' && typeof process !== 'undefined' && process.type === 'renderer';

try {
  // Initialize ipcRenderer if available
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  // Log error if ipcRenderer initialization fails
  console.error('Failed to initialize ipcRenderer in terminalServer', e);
}

// Helper function for safe IPC calls
// This function checks if ipcRenderer is available before making an IPC call
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    // Log error if ipcRenderer is not available
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  // Make IPC call using ipcRenderer
  return ipcRenderer.invoke(channel, ...args);
}

// Mock PTY implementation for environments without a real PTY
// This class simulates a pseudo-terminal for testing purposes
class MockPty extends EventEmitter {
  private shell: string;
  private args: string[];
  private options: any;

  // Constructor for MockPty
  // Initializes the mock PTY with the given shell, args, and options
  constructor(shell: string, args: string[], options: any) {
    super();
    this.shell = shell;
    this.args = args;
    this.options = options;
    
    // Send initial message after short delay
    setTimeout(() => {
      // Emit 'data' event with initial message
      this.emit('data', `Mock terminal initialized (${shell} ${args.join(' ')})\n`);
      this.emit('data', `Current directory: ${options.cwd}\n`);
      this.emit('data', `$ `);
    }, 100);
  }

  // Simulate writing data to the terminal
  // This method echoes the input data and simulates command execution on Enter
  write(data: string): void {
    // Echo the input data
    this.emit('data', data);
    
    // Simulate command execution on Enter
    if (data.trim().endsWith('\r')) {
      const command = data.trim();
      if (command === 'clear') {
        // Clear screen escape sequence
        this.emit('data', '\x1b[2J\x1b[H');
      } else if (command === 'exit') {
        // Emit 'exit' event with exit code and signal
        this.emit('exit', { exitCode: 0, signal: 0 });
      } else {
        // Emit 'data' event with error message
        this.emit('data', `\nCommand not implemented in mock terminal: ${command}\n`);
      }
      // Emit 'data' event with prompt
      this.emit('data', `$ `);
    }
  }

  // Simulate resizing the terminal
  // This method updates the terminal options with the new size
  resize(cols: number, rows: number): void {
    this.options.cols = cols;
    this.options.rows = rows;
  }

  // Simulate killing the terminal process
  // This method emits an 'exit' event with exit code and signal
  kill(): void {
    this.emit('exit', { exitCode: 0, signal: 0 });
  }

  // Register a callback for data events
  // This method adds a listener for the 'data' event
  onData(callback: (data: string) => void): void {
    this.on('data', callback);
  }

  // Register a callback for exit events
  // This method adds a listener for the 'exit' event
  onExit(callback: (exitData: { exitCode: number, signal: number }) => void): void {
    this.on('exit', callback);
  }
}

// Define the pty interface for terminal emulation
// This interface defines the methods that a PTY implementation must provide
interface IPty {
  // Write data to the terminal
  write(data: string): void;
  // Resize the terminal
  resize(cols: number, rows: number): void;
  // Kill the terminal session
  kill(): void;
  // Register a callback for data events
  onData(callback: (data: string) => void): void;
  // Register a callback for exit events
  onExit(callback: (exitData: { exitCode: number, signal: number }) => void): void;
}

// Define the pty module interface
// This interface defines the methods that a PTY module must provide
interface PtyModule {
  // Spawn a new terminal session
  spawn(file: string, args: string[], options: any): IPty;
}

// Create mock pty module for use in non-node environments
// This module provides a mock PTY implementation for testing purposes
const pty: PtyModule = {
  spawn: (file: string, args: string[], options: any) => {
    return new MockPty(file, args, options);
  }
};

// Terminal session structure
// This interface defines the properties of a terminal session
interface TerminalSession {
  // Unique session ID
  id: string;
  // PTY instance for this session
  pty: IPty;
  // WebSocket connection for this session
  ws: WebSocket;
}

// Terminal message types for communication
// This type defines the possible message types exchanged with the terminal
type TerminalMessageType = 'input' | 'output' | 'resize' | 'session' | 'error';

// Base terminal message interface
// This interface defines the common properties of all terminal messages
interface BaseTerminalMessage {
  // Message type
  type: TerminalMessageType;
  // Optional session ID
  sessionId?: string;
}

// Data message for input/output
// This interface defines the properties of a data message
interface DataTerminalMessage extends BaseTerminalMessage {
  // Message type (either 'input' or 'output')
  type: 'input' | 'output';
  // Terminal data payload
  data: string;
}

// Resize message for terminal window size changes
// This interface defines the properties of a resize message
interface ResizeTerminalMessage extends BaseTerminalMessage {
  // Message type ('resize')
  type: 'resize';
  // Number of columns
  cols: number;
  // Number of rows
  rows: number;
}

// Session message for session management
// This interface defines the properties of a session message
interface SessionTerminalMessage extends BaseTerminalMessage {
  // Message type ('session')
  type: 'session';
  // Terminal session ID
  sessionId: string;
}

// Error message for terminal errors
// This interface defines the properties of an error message
interface ErrorTerminalMessage extends BaseTerminalMessage {
  // Message type ('error')
  type: 'error';
  // Error message
  error: string;
}

// Union type for all terminal messages
// This type defines the possible types of terminal messages
type TerminalMessage = DataTerminalMessage | ResizeTerminalMessage | SessionTerminalMessage | ErrorTerminalMessage;

// Terminal options for spawning terminals
// This interface defines the options for creating a new terminal session
interface TerminalOptions {
  // Shell executable
  shell?: string;
  // Shell arguments
  args?: string[];
  // Environment variables
  env?: { [key: string]: string };
  // Working directory
  cwd?: string;
  // Number of columns
  cols?: number;
  // Number of rows
  rows?: number;
}

// Terminal server configuration options
// This interface defines the options for configuring the terminal server
interface TerminalServerConfig {
  // Shell executable
  shell: string;
  // Shell arguments
  args: string[];
  // Working directory
  cwd: string;
  // Environment variables
  env?: { [key: string]: string };
  // Number of columns
  cols: number;
  // Number of rows
  rows: number;
}

// TerminalServer manages WebSocket connections and terminal sessions
// This class is responsible for handling client connections, spawning terminals, and relaying data
class TerminalServer extends EventEmitter {
  // WebSocket server instance
  private wss: any = null;
  // Server port
  private port: number;
  // Terminal service instance
  private terminalService!: TerminalService;
  // AI service instance
  private aiService: AIService;
  // UI service instance
  private uiService: UIService;
  // Active sessions
  private sessions: Map<string, TerminalSession> = new Map();

  // Constructor for TerminalServer
  // Initializes the terminal server with the given port
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

  // Find an available port, delegating to main process if in renderer
  // This method finds an available port for the terminal server
  async findAvailablePort(startPort: number): Promise<number> {
    if (isRenderer) {
      // Delegate to main process if in renderer
      return safeIpcInvoke('findAvailablePort', startPort);
    }
    // Fallback for test environments
    return startPort;
  }

  // Check if a port is available, delegating to main process if in renderer
  // This method checks if a port is available for the terminal server
  async isPortAvailable(port: number): Promise<boolean> {
    if (isRenderer) {
      // Delegate to main process if in renderer
      return safeIpcInvoke('isPortAvailable', port);
    }
    // Fallback for test environments
    return true;
  }

  // Initialize the terminal server, setting up WebSocket events if in renderer
  // This method initializes the terminal server and sets up WebSocket events
  initialize() {
    console.log('Initializing TerminalServer');
    if (isRenderer) {
      // Initialize WebSocket server in main process
      safeIpcInvoke('initTerminalServer', this.port);
      // Register event handler for terminal data
      if (ipcRenderer) {
        ipcRenderer.on('terminal:data', (event: any, sessionId: string, data: string) => {
          // Handle terminal data from main process
          this.emit('data', { sessionId, data });
        });
      }
    }
  }

  // Send data to terminal (renderer delegates to main process)
  // This method sends data to the terminal
  send(data: string) {
    if (isRenderer) {
      // Delegate to main process if in renderer
      safeIpcInvoke('terminalSend', data);
    }
  }

  // Close the terminal server (renderer delegates to main process)
  // This method closes the terminal server
  close() {
    if (isRenderer) {
      // Delegate to main process if in renderer
      safeIpcInvoke('closeTerminalServer', this.port);
    }
  }

  // Dispose resources
  // This method disposes of the terminal server resources
  dispose() {
    this.close();
  }

  // Get the server port
  // This method returns the server port
  getPort(): number {
    return this.port;
  }
}

export { TerminalServer };