// AITypes.ts
// Type definitions for AI-related data structures and responses.

/**
 * AIResponse defines the structure of a response from the AI service.
 */
export interface AIResponse {
  /**
   * The AI-generated response text.
   */
  text: string;
  /**
   * The confidence level of the AI response.
   */
  confidence: number;
  /**
   * The type of AI response (e.g. completion, explanation, refactoring, etc.).
   */
  type: 'completion' | 'explanation' | 'refactoring' | 'documentation' | 'translation' | 'test' | 'chat';
  /**
   * The timestamp when the response was generated.
   */
  timestamp: Date;
  /**
   * Optional code blocks included in the response.
   */
  codeBlocks?: CodeBlock[];
  /**
   * Optional suggestions for code improvements.
   */
  suggestions?: CodeSuggestion[];
}

/**
 * AIConversation defines the structure of an AI conversation.
 */
export interface AIConversation {
  /**
   * Unique identifier for the conversation.
   */
  id: string;
  /**
   * List of messages in the conversation.
   */
  messages: AIMessage[];
  /**
   * Context for the conversation (e.g. code file, language, etc.).
   */
  context: CodeContext;
  /**
   * Timestamp when the conversation started.
   */
  timestamp: Date;
  /**
   * Optional title for the conversation.
   */
  title?: string;
  /**
   * Optional model used for the conversation.
   */
  model?: string;
}

/**
 * AIMessage defines the structure of a message in an AI conversation.
 */
export interface AIMessage {
  /**
   * Role of the message sender (e.g. user, assistant, system).
   */
  role: 'user' | 'assistant' | 'system';
  /**
   * Content of the message.
   */
  content: string;
  /**
   * Timestamp when the message was sent.
   */
  timestamp: Date;
  /**
   * Optional code blocks included in the message.
   */
  codeBlocks?: CodeBlock[];
}

/**
 * CodeContext provides context for code-related AI operations.
 */
export interface CodeContext {
  /**
   * List of imports in the code file.
   */
  imports: string[];
  /**
   * Content of the code file.
   */
  code: string;
  /**
   * Programming language of the code file.
   */
  language: string;
  /**
   * Path of the code file.
   */
  filePath: string;
  /**
   * Optional selected text in the code file.
   */
  selectedText?: string;
  /**
   * Optional current line in the code file.
   */
  currentLine?: string;
  /**
   * Optional current word in the code file.
   */
  currentWord?: string;
  /**
   * Optional current file in the code file.
   */
  currentFile?: string;
  /**
   * Optional project root directory.
   */
  projectRoot?: string;
  /**
   * Optional Git status of the code file.
   */
  gitStatus?: any;
  /**
   * Optional selection range in the code file.
   */
  selection?: {
    /**
     * Start position of the selection.
     */
    start: number;
    /**
     * End position of the selection.
     */
    end: number;
  };
  /**
   * Optional surrounding code in the code file.
   */
  surroundingCode?: string;
  /**
   * Optional function context in the code file.
   */
  functionContext?: string;
  /**
   * Optional class context in the code file.
   */
  classContext?: string;
  /**
   * Optional file context in the code file.
   */
  fileContext?: string;
}

/**
 * CodeBlock defines the structure of a code block.
 */
export interface CodeBlock {
  /**
   * Programming language of the code block.
   */
  language: string;
  /**
   * Content of the code block.
   */
  code: string;
  /**
   * Optional start line of the code block.
   */
  startLine?: number;
  /**
   * Optional end line of the code block.
   */
  endLine?: number;
  /**
   * Optional file path of the code block.
   */
  filePath?: string;
}

/**
 * CodeSuggestion defines the structure of a code suggestion.
 */
export interface CodeSuggestion {
  /**
   * Text of the code suggestion.
   */
  text: string;
  /**
   * Type of code suggestion (e.g. insert, replace, delete).
   */
  type: 'insert' | 'replace' | 'delete';
  /**
   * Optional start line of the code suggestion.
   */
  startLine?: number;
  /**
   * Optional end line of the code suggestion.
   */
  endLine?: number;
  /**
   * Optional file path of the code suggestion.
   */
  filePath?: string;
  /**
   * Confidence level of the code suggestion.
   */
  confidence: number;
}

