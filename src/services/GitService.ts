import { simpleGit, SimpleGit, StatusResult, DiffResult as GitDiffResult, GitError } from 'simple-git';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as monaco from 'monaco-editor';
import { GitBranch, GitCommit, GitDiff } from '../types/GitTypes';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { exec, ExecException } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';

interface ExecResult {
  stdout: string;
  stderr: string;
}

type ExecAsyncResult = Promise<ExecResult>;

const execAsync = promisify(exec) as (command: string, options?: any) => ExecAsyncResult;

interface GitRemote {
  name: string;
  url: string;
}

interface GitDiffChange {
  lineNumber: number;
  type: 'added' | 'removed' | 'modified';
  content: string;
}

export interface DiffResult {
  files: string[];
  insertions: number;
  deletions: number;
  changed: GitDiffChange[];
  raw: string;
}

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

// Renamed to avoid conflict with imported GitBranch
export interface LocalGitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  ahead: number;
  behind: number;
}

export class GitService extends EventEmitter {
  private static instance: GitService;
  private git: SimpleGit;
  private status: GitStatus;
  private branches: GitBranch[] = [];
  private remotes: GitRemote[] = [];
  private commits: GitCommit[] = [];
  private currentBranch: string | null = null;
  private isInitialized: boolean = false;
  private workspacePath: string;
  private diffs: Map<string, GitDiff> = new Map();
  private isGitRepo: boolean;

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

  public static getInstance(workspacePath: string): GitService {
    if (!GitService.instance) {
      GitService.instance = new GitService(workspacePath);
    }
    return GitService.instance;
  }

  private checkIfGitRepo(): boolean {
    try {
      const gitDir = path.join(this.workspacePath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      console.error('Error checking if directory is a git repository:', error);
      return false;
    }
  }

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

  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Git service not initialized');
    }
  }

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
      const result = await execAsync('git status --porcelain', { cwd: this.workspacePath });
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

      const branchResult = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspacePath });
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

  public async refreshStatus(): Promise<GitStatus> {
    return this.getStatus();
  }

  public async refreshBranches(): Promise<GitBranch[]> {
    this.checkInitialized();
    try {
      const result = await execAsync('git branch -vv', { cwd: this.workspacePath });
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

  public async getBranches(): Promise<GitBranch[]> {
    if (!this.isGitRepo) {
      return [];
    }
    try {
      const result = await execAsync('git branch -a', { cwd: this.workspacePath });
      const branchLines = result.stdout.split('\n');
      return branchLines
        .filter((line: string) => line.trim())
        .map((line: string) => {
          const isCurrent = line.startsWith('*');
          const name = line.replace(/\*/g, '').trim();
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

  public getRemotes(): GitRemote[] {
    return [...this.remotes];
  }

  public getCommits(): GitCommit[] {
    return [...this.commits];
  }

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

  public getCurrentBranch(): string | null {
    return this.currentBranch;
  }

  public dispose(): void {
    this.removeAllListeners();
  }
} 