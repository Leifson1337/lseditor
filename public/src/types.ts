export interface TerminalConfig {
  name?: string;
  shellPath?: string;
  shellArgs?: string[];
  cwd?: string;
  env?: { [key: string]: string };
  strictEnv?: boolean;
  hideFromUser?: boolean;
  message?: string;
  iconPath?: string;
  color?: string;
  isTransient?: boolean;
  theme?: CustomTheme;
  prompt?: string;
}

export interface TerminalSession {
  id: string;
  config: TerminalConfig;
  element: HTMLElement;
  isActive: boolean;
}

export interface TerminalProfile {
  name: string;
  shellPath: string;
  shellArgs: string[];
  env: { [key: string]: string };
  cwd: string;
  iconPath?: string;
  color?: string;
}

export interface CustomTheme {
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
}

export interface AIConfig {
  useLocalModel: boolean;
  localModelPath?: string;
  openAIConfig?: {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
  stopSequences: string[];
  topP: number;
}

export interface AIResponse {
  text: string;
  confidence: number;
  type: 'completion' | 'explanation' | 'refactoring';
  timestamp: Date;
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  context: CodeContext;
  timestamp: Date;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CodeContext {
  filePath: string;
  code: string;
  language: string;
  imports: string[];
  selection?: {
    start: number;
    end: number;
  };
} 