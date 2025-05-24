// GitService.ts
// Type definitions for Git service operations and data structures.

import { StatusResult } from 'simple-git';

/**
 * ResourceUsage represents the resource usage of a process.
 */
export interface IGitService extends EventEmitter {
  getStatus(): Promise<GitStatus>;
  refreshStatus(): Promise<GitStatus>;
  getBranches(): Promise<GitBranch[]>;
  refreshBranches(): Promise<GitBranch[]>;
  getRemotes(): GitRemote[];
  refreshRemotes(): Promise<GitRemote[]>;
  getCommits(): GitCommit[];
  refreshCommits(): Promise<GitCommit[]>;
  stage(files: string[]): Promise<void>;
  unstage(files: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  createBranch(name: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  getDiff(filePath: string): Promise<DiffResult>;
  getFileHistory(filePath: string): Promise<GitCommit[]>;
  stash(message?: string): Promise<void>;
  popStash(): Promise<void>;
  getCurrentBranch(): string | null;
  isGitHubRepo(): Promise<boolean>;
  getGitHubRepoInfo(): Promise<{ owner: string; repo: string } | null>;
  createGitHubRepo(name: string, description: string, isPrivate: boolean, token: string): Promise<GitHubRepo | null>;
  linkToGitHubRepo(repoUrl: string): Promise<boolean>;
  getGitHubIssues(token: string): Promise<GitHubIssue[]>;
  createGitHubIssue(title: string, body: string, token: string): Promise<GitHubIssue | null>;
  getGitHubPullRequests(token: string): Promise<GitHubPullRequest[]>;
  createGitHubPullRequest(title: string, body: string, head: string, base: string, token: string): Promise<GitHubPullRequest | null>;
  push(): Promise<void>;
  pull(): Promise<void>;
  fetch(): Promise<void>;
  getStagedDiff(): Promise<string>; // Added this line
  dispose(): void;

  // Event listeners
  on(event: 'initialized', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'statusChanged', listener: (status: GitStatus) => void): this;
  on(event: 'branchesChanged', listener: (branches: GitBranch[]) => void): this;
  on(event: 'remotesChanged', listener: (remotes: GitRemote[]) => void): this;
  on(event: 'commitsChanged', listener: (commits: GitCommit[]) => void): this;
  on(event: 'staged', listener: (files: string[]) => void): this;
  on(event: 'unstaged', listener: (files: string[]) => void): this;
  on(event: 'committed', listener: (message: string) => void): this;
  on(event: 'branchCreated', listener: (name: string) => void): this;
  on(event: 'branchChanged', listener: (name: string) => void): this;
  on(event: 'branchDeleted', listener: (name: string) => void): this;
  on(event: 'stashed', listener: (message?: string) => void): this;
  on(event: 'stashPopped', listener: () => void): this;
  on(event: 'pushed', listener: () => void): this;
  on(event: 'pulled', listener: () => void): this;
  on(event: 'fetched', listener: () => void): this;
}

export interface ResourceUsage {
  /**
   * CPU usage as a percentage.
   */
  cpu: number;
  /**
   * Memory usage statistics.
   */
  memory: {
    /**
     * Heap memory used by the process.
     */
    heapUsed: number;
    /**
     * Total heap memory available to the process.
     */
    heapTotal: number;
    /**
     * External memory used by the process.
     */
    external: number;
  };
  /**
   * Load average of the system.
   */
  loadAverage: number[];
}

/**
 * Re-export of StatusResult from simple-git for convenience.
 */
export { StatusResult };

// Define types used in IGitService (if not already defined elsewhere)
// These are placeholders, actual definitions might be in other files like GitTypes.ts

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
  deleted: string[];
  staged: string[];
  conflicts: string[];
}

export interface GitBranch {
  name: string;
  current: boolean;
  commit: string;
  label: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: Date;
  message: string;
  files: string[];
}

export interface DiffResult {
  files: string[];
  insertions: number;
  deletions: number;
  changed: GitDiffChange[];
  raw: string;
}

export interface GitDiffChange {
  lineNumber: number;
  type: 'added' | 'removed' | 'modified';
  content: string;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string;
  url: string;
  private: boolean;
  owner: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  user: string;
  labels: string[];
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  created_at: string;
  updated_at: string;
  user: string;
  base: string;
  head: string;
}

// Assuming EventEmitter is defined elsewhere, e.g., import { EventEmitter } from '../utils/EventEmitter';
// If not, a basic definition:
declare class EventEmitter {
  on(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  removeAllListeners(event?: string): this;
}