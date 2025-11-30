// index.ts
// Central export file for all type definitions in the project.

/**
 * This file re-exports all type definitions from individual modules,
 * providing a single entry point for type imports throughout the app.
 */

/**
 * Terminal configuration interface.
 * Represents the configuration for a terminal instance.
 */
export interface TerminalConfig {
  /**
   * Unique identifier for the terminal instance.
   */
  id?: string;
  /**
   * Human-readable name for the terminal instance.
   */
  name: string;
  /**
   * Profile configuration for the terminal instance.
   */
  profile: TerminalProfile;
  /**
   * Number of columns for the terminal instance.
   */
  cols: number;
  /**
   * Number of rows for the terminal instance.
   */
  rows: number;
  /**
   * Current working directory for the terminal instance.
   */
  cwd: string;
  /**
   * Environment variables for the terminal instance.
   */
  env: { [key: string]: string };
}

/**
 * Terminal profile interface.
 * Represents a profile configuration for a terminal instance.
 */
export interface TerminalProfile {
  /**
   * Unique identifier for the profile.
   */
  id: string;
  /**
   * Human-readable name for the profile.
   */
  name: string;
  /**
   * Shell executable for the profile.
   */
  shell: string;
  /**
   * Command-line arguments for the shell executable.
   */
  args: string[];
  /**
   * Environment variables for the profile.
   */
  env: { [key: string]: string };
  /**
   * Current working directory for the profile.
   */
  cwd: string;
  /**
   * Icon for the profile.
   */
  icon: string;
  /**
   * Color scheme for the profile.
   */
  color: string;
  /**
   * Custom theme configuration for the profile.
   */
  theme?: CustomTheme;
}

/**
 * Terminal session interface.
 * Represents a terminal session instance.
 */
export interface TerminalSession {
  /**
   * Unique identifier for the session.
   */
  id: string;
  /**
   * HTML element for the terminal session.
   */
  element: HTMLElement;
  /**
   * Flag indicating whether the session is active.
   */
  isActive: boolean;
  /**
   * Configuration for the terminal session.
   */
  config: TerminalConfig;
  /**
   * WebSocket connection for the terminal session.
   */
  ws?: WebSocket;
  /**
   * Profile configuration for the terminal session.
   */
  profile: TerminalProfile;
  /**
   * Number of columns for the terminal session.
   */
  cols: number;
  /**
   * Number of rows for the terminal session.
   */
  rows: number;
  /**
   * Current working directory for the terminal session.
   */
  cwd: string;
  /**
   * Environment variables for the terminal session.
   */
  env: { [key: string]: string };
}

/**
 * Custom theme interface.
 * Represents a custom theme configuration.
 */
export interface CustomTheme {
  /**
   * Background color for the theme.
   */
  background: string;
  /**
   * Foreground color for the theme.
   */
  foreground: string;
  /**
   * Cursor color for the theme.
   */
  cursor: string;
  /**
   * Cursor accent color for the theme.
   */
  cursorAccent: string;
  /**
   * Selection color for the theme.
   */
  selection: string;
  /**
   * Color palette for the theme.
   */
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

/**
 * Position interface.
 * Represents a position in a code file.
 */
export interface Position {
  /**
   * Line number for the position.
   */
  lineNumber: number;
  /**
   * Column number for the position.
   */
  column: number;
}

/**
 * Code context interface.
 * Represents the context for a code file.
 */
export interface CodeContext {
  /**
   * Code content for the file.
   */
  code: string;
  /**
   * Programming language for the file.
   */
  language: string;
  /**
   * Current position in the file.
   */
  position: Position;
  /**
   * Selection range in the file (optional).
   */
  selection?: {
    start: Position;
    end: Position;
  };
  /**
   * File path for the code file.
   */
  filePath: string;
  /**
   * Project root directory for the code file.
   */
  projectRoot: string;
}

/**
 * AI message interface.
 * Represents a message in an AI conversation.
 */
export interface AIMessage {
  /**
   * Role of the message sender (user or assistant).
   */
  role: 'user' | 'assistant';
  /**
   * Content of the message.
   */
  content: string;
  /**
   * Timestamp for the message.
   */
  timestamp: Date;
}

/**
 * AI conversation interface.
 * Represents an AI conversation instance.
 */
export interface AIConversation {
  /**
   * Unique identifier for the conversation.
   */
  id: string;
  /**
   * Messages in the conversation.
   */
  messages: AIMessage[];
  /**
   * Context for the conversation.
   */
  context: {
    /**
     * Import statements for the conversation.
     */
    imports: string[];
    /**
     * Code content for the conversation.
     */
    code: string;
    /**
     * Programming language for the conversation.
     */
    language: string;
    /**
     * File path for the conversation.
     */
    filePath: string;
  };
  /**
   * Timestamp for the conversation.
   */
  timestamp: Date;
}

/**
 * AI response interface.
 * Represents a response from an AI model.
 */
export interface AIResponse {
  /**
   * Text content of the response.
   */
  text: string;
  /**
   * Code content of the response (optional).
   */
  code?: string;
  /**
   * Programming language for the response (optional).
   */
  language?: string;
  /**
   * Explanation for the response (optional).
   */
  explanation?: string;
  /**
   * Confidence level for the response (optional).
   */
  confidence?: number;
  /**
   * Type of response (optional).
   */
  type?: string;
  /**
   * Metadata for the response (optional).
   */
  metadata?: {
    /**
     * Model used to generate the response (optional).
     */
    model?: string;
    /**
     * Timestamp for the response (optional).
     */
    timestamp?: Date;
    /**
     * Context for the response (optional).
     */
    context?: CodeContext;
  };
}

/**
 * Git status interface.
 * Represents the status of a Git repository.
 */
export interface GitStatus {
  /**
   * Current branch for the repository.
   */
  branch: string;
  /**
   * Flag indicating whether the repository has uncommitted changes.
   */
  isDirty: boolean;
  /**
   * Flag indicating whether the repository has untracked files.
   */
  hasUntracked: boolean;
  /**
   * Flag indicating whether the repository has staged changes.
   */
  hasStaged: boolean;
  /**
   * Flag indicating whether the repository has conflicts.
   */
  hasConflicts: boolean;
  /**
   * Number of commits ahead of the remote repository.
   */
  ahead: number;
  /**
   * Number of commits behind the remote repository.
   */
  behind: number;
}