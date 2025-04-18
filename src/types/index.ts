export interface TerminalConfig {
  id?: string;
  name: string;
  profile: TerminalProfile;
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string };
}

export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  args: string[];
  env: { [key: string]: string };
  cwd: string;
  icon: string;
  color: string;
  theme?: CustomTheme;
}

export interface TerminalSession {
  id: string;
  element: HTMLElement;
  isActive: boolean;
  config: TerminalConfig;
  ws?: WebSocket;
  profile: TerminalProfile;
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string };
}

export interface CustomTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Position {
  lineNumber: number;
  column: number;
}

export interface CodeContext {
  code: string;
  language: string;
  position: Position;
  selection?: {
    start: Position;
    end: Position;
  };
  filePath: string;
  projectRoot: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  context: {
    imports: string[];
    code: string;
    language: string;
    filePath: string;
  };
  timestamp: Date;
}

export interface AIResponse {
  text: string;
  code?: string;
  language?: string;
  explanation?: string;
  confidence?: number;
  type?: string;
  metadata?: {
    model?: string;
    timestamp?: Date;
    context?: CodeContext;
  };
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  hasUntracked: boolean;
  hasStaged: boolean;
  hasConflicts: boolean;
  ahead: number;
  behind: number;
} 