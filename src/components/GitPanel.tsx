import React, { useEffect, useState, useCallback } from 'react';
import './GitPanel.css';

interface GitFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'unknown';
}

interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

interface GitPanelProps {
  projectPath?: string;
}

const STATUS_LABELS: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
  renamed: 'R',
  unknown: '?',
};

const STATUS_COLORS: Record<string, string> = {
  modified: '#e2c08d',
  added: '#73c991',
  deleted: '#f14c4c',
  untracked: '#73c991',
  renamed: '#e2c08d',
  unknown: '#858fa0',
};

const GitPanel: React.FC<GitPanelProps> = ({ projectPath }) => {
  const [changedFiles, setChangedFiles] = useState<GitFile[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [stagedFiles, setStagedFiles] = useState<Set<string>>(new Set());

  const ipc = (window as any).electron?.ipcRenderer;

  const runGit = useCallback(async (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number } | null> => {
    if (!ipc || !projectPath) return null;
    try {
      return await ipc.invoke('terminal:runCommand', { command: 'git', args, cwd: projectPath });
    } catch {
      return null;
    }
  }, [ipc, projectPath]);

  const refreshStatus = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      // Get changed files
      const statusResult = await runGit(['status', '--porcelain']);
      if (statusResult && statusResult.exitCode === 0) {
        const files: GitFile[] = statusResult.stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            const xy = line.substring(0, 2);
            const filePath = line.substring(3).trim();
            let status: GitFile['status'] = 'unknown';
            if (xy.includes('M')) status = 'modified';
            else if (xy.includes('A')) status = 'added';
            else if (xy.includes('D')) status = 'deleted';
            else if (xy.includes('?')) status = 'untracked';
            else if (xy.includes('R')) status = 'renamed';
            return { path: filePath, status };
          });
        setChangedFiles(files);
      }

      // Get current branch
      const branchResult = await runGit(['branch', '--show-current']);
      if (branchResult && branchResult.exitCode === 0) {
        setCurrentBranch(branchResult.stdout.trim());
      }

      // Get all branches
      const branchListResult = await runGit(['branch', '-a']);
      if (branchListResult && branchListResult.exitCode === 0) {
        const parsed: GitBranch[] = branchListResult.stdout
          .split('\n')
          .filter(l => l.trim())
          .map(l => {
            const isCurrent = l.startsWith('*');
            const isRemote = l.includes('remotes/');
            const name = l.replace(/^\*?\s+/, '').replace('remotes/', '').trim();
            return { name, isCurrent, isRemote };
          });
        setBranches(parsed);
      }
    } finally {
      setLoading(false);
    }
  }, [projectPath, runGit]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const showStatus = (text: string, type: 'success' | 'error') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleStageAll = async () => {
    const result = await runGit(['add', '-A']);
    if (result?.exitCode === 0) {
      setStagedFiles(new Set(changedFiles.map(f => f.path)));
      showStatus('All files staged', 'success');
    } else {
      showStatus('Failed to stage files', 'error');
    }
  };

  const handleToggleStage = (filePath: string) => {
    setStagedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      showStatus('Enter a commit message', 'error');
      return;
    }
    if (stagedFiles.size === 0) {
      showStatus('No files staged', 'error');
      return;
    }
    const result = await runGit(['commit', '-m', commitMessage.trim()]);
    if (result?.exitCode === 0) {
      setCommitMessage('');
      setStagedFiles(new Set());
      showStatus('Committed successfully', 'success');
      await refreshStatus();
    } else {
      showStatus(result?.stderr?.trim() || 'Commit failed', 'error');
    }
  };

  const handlePush = async () => {
    const result = await runGit(['push']);
    if (result?.exitCode === 0) {
      showStatus('Pushed successfully', 'success');
    } else {
      showStatus(result?.stderr?.trim() || 'Push failed', 'error');
    }
  };

  const handlePull = async () => {
    const result = await runGit(['pull']);
    if (result?.exitCode === 0) {
      showStatus('Pulled successfully', 'success');
      await refreshStatus();
    } else {
      showStatus(result?.stderr?.trim() || 'Pull failed', 'error');
    }
  };

  const handleCheckout = async (branch: string) => {
    const result = await runGit(['checkout', branch]);
    if (result?.exitCode === 0) {
      setCurrentBranch(branch);
      showStatus(`Switched to ${branch}`, 'success');
      await refreshStatus();
    } else {
      showStatus(result?.stderr?.trim() || 'Checkout failed', 'error');
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    const result = await runGit(['checkout', '-b', newBranchName.trim()]);
    if (result?.exitCode === 0) {
      setNewBranchName('');
      setShowNewBranch(false);
      showStatus(`Created branch ${newBranchName.trim()}`, 'success');
      await refreshStatus();
    } else {
      showStatus(result?.stderr?.trim() || 'Failed to create branch', 'error');
    }
  };

  if (!projectPath) {
    return (
      <div className="git-panel-modern">
        <div className="git-panel-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M6 9v6M15.4 6.4A2.1 2.1 0 0 0 13.8 9H10"/>
          </svg>
          <p>Open a project to use Git</p>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel-modern">
      {/* Header */}
      <div className="git-panel-header">
        <span className="git-panel-title">Source Control</span>
        <button className="git-icon-btn" onClick={refreshStatus} title="Refresh" disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'git-spin' : ''}>
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
          </svg>
        </button>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div className={`git-status-toast ${statusMessage.type}`}>
          {statusMessage.text}
        </div>
      )}

      {/* Current branch */}
      <div className="git-branch-row">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <span className="git-branch-name">{currentBranch || 'no branch'}</span>
      </div>

      {/* Changed files */}
      <div className="git-section">
        <div className="git-section-header">
          <span>Changes ({changedFiles.length})</span>
          {changedFiles.length > 0 && (
            <button className="git-text-btn" onClick={handleStageAll}>Stage all</button>
          )}
        </div>
        {changedFiles.length === 0 ? (
          <div className="git-empty-files">No changes</div>
        ) : (
          <div className="git-file-list">
            {changedFiles.map(file => (
              <div
                key={file.path}
                className={`git-file-item ${stagedFiles.has(file.path) ? 'staged' : ''}`}
                onClick={() => handleToggleStage(file.path)}
                title={file.path}
              >
                <span className="git-file-name">{file.path.split(/[/\\]/).pop()}</span>
                <span className="git-file-status" style={{ color: STATUS_COLORS[file.status] }}>
                  {STATUS_LABELS[file.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commit */}
      <div className="git-section">
        <div className="git-section-header"><span>Commit</span></div>
        <input
          className="git-commit-input"
          type="text"
          placeholder="Message (staged: click files above)"
          value={commitMessage}
          onChange={e => setCommitMessage(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCommit()}
        />
        <button className="git-action-btn primary" onClick={handleCommit} disabled={!commitMessage.trim() || stagedFiles.size === 0}>
          Commit ({stagedFiles.size} files)
        </button>
      </div>

      {/* Push / Pull */}
      <div className="git-section">
        <div className="git-push-pull">
          <button className="git-action-btn" onClick={handlePull}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
            Pull
          </button>
          <button className="git-action-btn" onClick={handlePush}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="16 7 12 3 8 7"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
            Push
          </button>
        </div>
      </div>

      {/* Branches */}
      <div className="git-section git-section-branches">
        <div className="git-section-header">
          <span>Branches ({branches.filter(b => !b.isRemote).length})</span>
          <button className="git-text-btn" onClick={() => setShowNewBranch(v => !v)}>+ New</button>
        </div>
        {showNewBranch && (
          <div className="git-new-branch">
            <input
              className="git-commit-input"
              type="text"
              placeholder="Branch name"
              value={newBranchName}
              onChange={e => setNewBranchName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
              autoFocus
            />
            <button className="git-action-btn primary" onClick={handleCreateBranch}>Create</button>
          </div>
        )}
        <div className="git-branch-list">
          {branches.filter(b => !b.isRemote).map(branch => (
            <div
              key={branch.name}
              className={`git-branch-item ${branch.isCurrent ? 'active' : ''}`}
              onClick={() => !branch.isCurrent && handleCheckout(branch.name)}
              title={branch.name}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              <span>{branch.name}</span>
              {branch.isCurrent && <span className="git-branch-check">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GitPanel;
