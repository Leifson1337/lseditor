import { WebSocket } from 'ws';

export interface TerminalConfig {
  id?: string;
  title?: string;
  cwd?: string;
  profile?: string;
  theme?: string;
  parentId?: string;
  splitDirection?: 'horizontal' | 'vertical';
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface TerminalSession {
  id: string;
  ws?: WebSocket;
  config: TerminalConfig;
  profile: TerminalProfile;
  theme: TerminalTheme;
  status: 'connecting' | 'connected' | 'disconnected';
  createdAt: Date;
  lastActive: Date;
  element: HTMLElement | null;
  isActive: boolean;
}

export interface TerminalProfile {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
  rightClickBehavior?: 'selectWord' | 'paste';
  copyOnSelect?: boolean;
  copyFormat?: string;
  wordSeparator?: string;
  bellStyle?: 'none' | 'sound' | 'visual';
  allowTransparency?: boolean;
  theme?: string;
}

export interface TerminalTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
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

export interface CustomTheme extends TerminalTheme {
  id: string;
  description?: string;
  author?: string;
  version?: string;
} 