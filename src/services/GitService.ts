import { simpleGit, SimpleGit, StatusResult, DiffResult as GitDiffResult, GitError } from 'simple-git';
import { EventEmitter } from '../utils/EventEmitter';
import * as path from 'path';
import * as monaco from 'monaco-editor';
import { GitBranch, GitCommit, GitDiff } from '../types/GitTypes';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { exec, ExecException } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { execAsync } from './AIService';

// ExecResult represents the result of executing a shell command
interface ExecResult {
  stdout: string;                // Standard output from the command
  stderr: string;                // Standard error from the command
}

// ExecAsyncResult is a promise that resolves to an ExecResult
// (used for async shell command execution)
type ExecAsyncResult = Promise<ExecResult>;

// GitRemote represents a remote repository configuration
interface GitRemote {
  name: string;                  // Name of the remote (e.g., 'origin')
  url: string;                   // URL of the remote repository
}

// GitDiffChange represents a single line change in a diff
interface GitDiffChange {
  lineNumber: number;            // Line number of the change
  type: 'added' | 'removed' | 'modified'; // Type of change
  content: string;               // Content of the changed line
}

// DiffResult represents the result of a git diff operation
export interface DiffResult {
  files: string[];               // List of changed files
  insertions: number;            // Number of lines inserted
  deletions: number;             // Number of lines deleted
  changed: GitDiffChange[];      // List of line changes
  raw: string;                   // Raw diff output
}

// GitStatus represents the current status of the git repository
export interface GitStatus {
  branch: string;                // Current branch name
  ahead: number;                 // Number of commits ahead of remote
  behind: number;                // Number of commits behind remote
  modified: string[];            // Modified files
  untracked: string[];           // Untracked files
  deleted: string[];             // Deleted files
  staged: string[];              // Staged files
  conflicts: string[];           // Files with merge conflicts
}

// LocalGitBranch represents a local git branch
export interface LocalGitBranch {
  name: string;                  // Branch name
  current: boolean;              // Whether this is the current branch
  remote: boolean;               // Whether this branch tracks a remote
  ahead: number;                 // Commits ahead of remote
  behind: number;                // Commits behind remote
}

// GitHubRepo represents a GitHub repository
export interface GitHubRepo {
  name: string;                  // Repository name
  fullName: string;              // Full repository name (owner/name)
  description: string;           // Repository description
  url: string;                   // Repository URL
  private: boolean;              // Whether the repository is private
  owner: string;                 // Owner of the repository
}

// GitHubIssue represents an issue in a GitHub repository
export interface GitHubIssue {
  id: number;                    // Unique issue ID
  number: number;                // Issue number
  title: string;                 // Issue title
  body: string;                  // Issue body/content
  state: 'open' | 'closed';      // Issue state
  created_at: string;            // Creation date
  updated_at: string;            // Last update date
  user: string;                  // User who created the issue
  labels: string[];              // Labels for the issue
}

// GitHubPullRequest represents a pull request in a GitHub repository
export interface GitHubPullRequest {
  id: number;                    // Unique pull request ID
  number: number;                // Pull request number
  title: string;                 // Pull request title
  body: string;                  // Pull request body/content
  state: 'open' | 'closed' | 'merged'; // Pull request state
  created_at: string;            // Creation date
  updated_at: string;            // Last update date
  user: string;                  // User who created the pull request
  base: string;                  // Base branch
  head: string;                  // Head branch
}

// GitService manages git operations, repository state, and integration with the editor
export class GitService extends EventEmitter {
  private static instance: GitService;                   // Singleton instance
  private git: SimpleGit;                                // SimpleGit instance for git operations
  private status: GitStatus;                             // Current git status
  private branches: GitBranch[] = [];                    // List of branches
  private remotes: GitRemote[] = [];                     // List of remotes
  private commits: GitCommit[] = [];                     // List of commits
  private currentBranch: string | null = null;           // Current branch name
  private isInitialized: boolean = false;                // Whether the service is initialized
  private workspacePath: string;                         // Path to the workspace
  private diffs: Map<string, GitDiff> = new Map();       // Map of file diffs
  private isGitRepo: boolean;                            // Whether the workspace is a git repository