/**
 * AIConfig defines the structure of AI configuration options.
 */
export interface AIConfig {
  /**
   * Whether to use a local model.
   */
  useLocalModel: boolean;
  /**
   * Optional path to the local model.
   */
  localModelPath?: string;
  /**
   * Optional OpenAI configuration.
   */
  openAIConfig?: {
    /**
     * API key for OpenAI.
     */
    apiKey: string;
    /**
     * Model to use for OpenAI.
     */
    model: string;
    /**
     * Sampling temperature for OpenAI.
     */
    temperature: number;
    /**
     * Maximum number of tokens for OpenAI.
     */
    maxTokens: number;
  };
  /**
   * Optional local model configuration.
   */
  localModelConfig?: {
    /**
     * Endpoint for the local model.
     */
    endpoint: string;
    /**
     * Optional maximum number of tokens for the local model.
     */
    maxTokens?: number;
    /**
     * Optional sampling temperature for the local model.
     */
    temperature?: number;
  };
  /**
   * Model to use for AI operations.
   */
  model: string;
  /**
   * Sampling temperature for AI operations.
   */
  temperature: number;
  /**
   * Maximum number of tokens for AI operations.
   */
  maxTokens: number;
  /**
   * Context window size for AI operations.
   */
  contextWindow: number;
  /**
   * Stop sequences for AI operations.
   */
  stopSequences: string[];
  /**
   * Optional top P value for AI operations.
   */
  topP?: number;
  /**
   * Optional default model for AI operations.
   */
  defaultModel?: string;
  /**
   * Optional default temperature for AI operations.
   */
  defaultTemperature?: number;
  /**
   * Optional default maximum number of tokens for AI operations.
   */
  defaultMaxTokens?: number;
  /**
   * Optional system prompt for AI operations.
   */
  systemPrompt?: string;
  /**
   * Optional roles for AI operations.
   */
  roles?: {
    /**
     * Name of the role.
     */
    name: string;
    /**
     * Description of the role.
     */
    description: string;
    /**
     * System prompt for the role.
     */
    systemPrompt: string;
  }[];
  /**
   * Optional custom endpoints for AI operations.
   */
  customEndpoints?: {
    /**
     * Name of the endpoint.
     */
    name: string;
    /**
     * URL of the endpoint.
     */
    url: string;
    /**
     * Optional API key for the endpoint.
     */
    apiKey?: string;
    /**
     * Optional headers for the endpoint.
     */
    headers?: Record<string, string>;
  }[];
}

/**
 * AITheme defines the structure of an AI theme.
 */
export interface AITheme {
  /**
   * Name of the theme.
   */
  name: string;
  /**
   * ID of the theme.
   */
  id: string;
  /**
   * Colors used in the theme.
   */
  colors: {
    /**
     * Background color.
     */
    background: string;
    /**
     * Foreground color.
     */
    foreground: string;
    /**
     * Accent color.
     */
    accent: string;
    /**
     * Secondary color.
     */
    secondary: string;
    /**
     * Error color.
     */
    error: string;
    /**
     * Warning color.
     */
    warning: string;
    /**
     * Success color.
     */
    success: string;
    /**
     * Info color.
     */
    info: string;
  };
}

/**
 * AIPrompt defines the structure of an AI prompt.
 */
export interface AIPrompt {
  /**
   * ID of the prompt.
   */
  id: string;
  /**
   * Name of the prompt.
   */
  name: string;
  /**
   * Description of the prompt.
   */
  description: string;
  /**
   * Content of the prompt.
   */
  content: string;
  /**
   * Category of the prompt.
   */
  category: string;
  /**
   * Tags associated with the prompt.
   */
  tags: string[];
}

/**
 * AITokenizer defines the structure of an AI tokenizer.
 */
export interface AITokenizer {
  /**
   * Encodes text into tokens.
   */
  encode: (text: string) => number[];
  /**
   * Decodes tokens into text.
   */
  decode: (tokens: number[]) => string;
  /**
   * Counts the number of tokens in text.
   */
  countTokens: (text: string) => number;
}