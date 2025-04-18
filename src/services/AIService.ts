import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import OpenAI from 'openai';
import axios, { AxiosError } from 'axios';
import { AIConfig, AIResponse, AIConversation, AIMessage } from '../types';
import { CodeContext } from '../types/AITypes';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface AIError {
  code: string;
  message: string;
  details?: any;
}

class AIServiceError extends Error implements AIError {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

export interface Selection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export class AIService extends EventEmitter {
  private static instance: AIService;
  private config: AIConfig;
  private conversation: AIConversation = { 
    id: '',
    messages: [],
    context: {
      imports: [],
      code: '',
      language: '',
      filePath: ''
    },
    timestamp: new Date()
  };
  private conversations: Map<string, AIConversation> = new Map();
  private activeConversation: string | null = null;
  private codeContext: Map<string, CodeContext> = new Map();
  private modelCache: Map<string, any> = new Map();
  private openai: OpenAI | null = null;
  private isInitialized: boolean = false;

  private constructor(config: AIConfig) {
    super();
    this.config = config;
  }

  public static getInstance(config: AIConfig): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService(config);
    }
    return AIService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      if (this.config.useLocalModel) {
        await this.loadLocalModel();
      } else if (this.config.openAIConfig?.apiKey) {
        this.openai = new OpenAI({
          apiKey: this.config.openAIConfig.apiKey,
          dangerouslyAllowBrowser: true
        });
      }

