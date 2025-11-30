// CodeContext.ts
// Type definition for code context used in AI operations.

import { GitStatus } from './GitTypes';

/**
 * CodeContext provides context for code-related AI operations.
 */
export interface CodeContext {
  /**
   * The path of the current file.
   */
  currentFile: string;
  /**
   * The currently selected text.
   */
  selectedText: string;
  /**
   * The current line of code.
   */
  currentLine: string;
  /**
   * The current word being edited.
   */
  currentWord: string;
  /**
   * The programming language of the current file.
   */
  language: string;
  /**
   * The root directory of the project.
   */
  projectRoot: string;
  /**
   * The Git status of the project.
   */
  gitStatus: GitStatus;
}