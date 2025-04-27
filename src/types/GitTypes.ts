// GitTypes.ts
// Type definitions for Git-related data structures and operations.

/**
 * GitBranch represents a branch in a Git repository.
 */
export interface GitBranch {
  /**
   * Name of the branch
   */
  name: string;
  /**
   * Whether this is the currently checked-out branch
   */
  current: boolean;
  /**
   * Commit hash of the branch
   */
  commit: string;
  /**
   * Label for the branch
   */
  label: string;
}

/**
 * GitRemote represents a remote in a Git repository.
 */
export interface GitRemote {
  /**
   * Name of the remote (e.g., 'origin')
   */
  name: string;
  /**
   * URL of the remote repository
   */
  url: string;
}

/**
 * GitCommit represents a commit in a Git repository.
 */
export interface GitCommit {
  /**
   * Commit hash
   */
  hash: string;
  /**
   * Author of the commit
   */
  author: string;
  /**
   * Date of the commit
   */
  date: Date;
  /**
   * Commit message
   */
  message: string;
  /**
   * Files affected by the commit
   */
  files: string[];
}

/**
 * GitDiff represents a diff between two commits or files in a Git repository.
 */
export interface GitDiff {
  /**
   * Path of the file in the diff
   */
  filePath: string;
  /**
   * Changes in the diff
   */
  changes: GitDiffChange[];
}

/**
 * GitDiffChange represents a single change in a Git diff.
 */
export interface GitDiffChange {
  /**
   * Line number of the change
   */
  lineNumber: number;
  /**
   * Type of change (added, removed, or modified)
   */
  type: 'added' | 'removed' | 'modified';
  /**
   * Content of the change
   */
  content: string;
}

/**
 * GitStatus represents the status of a Git repository.
 */
export interface GitStatus {
  /**
   * Current branch or commit hash
   */
  current: string;
  /**
   * Files staged for the next commit
   */
  staged: string[];
  /**
   * Files not added to the repository
   */
  not_added: string[];
  /**
   * Files modified but not staged
   */
  modified: string[];
  /**
   * Files deleted but not staged
   */
  deleted: string[];
  /**
   * Files renamed but not staged
   */
  renamed: string[];
  /**
   * Untracked files in the repository
   */
  untracked: string[];
}