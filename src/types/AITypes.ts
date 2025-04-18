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
} 