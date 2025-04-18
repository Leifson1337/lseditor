import { GitStatus } from '../services/GitService';

export interface CodeContext {
  selectedText: string;
  currentLine: string;
  currentWord: string;
  currentFile: string;
  language: string;
  projectRoot: string;
  gitStatus: GitStatus;
} 