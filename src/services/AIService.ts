import { EventEmitter } from '../utils/EventEmitter';
// Entferne direkte Node.js-Imports
// import * as fs from 'fs';
// import * as path from 'path';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import OpenAI from 'openai';
import axios, { AxiosError } from 'axios';
import { AIConfig, AIResponse, AIConversation, AIMessage, CodeContext, CodeBlock, CodeSuggestion, AIPrompt, AITokenizer } from '../types/AITypes';
import { promisify } from 'util';
import { marked } from 'marked';

// Safe ipcRenderer initialization for Electron renderer process
// ipcRenderer is used for inter-process communication in Electron
let ipcRenderer: any = null;
// Check if running in Electron renderer process (window exists)
const isRenderer = typeof window !== 'undefined';
try {
  if (isRenderer && window && window.electron) {
    ipcRenderer = window.electron.ipcRenderer;
  }
} catch (e) {
  console.error('Failed to initialize ipcRenderer in AIService', e);
}

// Helper function for safe IPC calls
async function safeIpcInvoke(channel: string, ...args: any[]): Promise<any> {
  if (!ipcRenderer) {
    console.error(`IPC channel ${channel} called but ipcRenderer is not available`);
    return null;
  }
  return ipcRenderer.invoke(channel, ...args);
}

// Helper to execute shell commands asynchronously via IPC
export const execAsync = async (command: string) => {
  return safeIpcInvoke('exec', command);
};

// Interface for AI error details
export interface AIError {
  code: string;         // Error code
  message: string;      // Error message
  details?: any;        // Optional additional error details
}

// Custom error class for AIService errors
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

// Interface for editor selection range
export interface Selection {
  startLineNumber: number; // Start line number
  startColumn: number;     // Start column number
  endLineNumber: number;   // End line number
  endColumn: number;       // End column number
}

