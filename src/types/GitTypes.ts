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

export interface GitDiff {
  filePath: string;
  changes: GitDiffChange[];
}

export interface GitDiffChange {
  lineNumber: number;
  type: 'added' | 'removed' | 'modified';
  content: string;
}

export interface GitStatus {
  current: string;
  staged: string[];
  not_added: string[];
  modified: string[];
  deleted: string[];
  renamed: string[];
  untracked: string[];
} 