  /**
   * Constructor for the GitService class.
   * Initializes the service with the given workspace path.
   * @param workspacePath Path to the workspace
   */
  public constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.isGitRepo = this.checkIfGitRepo();
    this.git = simpleGit(workspacePath);
    this.status = {
      branch: '',
      ahead: 0,
      behind: 0,
      modified: [],
      untracked: [],
      deleted: [],
      staged: [],
      conflicts: []
    };
    this.initialize().catch(error => {
      console.error('Failed to initialize Git service:', error);
      this.emit('error', error);
    });
  }

  /**
   * Gets the singleton instance of the GitService class.
   * @param workspacePath Path to the workspace
   * @returns The singleton instance of the GitService class
   */
  public static getInstance(workspacePath: string): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService(workspacePath);
    }
    return GitService.instance;
  }

  /**
   * Checks if the given directory is a git repository.
   * @returns Whether the directory is a git repository
   */
  private checkIfGitRepo(): boolean {
    try {
      const gitDir = path.join(this.workspacePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('Error checking if directory is a git repository:', error);
      return false;
    }
  }

  /**
   * Initializes the GitService instance.
   * Refreshes the branches, remotes, and commits.
   * @returns A promise that resolves when the initialization is complete
   */
  private async initialize(): Promise<void> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        throw new Error('Not a git repository');
      }

      await this.refreshBranches();
      await this.refreshRemotes();
      await this.refreshCommits();
      
      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      if (error instanceof GitError) {
        console.error('Git error during initialization:', error.message);
        this.emit('error', error);
      } else {
        console.error('Failed to initialize Git service:', error);
        this.emit('error', error);
      }
      throw error;
    }
  }

  /**
   * Checks if the GitService instance is initialized.
   * Throws an error if the instance is not initialized.
   */
  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Git service not initialized');
    }
  }

  /**
   * Gets the current git status.
   * @returns A promise that resolves with the current git status
   */
  public async getStatus(): Promise<GitStatus> {
    if (!this.isGitRepo) {
      return {
        branch: '',
        ahead: 0,
        behind: 0,
        modified: [],
        untracked: [],
        deleted: [],
        staged: [],
        conflicts: []
      };
    }
    try {
      const result = await execAsync('git status --porcelain');
      const changes: string[] = [];
      const untracked: string[] = [];
      const staged: string[] = [];
      const conflicts: string[] = [];

      const statusLines = result.stdout.split('\n');
      statusLines.forEach((line: string) => {
        if (line.trim()) {
          const status = line.substring(0, 2);
          const file = line.substring(3).trim();
          
          if (status.includes('U') || status.includes('A')) {
            conflicts.push(file);
          } else if (status.includes('M') || status.includes('D')) {
            if (status.startsWith(' ')) {
              changes.push(file);
            } else {
              staged.push(file);
            }
          } else if (status.includes('??')) {
            untracked.push(file);
          }
        }
      });

      const branchResult = await execAsync('git rev-parse --abbrev-ref HEAD');
      const branch = branchResult.stdout.trim();

      return {
        branch,
        ahead: 0,
        behind: 0,
        modified: changes,
        untracked,
        deleted: [],
        staged,
        conflicts
      };
    } catch (error) {
      console.error('Error getting git status:', error);
      return {
        branch: '',
        ahead: 0,
        behind: 0,
        modified: [],
        untracked: [],
        deleted: [],
        staged: [],
        conflicts: []
      };
    }
  }

  /**
   * Refreshes the current git status.
   * @returns A promise that resolves with the refreshed git status
   */
  public async refreshStatus(): Promise<GitStatus> {
    return this.getStatus();
  }

  /**
   * Refreshes the list of branches.
   * @returns A promise that resolves with the list of branches
   */
  public async refreshBranches(): Promise<GitBranch[]> {
    this.checkInitialized();
    try {
      const result = await execAsync('git branch -vv');
      const branchLines = result.stdout.split('\n').filter((line: string) => line.trim());
      
      this.branches = branchLines.map((line: string) => {
        const isCurrent = line.startsWith('*');
        const name = line.slice(2).split(' ')[0];
        const commit = line.split(' ').find((part: string) => part.length === 40) || '';
        const label = line.includes('[') ? line.split('[')[1].split(']')[0] : '';
        
        return {
          name,
          current: isCurrent,
          commit,
          label
        };
      });
      
      this.emit('branchesChanged', this.branches);
      return this.branches;
    } catch (error) {
      console.error('Failed to refresh branches:', error);
      throw error;
    }
  }

  /**
   * Gets the list of branches.
   * @returns A promise that resolves with the list of branches
   */
  public async getBranches(): Promise<GitBranch[]> {
    if (!this.isGitRepo) {
      return [];
    }
    try {
      const result = await execAsync('git branch -a');
      const branchLines = result.stdout.split('\n');
      return branchLines
        .filter((line: string) => line.trim())
        .map((line: string) => {
          const isCurrent = line.startsWith('*');
          const name = line.replace(/^\*\s*/, '').trim();
          const commit = ''; // We'll need to get this from git log if needed
          const label = line.includes('[') ? line.split('[')[1].split(']')[0] : '';
          
          return {
            name,
            current: isCurrent,
            commit,
            label
          };
        });
    } catch (error) {
      console.error('Error getting git branches:', error);
      return [];
    }
  }

  /**
   * Refreshes the list of remotes.
   * @returns A promise that resolves with the list of remotes
   */
  public async refreshRemotes(): Promise<GitRemote[]> {
    this.checkInitialized();
    try {
      const remoteList = await this.git.getRemotes(true);
      this.remotes = remoteList.map(remote => ({
        name: remote.name,
        url: remote.refs.fetch || remote.refs.push || ''
      }));
      this.emit('remotesChanged', this.remotes);
      return this.remotes;
    } catch (error) {
      if (error instanceof GitError) {
        console.error('Git error while refreshing remotes:', error.message);
        this.emit('error', error);
      } else {
        console.error('Failed to refresh remotes:', error);
        this.emit('error', error);
      }
      throw error;
    }
  }

  /**
   * Refreshes the list of commits.
   * @returns A promise that resolves with the list of commits
   */
  public async refreshCommits(): Promise<GitCommit[]> {
    this.checkInitialized();
    try {
      const log = await this.git.log();
      this.commits = log.all.map(commit => ({
        hash: commit.hash,
        author: commit.author_name,
        date: new Date(commit.date),
        message: commit.message,
        files: []
      }));
      this.emit('commitsChanged', this.commits);
      return this.commits;
    } catch (error) {
      if (error instanceof GitError) {
        console.error('Git error while refreshing commits:', error.message);
        this.emit('error', error);
      } else {
        console.error('Failed to refresh commits:', error);
        this.emit('error', error);
      }
      throw error;
    }
  }

  /**
   * Stages the given files.
   * @param files List of files to stage
   * @returns A promise that resolves when the files are staged
   */
  public async stage(files: string[]): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.add(files);
      await this.getStatus();
      this.emit('staged', files);
    } catch (error) {
      console.error('Failed to stage files:', error);
      throw error;
    }
  }

  /**
   * Unstages the given files.
   * @param files List of files to unstage
   * @returns A promise that resolves when the files are unstaged
   */
  public async unstage(files: string[]): Promise<void> {
    this.checkInitialized();
    try {
      // Fix the reset method call
      await this.git.reset(['--', ...files]);
      await this.getStatus();
      this.emit('unstaged', files);
    } catch (error) {
      console.error('Failed to unstage files:', error);
      throw error;
    }
  }

  /**
   * Commits the given message.
   * @param message Commit message
   * @returns A promise that resolves when the commit is complete
   */
  public async commit(message: string): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.commit(message);
      await this.refreshStatus();
      this.emit('committed', message);
    } catch (error) {
      console.error('Failed to commit:', error);
      throw error;
    }
  }

  /**
   * Creates a new branch with the given name.
   * @param name Name of the new branch
   * @returns A promise that resolves when the branch is created
   */
  public async createBranch(name: string): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.checkoutLocalBranch(name);
      await this.refreshBranches();
      this.emit('branchCreated', name);
    } catch (error) {
      console.error(`Failed to create branch ${name}:`, error);
      throw error;
    }
  }

  /**
   * Checks out the given branch.
   * @param branch Name of the branch to check out
   * @returns A promise that resolves when the branch is checked out
   */
  public async checkout(branch: string): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.checkout(branch);
      await this.refreshBranches();
      await this.getStatus();
      this.emit('branchChanged', branch);
    } catch (error) {
      console.error(`Failed to checkout branch ${branch}:`, error);
      throw error;
    }
  }

  /**
   * Gets the diff for the given file.
   * @param filePath Path to the file
   * @returns A promise that resolves with the diff result
   */
  public async getDiff(filePath: string): Promise<DiffResult> {
    this.checkInitialized();
    try {
      const diff = await this.git.diff([filePath]);
      const changes: GitDiffChange[] = [];
      let insertions = 0;
      let deletions = 0;

      diff.split('\n').forEach((line, index) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          changes.push({
            lineNumber: index + 1,
            type: 'added',
            content: line.substring(1)
          });
          insertions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          changes.push({
            lineNumber: index + 1,
            type: 'removed',
            content: line.substring(1)
          });
          deletions++;
        } else if (line.startsWith(' ')) {
          changes.push({
            lineNumber: index + 1,
            type: 'modified',
            content: line.substring(1)
          });
        }
      });

      return {
        files: [filePath],
        insertions,
        deletions,
        changed: changes,
        raw: diff
      };
    } catch (error) {
      console.error('Failed to get diff:', error);
      throw error;
    }
  }

  /**
   * Gets the file history for the given file.
   * @param filePath Path to the file
   * @returns A promise that resolves with the file history
   */
  public async getFileHistory(filePath: string): Promise<GitCommit[]> {
    this.checkInitialized();
    try {
      const log = await this.git.log(['--', filePath]);
      return log.all.map(commit => ({
        hash: commit.hash,
        author: commit.author_name,
        date: new Date(commit.date),
        message: commit.message,
        files: [filePath]
      }));
    } catch (error) {
      console.error('Failed to get file history:', error);
      throw error;
    }
  }

  /**
   * Stashes the current changes.
   * @param message Optional stash message
   * @returns A promise that resolves when the stash is complete
   */
  public async stash(message?: string): Promise<void> {
    this.checkInitialized();
    try {
      if (message) {
        await this.git.stash(['save', message]);
      } else {
        await this.git.stash(['save']);
      }
      await this.getStatus();
      this.emit('stashed', message);
    } catch (error) {
      console.error('Failed to stash:', error);
      throw error;
    }
  }

  /**
   * Pops the latest stash.
   * @returns A promise that resolves when the stash is popped
   */
  public async popStash(): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.stash(['pop']);
      await this.getStatus();
      this.emit('stashPopped');
    } catch (error) {
      console.error('Failed to pop stash:', error);
      throw error;
    }
  }

  /**
   * Gets the list of remotes.
   * @returns The list of remotes
   */
  public getRemotes(): GitRemote[] {
    return [...this.remotes];
  }

  /**
   * Gets the list of commits.
   * @returns The list of commits
   */
  public getCommits(): GitCommit[] {
    return [...this.commits];
  }

  /**
   * Deletes the given branch.
   * @param name Name of the branch to delete
   * @returns A promise that resolves when the branch is deleted
   */
  public async deleteBranch(name: string): Promise<void> {
    this.checkInitialized();
    try {
      await this.git.deleteLocalBranch(name);
      await this.refreshBranches();
      this.emit('branchDeleted', name);
    } catch (error) {
      console.error(`Failed to delete branch ${name}:`, error);
      throw error;
    }
  }

  /**
   * Gets the current branch name.
   * @returns The current branch name
   */
  public getCurrentBranch(): string | null {
    return this.currentBranch;
  }

  /**
   * Disposes of the GitService instance.
   */
  public dispose(): void {
    this.removeAllListeners();
  }

  /**
   * Checks if the current repository is a GitHub repository.
   * @returns A promise that resolves with whether the repository is a GitHub repository
   */
  public async isGitHubRepo(): Promise<boolean> {
    try {
      const remotes = await this.getRemotes();
      const allowedHosts = ['github.com', 'github.io'];
      return remotes.some(remote => {
        try {
          const urlHost = new URL(remote.url).host;
          return allowedHosts.includes(urlHost);
        } catch {
          return false; // Invalid URL
        }
      });
    } catch (error) {
      console.error('Error checking if repo is a GitHub repo:', error);
      return false;
    }
  }

  /**
   * Gets the GitHub repository information.
   * @returns A promise that resolves with the GitHub repository information
   */
  public async getGitHubRepoInfo(): Promise<{ owner: string; repo: string } | null> {
    try {
      const remotes = await this.getRemotes();
      const allowedHosts = ['github.com', 'github.io'];
      const githubRemote = remotes.find(remote => {
        try {
          const urlHost = new URL(remote.url).host;
          return allowedHosts.includes(urlHost);
        } catch {
          return false; // Invalid URL
        }
      });

      if (!githubRemote) return null;

      // URL-Format: https://github.com/username/repo.git oder git@github.com:username/repo.git
      let match;
      if (githubRemote.url.startsWith('https')) {
        match = githubRemote.url.match(/github\.com\/([^\/]+)\/([^\.]+)(?:\.git)?/);
      } else {
        match = githubRemote.url.match(/github\.com:([^\/]+)\/([^\.]+)(?:\.git)?/);
      }

      if (!match) return null;

      return {
        owner: match[1],
        repo: match[2]
      };
    } catch (error) {
      console.error('Error getting GitHub repo info:', error);
      return null;
    }
  }

  /**
   * Creates a new GitHub repository.
   * @param name Repository name
   * @param description Repository description
   * @param isPrivate Whether the repository is private
   * @param token GitHub token
   * @returns A promise that resolves with the created repository information
   */
  public async createGitHubRepo(
    name: string, 
    description: string = '', 
    isPrivate: boolean = false, 
    token: string
  ): Promise<GitHubRepo | null> {
    try {
      const command = `
        curl -X POST \\
        -H "Authorization: token ${token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/user/repos \\
        -d '{"name":"${name}","description":"${description}","private":${isPrivate}}'
      `;
      
      const result = await execAsync(command);
      const repo = JSON.parse(result.stdout);
      
      return {
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        private: repo.private,
        owner: repo.owner.login
      };
    } catch (error) {
      console.error('Error creating GitHub repo:', error);
      return null;
    }
  }

  /**
   * Links the local repository to a GitHub repository.
   * @param repoUrl URL of the GitHub repository
   * @returns A promise that resolves with whether the link was successful
   */
  public async linkToGitHubRepo(repoUrl: string): Promise<boolean> {
    try {
      await this.git.addRemote('origin', repoUrl);
      return true;
    } catch (error) {
      console.error('Error linking to GitHub repo:', error);
      return false;
    }
  }

  /**
   * Clones a GitHub repository.
   * @param repoUrl URL of the GitHub repository
   * @param targetPath Path to clone the repository to
   * @returns A promise that resolves with whether the clone was successful
   */
  public static async cloneGitHubRepo(repoUrl: string, targetPath: string): Promise<boolean> {
    try {
      const git = simpleGit();
      await git.clone(repoUrl, targetPath);
      return true;
    } catch (error) {
      console.error('Error cloning GitHub repo:', error);
      return false;
    }
  }

  /**
   * Gets the issues for a GitHub repository.
   * @param token GitHub token
   * @returns A promise that resolves with the list of issues
   */
  public async getGitHubIssues(token: string): Promise<GitHubIssue[]> {
    try {
      const repoInfo = await this.getGitHubRepoInfo();
      if (!repoInfo) throw new Error('Not a GitHub repository');

      const command = `
        curl -X GET \\
        -H "Authorization: token ${token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues
      `;
      
      const result = await execAsync(command);
      const issues = JSON.parse(result.stdout);
      
      return issues.map((issue: any) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        user: issue.user.login,
        labels: issue.labels.map((label: any) => label.name)
      }));
    } catch (error) {
      console.error('Error getting GitHub issues:', error);
      return [];
    }
  }

  /**
   * Creates a new issue in a GitHub repository.
   * @param title Issue title
   * @param body Issue body
   * @param token GitHub token
   * @returns A promise that resolves with the created issue information
   */
  public async createGitHubIssue(
    title: string, 
    body: string, 
    token: string
  ): Promise<GitHubIssue | null> {
    try {
      const repoInfo = await this.getGitHubRepoInfo();
      if (!repoInfo) throw new Error('Not a GitHub repository');

      const command = `
        curl -X POST \\
        -H "Authorization: token ${token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues \\
        -d '{"title":"${title}","body":"${body}"}'
      `;
      
      const result = await execAsync(command);
      const issue = JSON.parse(result.stdout);
      
      return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        user: issue.user.login,
        labels: issue.labels.map((label: any) => label.name)
      };
    } catch (error) {
      console.error('Error creating GitHub issue:', error);
      return null;
    }
  }

  /**
   * Gets the pull requests for a GitHub repository.
   * @param token GitHub token
   * @returns A promise that resolves with the list of pull requests
   */
  public async getGitHubPullRequests(token: string): Promise<GitHubPullRequest[]> {
    try {
      const repoInfo = await this.getGitHubRepoInfo();
      if (!repoInfo) throw new Error('Not a GitHub repository');

      const command = `
        curl -X GET \\
        -H "Authorization: token ${token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls
      `;
      
      const result = await execAsync(command);
      const prs = JSON.parse(result.stdout);
      
      return prs.map((pr: any) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.merged ? 'merged' : pr.state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        user: pr.user.login,
        base: pr.base.ref,
        head: pr.head.ref
      }));
    } catch (error) {
      console.error('Error getting GitHub pull requests:', error);
      return [];
    }
  }

  /**
   * Creates a new pull request in a GitHub repository.
   * @param title Pull request title
   * @param body Pull request body
   * @param head Head branch
   * @param base Base branch
   * @param token GitHub token
   * @returns A promise that resolves with the created pull request information
   */
  public async createGitHubPullRequest(
    title: string, 
    body: string, 
    head: string, 
    base: string, 
    token: string
  ): Promise<GitHubPullRequest | null> {
    try {
      const repoInfo = await this.getGitHubRepoInfo();
      if (!repoInfo) throw new Error('Not a GitHub repository');

      const command = `
        curl -X POST \\
        -H "Authorization: token ${token}" \\
        -H "Accept: application/vnd.github.v3+json" \\
        https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls \\
        -d '{"title":"${title}","body":"${body}","head":"${head}","base":"${base}"}'
      `;
      
      const result = await execAsync(command);
      const pr = JSON.parse(result.stdout);
      
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.merged ? 'merged' : pr.state,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        user: pr.user.login,
        base: pr.base.ref,
        head: pr.head.ref
      };
    } catch (error) {
      console.error('Error creating GitHub pull request:', error);
      return null;
    }
  }
}