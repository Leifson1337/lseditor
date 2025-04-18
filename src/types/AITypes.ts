export interface AIResponse {
  text: string;
  confidence: number;
  type: 'completion' | 'explanation' | 'refactoring' | 'documentation' | 'translation' | 'test' | 'chat';
  timestamp: Date;
  codeBlocks?: CodeBlock[];
  suggestions?: CodeSuggestion[];
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  context: CodeContext;
  timestamp: Date;
  title?: string;
  model?: string;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  codeBlocks?: CodeBlock[];
}

export interface CodeContext {
  imports: string[];
  code: string;
  language: string;
  filePath: string;
  selectedText?: string;
  currentLine?: string;
  currentWord?: string;
  currentFile?: string;
  projectRoot?: string;
  gitStatus?: any;
  selection?: {
    start: number;
    end: number;
  };
  surroundingCode?: string;
  functionContext?: string;
  classContext?: string;
  fileContext?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
  startLine?: number;
  endLine?: number;
  filePath?: string;
}

export interface CodeSuggestion {
  text: string;
  type: 'insert' | 'replace' | 'delete';
  startLine?: number;
  endLine?: number;
  filePath?: string;
  confidence: number;
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
  localModelConfig?: {
    endpoint: string;
    maxTokens?: number;
    temperature?: number;
  };
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
  stopSequences?: string[];
  topP?: number;
  defaultModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  systemPrompt?: string;
  roles?: {
    name: string;
    description: string;
    systemPrompt: string;
  }[];
  customEndpoints?: {
    name: string;
    url: string;
    apiKey?: string;
    headers?: Record<string, string>;
  }[];
}

export interface AITheme {
  name: string;
  id: string;
  colors: {
    background: string;
    foreground: string;
    accent: string;
    secondary: string;
    error: string;
    warning: string;
    success: string;
    info: string;
  };
}

export interface AIPrompt {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
}

export interface AITokenizer {
  encode: (text: string) => number[];
  decode: (tokens: number[]) => string;
  countTokens: (text: string) => number;
} 