// AIService provides AI-powered code assistance and chat functionality
export class AIService extends EventEmitter {
  private static instance: AIService;                 // Singleton instance
  private config: AIConfig;                           // AI configuration
  private conversation: AIConversation = {            // Current conversation state
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
  private conversations: Map<string, AIConversation> = new Map(); // All conversations
  private activeConversation: string | null = null;   // Active conversation ID
  private codeContext: Map<string, CodeContext> = new Map();      // Context for code suggestions
  private modelCache: Map<string, any> = new Map();   // Cache for AI models
  private openai: OpenAI | null = null;               // OpenAI API client
  private isInitialized: boolean = false;             // Initialization state
  private tokenizer: AITokenizer | null = null;       // Tokenizer for prompt length
  private prompts: Map<string, AIPrompt> = new Map(); // Custom prompts
  private customEndpoints: Map<string, any> = new Map(); // Custom API endpoints

  // Private constructor to enforce singleton pattern
  private constructor(config: AIConfig) {
    super();
    this.config = config;
    this.loadPrompts();
  }

  // Get the singleton instance of AIService
  public static getInstance(config: AIConfig): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService(config);
    }
    return AIService.instance;
  }

  // Initialize the AI service (loads models, sets up API clients, etc.)
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize local model if configured
      if (this.config.useLocalModel) {
        await this.loadLocalModel();
      } 
      // Initialize OpenAI API client if configured
      else if (this.config.openAIConfig?.apiKey) {
        this.openai = new OpenAI({
          apiKey: this.config.openAIConfig.apiKey,
          dangerouslyAllowBrowser: true
        });
      }

      // Initialize custom endpoints if configured
      if (this.config.customEndpoints) {
        for (const endpoint of this.config.customEndpoints) {
          this.customEndpoints.set(endpoint.name, endpoint);
        }
      }

      // Initialize tokenizer for prompt length optimization
      await this.initializeTokenizer();

      this.isInitialized = true;
    } catch (error) {
      throw new AIServiceError(
        'Failed to initialize AI service',
        'INIT_ERROR',
        error
      );
    }
  }

  // Load local model from configured endpoint
  private async loadLocalModel(): Promise<void> {
    try {
      // Implementation for loading local model
      // This would depend on your specific local model setup
      if (this.config.localModelConfig?.endpoint) {
        // Test the endpoint
        const response = await axios.get(this.config.localModelConfig.endpoint);
        if (response.status !== 200) {
          throw new Error(`Local model endpoint returned status ${response.status}`);
        }
      } else {
        throw new Error('Local model endpoint not configured');
      }
    } catch (error) {
      throw new AIServiceError(
        'Failed to load local model',
        'LOCAL_MODEL_ERROR',
        error
      );
    }
  }

  // Initialize tokenizer for prompt length optimization
  private async initializeTokenizer(): Promise<void> {
    try {
      // Simple tokenizer implementation
      // In a real implementation, you would use a proper tokenizer like tiktoken
      this.tokenizer = {
        encode: (text: string) => {
          // Simple implementation - split by spaces and convert to numbers
          return text.split(/\s+/).map(word => {
            let hash = 0;
            for (let i = 0; i < word.length; i++) {
              hash = ((hash << 5) - hash) + word.charCodeAt(i);
              hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash);
          });
        },
        decode: (tokens: number[]) => {
          // This is a simplified implementation
          // In a real implementation, you would have a vocabulary mapping
          return tokens.map(token => `token_${token}`).join(' ');
        },
        countTokens: (text: string) => {
          // Simple implementation - count words
          return text.split(/\s+/).length;
        }
      };
    } catch (error) {
      console.warn('Failed to initialize tokenizer:', error);
      // Continue without tokenizer
    }
  }

  // Load predefined prompts
  private loadPrompts(): void {
    try {
      const defaultPrompts: AIPrompt[] = [
        {
          id: 'explain-code',
          name: 'Explain Code',
          description: 'Explain the selected code in detail',
          content: 'Please explain the following code in detail, including its purpose, how it works, and any important considerations:',
          category: 'code-analysis',
          tags: ['explain', 'documentation', 'code']
        },
        {
          id: 'refactor-code',
          name: 'Refactor Code',
          description: 'Refactor the selected code to improve readability and maintainability',
          content: 'Please refactor the following code to improve readability, maintainability, and performance:',
          category: 'code-improvement',
          tags: ['refactor', 'improve', 'code']
        },
        {
          id: 'add-comments',
          name: 'Add Comments',
          description: 'Add comprehensive comments to the selected code',
          content: 'Please add comprehensive comments to the following code to explain its functionality:',
          category: 'documentation',
          tags: ['comments', 'documentation', 'code']
        },
        {
          id: 'optimize-code',
          name: 'Optimize Code',
          description: 'Optimize the selected code for better performance',
          content: 'Please optimize the following code for better performance while maintaining readability:',
          category: 'code-improvement',
          tags: ['optimize', 'performance', 'code']
        },
        {
          id: 'generate-tests',
          name: 'Generate Tests',
          description: 'Generate unit tests for the selected code',
          content: 'Please generate comprehensive unit tests for the following code:',
          category: 'testing',
          tags: ['tests', 'unit-tests', 'code']
        }
      ];

      for (const prompt of defaultPrompts) {
        this.prompts.set(prompt.id, prompt);
      }
    } catch (error) {
      console.warn('Failed to load prompts:', error);
    }
  }

  // Get code context for the given file path and position
  public async getCodeContext(filePath: string, position?: monaco.Position): Promise<CodeContext> {
    try {
      // Check if we already have the context cached
      const cachedContext = this.codeContext.get(filePath);
      if (cachedContext) {
        return cachedContext;
      }

      // Read the file content
      const fileContent = await safeIpcInvoke('readFile', filePath);
      
      // Extract imports
      const imports = this.extractImports(fileContent);
      
      // Get the language from the file extension
      const language = await safeIpcInvoke('getFileExtension', filePath).then(extension => extension.substring(1));
      
      // Create the context
      const context: CodeContext = {
        imports,
        code: fileContent,
        language,
        filePath,
        projectRoot: await safeIpcInvoke('getProjectRoot', filePath)
      };
      
      // If position is provided, get the current word and line
      if (position) {
        const lines = fileContent.split('\n');
        const currentLine = lines[position.lineNumber - 1] || '';
        const currentWord = this.getCurrentWord(fileContent, position);
        
        context.currentLine = currentLine;
        context.currentWord = currentWord;
        
        // Get surrounding code (a few lines before and after)
        const startLine = Math.max(0, position.lineNumber - 5);
        const endLine = Math.min(lines.length, position.lineNumber + 5);
        context.surroundingCode = lines.slice(startLine, endLine).join('\n');
      }
      
      // Cache the context
      this.codeContext.set(filePath, context);
      
      return context;
    } catch (error) {
      throw new AIServiceError(
        'Failed to get code context',
        'CONTEXT_ERROR',
        error
      );
    }
  }

  // Get the current word at the given position in the code
  private getCurrentWord(code: string, position: monaco.Position): string | undefined {
    const lines = code.split('\n');
    const line = lines[position.lineNumber - 1] || '';
    
    // Simple word extraction - in a real implementation, you would use a more sophisticated approach
    const words = line.split(/\s+/);
    let currentPos = 0;
    
    for (const word of words) {
      if (currentPos <= position.column && currentPos + word.length >= position.column) {
        return word;
      }
      currentPos += word.length + 1; // +1 for the space
    }
    
    return undefined;
  }

  // Get code completion suggestions for the given file path and position
  public async getCodeCompletion(filePath: string, position: monaco.Position): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath, position);
      const prompt = this.generateCompletionPrompt(context);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to get code completion',
        'COMPLETION_ERROR',
        error
      );
    }
  }

  // Complete code at the given file path and position
  public async completeCode(filePath: string, position: monaco.Position): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath, position);
      const prompt = this.generateCompletionPrompt(context);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to complete code',
        'COMPLETION_ERROR',
        error
      );
    }
  }

  // Explain code at the given file path and selection
  public async explainCode(
    filePath: string,
    selection: monaco.Selection
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath);
      const prompt = this.generateExplanationPrompt(context, {
        start: selection.getStartPosition(),
        end: selection.getEndPosition()
      });
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to explain code',
        'EXPLANATION_ERROR',
        error
      );
    }
  }

  // Refactor code at the given file path and selection
  public async refactorCode(
    filePath: string,
    selection: monaco.Selection,
    refactorType: string
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath);
      const prompt = this.generateRefactorPrompt(context, {
        start: selection.getStartPosition(),
        end: selection.getEndPosition()
      }, refactorType);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to refactor code',
        'REFACTOR_ERROR',
        error
      );
    }
  }

  // Generate tests for the given file path
  public async generateTests(
    filePath: string,
    testFramework: string = 'jest'
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath);
      const prompt = this.generateTestPrompt(context, testFramework);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to generate tests',
        'TEST_ERROR',
        error
      );
    }
  }

  // Translate code at the given file path to the target language
  public async translateCode(
    filePath: string,
    targetLanguage: string
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath);
      const prompt = this.generateTranslationPrompt(context, targetLanguage);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to translate code',
        'TRANSLATION_ERROR',
        error
      );
    }
  }

  // Generate documentation for the given file path
  public async generateDocumentation(
    filePath: string,
    format: string = 'markdown'
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      const context = await this.getCodeContext(filePath);
      const prompt = this.generateDocumentationPrompt(context, format);
      
      return await this.queryAI(prompt, context);
    } catch (error) {
      throw new AIServiceError(
        'Failed to generate documentation',
        'DOCUMENTATION_ERROR',
        error
      );
    }
  }

  // Start a new conversation with the given initial context and model
  public async startConversation(
    initialContext?: CodeContext,
    model?: string,
    role?: string
  ): Promise<string> {
    try {
      this.checkInitialized();
      
      const conversationId = Math.random().toString(36).substring(2, 15);
      
      // Create a new conversation
      const conversation: AIConversation = {
        id: conversationId,
        messages: [],
        context: initialContext || {
          imports: [],
          code: '',
          language: '',
          filePath: ''
        },
        timestamp: new Date(),
        model: model || this.config.defaultModel
      };
      
      // Add system message if role is provided
      if (role) {
        const roleConfig = this.config.roles?.find(r => r.name === role);
        if (roleConfig) {
          conversation.messages.push({
            role: 'system',
            content: roleConfig.systemPrompt,
            timestamp: new Date()
          });
        }
      } else if (this.config.systemPrompt) {
        conversation.messages.push({
          role: 'system',
          content: this.config.systemPrompt,
          timestamp: new Date()
        });
      }
      
      // Store the conversation
      this.conversations.set(conversationId, conversation);
      this.activeConversation = conversationId;
      
      return conversationId;
    } catch (error) {
      throw new AIServiceError(
        'Failed to start conversation',
        'CONVERSATION_ERROR',
        error
      );
    }
  }

  // Send a message in the given conversation
  public async sendMessage(
    conversationId: string,
    message: string
  ): Promise<AIResponse> {
    try {
      this.checkInitialized();
      
      // Get the conversation
      const conversation = this.conversations.get(conversationId);
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }
      
      // Add the user message
      const userMessage: AIMessage = {
        role: 'user',
        content: message,
        timestamp: new Date()
      };
      
      conversation.messages.push(userMessage);
      
      // Generate the prompt
      const prompt = this.generateConversationPrompt(conversation);
      
      // Query the AI
      const response = await this.queryAI(prompt, conversation.context);
      
      // Add the assistant message
      const assistantMessage: AIMessage = {
        role: 'assistant',
        content: response.text,
        timestamp: new Date(),
        codeBlocks: response.codeBlocks
      };
      
      conversation.messages.push(assistantMessage);
      
      return response;
    } catch (error) {
      throw new AIServiceError(
        'Failed to send message',
        'MESSAGE_ERROR',
        error
      );
    }
  }

  // End the given conversation
  public async endConversation(conversationId: string): Promise<void> {
    try {
      // Remove the conversation
      this.conversations.delete(conversationId);
      
      // If this was the active conversation, clear it
      if (this.activeConversation === conversationId) {
        this.activeConversation = null;
      }
    } catch (error) {
      throw new AIServiceError(
        'Failed to end conversation',
        'CONVERSATION_ERROR',
        error
      );
    }
  }

  // Extract imports from the given code
  private extractImports(code: string): string[] {
    // Simple import extraction - in a real implementation, you would use a parser
    const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
      imports.push(match[1]);
    }
    
    return imports;
  }

  // Get dependencies for the given file path
  private async getDependencies(filePath: string): Promise<string[]> {
    try {
      // Read package.json if it exists
      const packageJsonPath = await safeIpcInvoke('getPackageJsonPath', filePath);
      if (packageJsonPath) {
        const packageJson = await safeIpcInvoke('readJsonFile', packageJsonPath);
        return Object.keys(packageJson.dependencies || {});
      }
      
      return [];
    } catch (error) {
      console.warn('Failed to get dependencies:', error);
      return [];
    }
  }

  // Get project structure for the given file path
  private async getProjectStructure(filePath: string): Promise<string[]> {
    try {
      // Get the project root
      const projectRoot = await safeIpcInvoke('getProjectRoot', filePath);
      
      // Get all files in the project
      const files = await safeIpcInvoke('getAllFiles', projectRoot);
      
      // Return relative paths
      return Promise.all(files.map(async (file: string) => {
        return safeIpcInvoke('getRelativePath', projectRoot, file);
      }));
    } catch (error) {
      console.warn('Failed to get project structure:', error);
      return [];
    }
  }

  // Get all files in the given directory
  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    const entries = await safeIpcInvoke('readDir', dir);
    
    for (const entry of entries) {
      const fullPath = await safeIpcInvoke('joinPath', dir, entry.name);
      
      if (entry.isDirectory) {
        // Skip node_modules and .git
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        
        const subFiles = await this.getAllFiles(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  // Generate completion prompt for the given context
  private generateCompletionPrompt(context: CodeContext): string {
    return `Complete the following code in ${context.language}:\n\n${context.code}\n\nProvide only the code completion, no explanations.`;
  }

  // Generate explanation prompt for the given context and selection
  private generateExplanationPrompt(
    context: CodeContext,
    selection: { start: monaco.Position; end: monaco.Position }
  ): string {
    const startOffset = this.getOffsetAt(context.code, selection.start.lineNumber, selection.start.column);
    const endOffset = this.getOffsetAt(context.code, selection.end.lineNumber, selection.end.column);
    const selectedCode = context.code.substring(startOffset, endOffset);
    
    return `Explain the following code in detail:\n\n\`\`\`${context.language}\n${selectedCode}\n\`\`\`\n\nProvide a comprehensive explanation of what this code does, how it works, and any important considerations.`;
  }

  // Generate refactor prompt for the given context, selection, and refactor type
  private generateRefactorPrompt(
    context: CodeContext,
    selection: { start: monaco.Position; end: monaco.Position },
    refactorType: string
  ): string {
    const startOffset = this.getOffsetAt(context.code, selection.start.lineNumber, selection.start.column);
    const endOffset = this.getOffsetAt(context.code, selection.end.lineNumber, selection.end.column);
    const selectedCode = context.code.substring(startOffset, endOffset);
    
    return `Refactor the following code to ${refactorType}:\n\n\`\`\`${context.language}\n${selectedCode}\n\`\`\`\n\nProvide the refactored code with explanations of the changes made.`;
  }

  // Get offset at the given line and column in the code
  private getOffsetAt(content: string, line: number, column: number): number {
    const lines = content.split('\n');
    let offset = 0;
    
    for (let i = 0; i < line - 1; i++) {
      offset += lines[i].length + 1; // +1 for the newline
    }
    
    offset += column - 1;
    
    return offset;
  }

  // Generate test prompt for the given context and test framework
  private generateTestPrompt(
    context: CodeContext,
    testFramework: string
  ): string {
    return `Generate comprehensive unit tests for the following code using ${testFramework}:\n\n\`\`\`${context.language}\n${context.code}\n\`\`\`\n\nProvide the test code with explanations of what each test covers.`;
  }

  // Generate translation prompt for the given context and target language
  private generateTranslationPrompt(
    context: CodeContext,
    targetLanguage: string
  ): string {
    return `Translate the following code from ${context.language} to ${targetLanguage}:\n\n\`\`\`${context.language}\n${context.code}\n\`\`\`\n\nProvide the translated code with explanations of any language-specific considerations.`;
  }

  // Generate documentation prompt for the given context and format
  private generateDocumentationPrompt(
    context: CodeContext,
    format: string
  ): string {
    return `Generate comprehensive documentation for the following code in ${format} format:\n\n\`\`\`${context.language}\n${context.code}\n\`\`\`\n\nInclude function descriptions, parameters, return values, and examples.`;
  }

  // Generate conversation prompt for the given conversation
  private generateConversationPrompt(conversation: AIConversation): string {
    // In a real implementation, you would format the conversation history
    // For simplicity, we'll just return the last message
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    return lastMessage.content;
  }

  // Query the AI with the given prompt and context
  private async queryAI(prompt: string, context: CodeContext): Promise<AIResponse> {
    try {
      // Optimize the prompt using the tokenizer if available
      if (this.tokenizer) {
        const tokenCount = this.tokenizer.countTokens(prompt);
        if (tokenCount > (this.config.defaultMaxTokens || 2048)) {
          // Truncate the prompt if it's too long
          prompt = this.truncatePrompt(prompt, this.config.defaultMaxTokens || 2048);
        }
      }
      
      // Determine which endpoint to use
      if (this.config.useLocalModel) {
        return await this.queryLocalModel(prompt, context);
      } else if (this.openai) {
        return await this.queryOpenAI(prompt, context);
      } else if (this.config.customEndpoints && this.config.customEndpoints.length > 0) {
        return await this.queryCustomEndpoint(prompt, context);
      } else {
        throw new Error('No AI endpoint configured');
      }
    } catch (error) {
      throw new AIServiceError(
        'Failed to query AI',
        'QUERY_ERROR',
        error
      );
    }
  }

  // Truncate the prompt to the given length
  private truncatePrompt(prompt: string, maxTokens: number): string {
    if (!this.tokenizer) {
      // Simple truncation if no tokenizer is available
      return prompt.substring(0, maxTokens * 4); // Rough estimate: 4 chars per token
    }
    
    const tokens = this.tokenizer.encode(prompt);
    if (tokens.length <= maxTokens) {
      return prompt;
    }
    
    // Truncate to maxTokens
    const truncatedTokens = tokens.slice(0, maxTokens);
    return this.tokenizer.decode(truncatedTokens);
  }

  // Query the local model with the given prompt and context
  private async queryLocalModel(prompt: string, context: CodeContext): Promise<AIResponse> {
    try {
      if (!this.config.localModelConfig?.endpoint) {
        throw new Error('Local model endpoint not configured');
      }
      
      const response = await axios.post(this.config.localModelConfig.endpoint, {
        prompt,
        max_tokens: this.config.localModelConfig.maxTokens || this.config.defaultMaxTokens || 2048,
        temperature: this.config.localModelConfig.temperature || this.config.defaultTemperature || 0.7,
        model: this.config.model || 'gpt-3.5-turbo'
      });
      
      return this.parseAIResponse(response.data);
    } catch (error) {
      throw new AIServiceError(
        'Failed to query local model',
        'LOCAL_MODEL_ERROR',
        error
      );
    }
  }

  // Query OpenAI with the given prompt and context
  private async queryOpenAI(prompt: string, context: CodeContext): Promise<AIResponse> {
    try {
      if (!this.openai) {
        throw new Error('OpenAI client not initialized');
      }
      
      const model = this.config.openAIConfig?.model || this.config.model || 'gpt-3.5-turbo';
      
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: this.config.openAIConfig?.temperature || this.config.temperature || 0.7,
        max_tokens: this.config.openAIConfig?.maxTokens || this.config.maxTokens || 2048
      });
      
      return this.parseOpenAIResponse(response);
    } catch (error) {
      throw new AIServiceError(
        'Failed to query OpenAI',
        'OPENAI_ERROR',
        error
      );
    }
  }

  // Query the custom endpoint with the given prompt and context
  private async queryCustomEndpoint(prompt: string, context: CodeContext): Promise<AIResponse> {
    try {
      if (!this.config.customEndpoints || this.config.customEndpoints.length === 0) {
        throw new Error('No custom endpoints configured');
      }
      
      // Use the first custom endpoint
      const endpoint = this.config.customEndpoints[0];
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...endpoint.headers
      };
      
      if (endpoint.apiKey) {
        headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
      }
      
      const response = await axios.post(endpoint.url, {
        prompt,
        max_tokens: this.config.defaultMaxTokens,
        temperature: this.config.defaultTemperature,
        model: this.config.defaultModel
      }, { headers });
      
      return this.parseAIResponse(response.data);
    } catch (error) {
      throw new AIServiceError(
        'Failed to query custom endpoint',
        'CUSTOM_ENDPOINT_ERROR',
        error
      );
    }
  }

  // Parse OpenAI response
  private parseOpenAIResponse(response: any): AIResponse {
    const content = response.choices[0].message.content;
    const codeBlocks = this.extractCodeBlocks(content);
    
    return {
      text: content,
      confidence: 0.9, // OpenAI doesn't provide confidence scores
      type: 'chat',
      timestamp: new Date(),
      codeBlocks
    };
  }

  // Parse AI response
  private parseAIResponse(response: any): AIResponse {
    // This is a generic parser that should work with most OpenAI-compatible APIs
    const content = response.choices?.[0]?.message?.content || response.text || response.content || '';
    const codeBlocks = this.extractCodeBlocks(content);
    
    return {
      text: content,
      confidence: response.confidence || 0.9,
      type: 'chat',
      timestamp: new Date(),
      codeBlocks
    };
  }

  // Extract code blocks from the given content
  private extractCodeBlocks(content: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'plaintext';
      const code = match[2].trim();
      
      codeBlocks.push({
        language,
        code
      });
    }
    
    return codeBlocks;
  }

  // Get all prompts
  public getPrompts(): AIPrompt[] {
    return Array.from(this.prompts.values());
  }

  // Add a prompt
  public addPrompt(prompt: AIPrompt): void {
    this.prompts.set(prompt.id, prompt);
  }

  // Remove a prompt
  public removePrompt(promptId: string): void {
    this.prompts.delete(promptId);
  }

  // Get a prompt by ID
  public getPrompt(promptId: string): AIPrompt | undefined {
    return this.prompts.get(promptId);
  }

  // Get all conversations
  public getConversations(): AIConversation[] {
    return Array.from(this.conversations.values());
  }

  // Get the active conversation ID
  public getActiveConversation(): string | null {
    return this.activeConversation;
  }

  // Set the active conversation ID
  public setActiveConversation(conversationId: string): void {
    if (this.conversations.has(conversationId)) {
      this.activeConversation = conversationId;
    }
  }

  // Dispose of the AI service
  public dispose(): void {
    // Clean up resources
    this.conversations.clear();
    this.codeContext.clear();
    this.modelCache.clear();
    this.openai = null;
    this.isInitialized = false;
  }

  // Check if the AI service is initialized
  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new AIServiceError(
        'AI service not initialized',
        'NOT_INITIALIZED',
        null
      );
    }
  }
} 