      this.isInitialized = true;
    } catch (error) {
      throw new AIServiceError(
        'Failed to initialize AI service',
        'INIT_ERROR',
        error
      );
    }
  }

  private async loadLocalModel(): Promise<void> {
    try {
      // Implementation for loading local model
      // This would depend on your specific local model setup
    } catch (error) {
      throw new AIServiceError(
        'Failed to load local model',
        'MODEL_LOAD_ERROR',
        error
      );
    }
  }

  public async getCodeContext(filePath: string, position?: monaco.Position): Promise<CodeContext> {
    this.checkInitialized();

    try {
      const code = await fs.promises.readFile(filePath, 'utf-8');
      const language = path.extname(filePath).substring(1);
      const imports = this.extractImports(code);
      const projectRoot = path.dirname(filePath);
      const currentLine = position ? code.split('\n')[position.lineNumber - 1] : undefined;
      const currentWord = position ? this.getCurrentWord(code, position) : undefined;
      const selectedText = undefined; // We don't have selection in this context
      const gitStatus = undefined; // We don't have git status in this context

      return {
        imports,
        code,
        language,
        filePath,
        selectedText,
        currentLine,
        currentWord,
        currentFile: filePath,
        projectRoot,
        gitStatus,
        selection: position ? {
          start: position.lineNumber,
          end: position.column
        } : undefined
      };
    } catch (error) {
      throw new AIServiceError(
        'Failed to get code context',
        'CONTEXT_ERROR',
        error
      );
    }
  }

  private getCurrentWord(code: string, position: monaco.Position): string | undefined {
    const lines = code.split('\n');
    const line = lines[position.lineNumber - 1];
    if (!line) return undefined;

    const beforeCursor = line.slice(0, position.column - 1);
    const afterCursor = line.slice(position.column - 1);
    const wordMatch = beforeCursor.match(/\w+$/);
    const afterMatch = afterCursor.match(/^\w+/);

    if (wordMatch && afterMatch) {
      return wordMatch[0] + afterMatch[0];
    } else if (wordMatch) {
      return wordMatch[0];
    } else if (afterMatch) {
      return afterMatch[0];
    }
    return undefined;
  }

  public async getCodeCompletion(filePath: string, position: monaco.Position): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath, position);
    const prompt = this.generateCompletionPrompt(context);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'completion',
      timestamp: new Date()
    };
  }

  public async completeCode(filePath: string, position: monaco.Position): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath, position);
    const prompt = this.generateCompletionPrompt(context);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'completion',
      timestamp: new Date()
    };
  }

  public async explainCode(
    filePath: string,
    selection: monaco.Selection
  ): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath);
    const prompt = this.generateExplanationPrompt(context, {
      start: selection.getStartPosition(),
      end: selection.getEndPosition()
    });
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'explanation',
      timestamp: new Date()
    };
  }

  public async refactorCode(
    filePath: string,
    selection: monaco.Selection,
    refactorType: string
  ): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath);
    const prompt = this.generateRefactorPrompt(context, {
      start: selection.getStartPosition(),
      end: selection.getEndPosition()
    }, refactorType);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'refactoring',
      timestamp: new Date()
    };
  }

  public async generateTests(
    filePath: string,
    testFramework: string = 'jest'
  ): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath);
    const prompt = this.generateTestPrompt(context, testFramework);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'completion',
      timestamp: new Date()
    };
  }

  public async translateCode(
    filePath: string,
    targetLanguage: string
  ): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath);
    const prompt = this.generateTranslationPrompt(context, targetLanguage);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'completion',
      timestamp: new Date()
    };
  }

  public async generateDocumentation(
    filePath: string,
    format: string = 'markdown'
  ): Promise<AIResponse> {
    this.checkInitialized();
    const context = await this.getCodeContext(filePath);
    const prompt = this.generateDocumentationPrompt(context, format);
    const response = await this.queryAI(prompt, context);
    return {
      text: response.text,
      confidence: response.confidence,
      type: 'completion',
      timestamp: new Date()
    };
  }

  public async startConversation(
    initialContext?: CodeContext
  ): Promise<string> {
    this.checkInitialized();
    const conversationId = Date.now().toString();
    const conversation: AIConversation = {
      id: conversationId,
      messages: [],
      context: initialContext || {
        imports: [],
        code: '',
        language: '',
        filePath: ''
      },
      timestamp: new Date()
    };
    this.conversations.set(conversationId, conversation);
    this.activeConversation = conversationId;
    return conversationId;
  }

  public async sendMessage(
    conversationId: string,
    message: string
  ): Promise<AIResponse> {
    this.checkInitialized();
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new AIServiceError(
        'Conversation not found',
        'CONVERSATION_NOT_FOUND'
      );
    }

    const userMessage: AIMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    conversation.messages.push(userMessage);

    const prompt = this.generateConversationPrompt(conversation);
    const response = await this.queryAI(prompt, conversation.context);

    const assistantMessage: AIMessage = {
      role: 'assistant',
      content: response.text,
      timestamp: new Date()
    };
    conversation.messages.push(assistantMessage);

    return response;
  }

  public async endConversation(conversationId: string): Promise<void> {
    this.checkInitialized();
    if (!this.conversations.has(conversationId)) {
      throw new AIServiceError(
        'Conversation not found',
        'CONVERSATION_NOT_FOUND'
      );
    }
    this.conversations.delete(conversationId);
    if (this.activeConversation === conversationId) {
      this.activeConversation = null;
    }
  }

  private extractImports(code: string): string[] {
    const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    return imports;
  }

  private async getDependencies(filePath: string): Promise<string[]> {
    try {
      const packageJsonPath = path.join(path.dirname(filePath), 'package.json');
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
      return Object.keys(packageJson.dependencies || {});
    } catch (error) {
      return [];
    }
  }

  private async getProjectStructure(filePath: string): Promise<string[]> {
    try {
      const rootDir = path.dirname(filePath);
      const structure: string[] = [];
      const files = await fs.promises.readdir(rootDir);
      for (const file of files) {
        structure.push(file);
      }
      return structure;
    } catch (error) {
      return [];
    }
  }

  private generateCompletionPrompt(context: CodeContext): string {
    return `Complete the code at ${context.filePath}${context.selection ? ` at line ${context.selection.start}, column ${context.selection.end}` : ''}`;
  }

  private generateExplanationPrompt(
    context: CodeContext,
    selection: { start: monaco.Position; end: monaco.Position }
  ): string {
    return `Explain the code in ${context.filePath} from line ${selection.start.lineNumber} to line ${selection.end.lineNumber}`;
  }

  private generateRefactorPrompt(
    context: CodeContext,
    selection: { start: monaco.Position; end: monaco.Position },
    refactorType: string
  ): string {
    return `Refactor the code in ${context.filePath} from line ${selection.start.lineNumber} to line ${selection.end.lineNumber} using ${refactorType}`;
  }

  private getOffsetAt(content: string, line: number, column: number): number {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1; i++) {
      offset += lines[i].length + 1;
    }
    return offset + column - 1;
  }

  private generateTestPrompt(
    context: CodeContext,
    testFramework: string
  ): string {
    return `Generate tests for ${context.filePath} using ${testFramework}`;
  }

  private generateTranslationPrompt(
    context: CodeContext,
    targetLanguage: string
  ): string {
    return `Translate the code in ${context.filePath} to ${targetLanguage}`;
  }

  private generateDocumentationPrompt(
    context: CodeContext,
    format: string
  ): string {
    return `Generate documentation for ${context.filePath} in ${format} format`;
  }

  private generateConversationPrompt(conversation: AIConversation): string {
    const messages = conversation.messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    const context = conversation.context ? 
      `Context: ${JSON.stringify(conversation.context)}` : '';
    return `${context}\n\nConversation:\n${messages}`;
  }

  private async queryAI(prompt: string, context: CodeContext): Promise<AIResponse> {
    try {
      if (this.config.useLocalModel) {
        return this.queryLocalModel(prompt, context);
      } else if (this.openai) {
        const response = await this.openai.chat.completions.create({
          model: this.config.model || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1000
        });

        return {
          text: response.choices[0]?.message?.content || '',
          confidence: 1.0,
          type: 'completion',
          timestamp: new Date()
        };
      } else {
        throw new AIServiceError(
          'No AI model available',
          'NO_MODEL'
        );
      }
    } catch (error) {
      return {
        text: '',
        confidence: 0,
        type: 'completion',
        timestamp: new Date()
      };
    }
  }

  private async queryLocalModel(prompt: string, context: CodeContext): Promise<AIResponse> {
    // Implementation for querying local model
    // This would depend on your specific local model setup
    return {
      text: '',
      confidence: 0,
      type: 'completion',
      timestamp: new Date()
    };
  }

  private async callAI(prompt: string): Promise<string> {
    // Implementation for calling AI service
    return '';
  }

  public dispose(): void {
    this.conversations.clear();
    this.codeContext.clear();
    this.modelCache.clear();
    this.openai = null;
    this.isInitialized = false;
  }

  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new AIServiceError(
        'AI service not initialized',
        'NOT_INITIALIZED'
      );
    }
  }
} 