import React, { useEffect, useState } from 'react';
import { GitService, GitStatus as ServiceGitStatus } from '../services/GitService';
import { FaGitAlt, FaCodeBranch, FaPlus } from 'react-icons/fa';
import './GitPanel.css';
import { GitBranch, GitStatus } from '../types/GitTypes';
import { 
  GitCommit, 
  GitRemote, 
  GitDiff, 
  GitDiffChange 
} from '../types/GitTypes';

interface GitPanelProps {
  workspacePath: string;
}

export const GitPanel: React.FC<GitPanelProps> = ({ workspacePath }) => {
  const [gitService] = useState(() => GitService.getInstance(workspacePath));
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [status, setStatus] = useState<GitStatus>({
    current: '',
    staged: [],
    not_added: [],
    modified: [],
    deleted: [],
    renamed: [],
    untracked: []
  });
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [newBranchName, setNewBranchName] = useState<string>('');
  const [showNewBranch, setShowNewBranch] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const updateGitInfo = async () => {
      try {
        setIsLoading(true);
        const [newBranches, serviceStatus] = await Promise.all([
          gitService.getBranches(),
          gitService.getStatus()
        ]);
        setBranches(newBranches);
        setStatus({
          current: serviceStatus.branch,
          staged: serviceStatus.staged,
          not_added: serviceStatus.modified.filter(f => !serviceStatus.staged.includes(f)),
          modified: serviceStatus.modified,
          deleted: serviceStatus.deleted,
          renamed: [],
          untracked: serviceStatus.untracked
        });
        const current = gitService.getCurrentBranch();
        setCurrentBranch(current || '');
      } catch (error) {
        console.error('Error updating git info:', error);
        setStatus({
          current: '',
          staged: [],
          not_added: [],
          modified: [],
          deleted: [],
          renamed: [],
          untracked: []
        });
        setBranches([]);
        setCurrentBranch('');
      } finally {
        setIsLoading(false);
      }
    };

    updateGitInfo();
    const interval = setInterval(updateGitInfo, 5000);
    return () => clearInterval(interval);
  }, [gitService]);

  const handleBranchSwitch = async (branchName: string) => {
    try {
      await gitService.checkout(branchName);
      const [newBranches, serviceStatus] = await Promise.all([
        gitService.getBranches(),
        gitService.getStatus()
      ]);
      setBranches(newBranches);
      setStatus({
        current: serviceStatus.branch,
        staged: serviceStatus.staged,
        not_added: serviceStatus.modified.filter(f => !serviceStatus.staged.includes(f)),
        modified: serviceStatus.modified,
        deleted: serviceStatus.deleted,
        renamed: [],
        untracked: serviceStatus.untracked
      });
    } catch (error) {
      console.error('Error switching branch:', error);
    }
  };

  const handleBranchDelete = async (branchName: string) => {
    try {
      await gitService.deleteBranch(branchName);
    } catch (error) {
      console.error('Failed to delete branch:', error);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName) return;

    try {
      await gitService.createBranch(newBranchName);
      setNewBranchName('');
      setShowNewBranch(false);
    } catch (error) {
      console.error('Failed to create branch:', error);
    }
  };

  if (isLoading) {
    return <div>Loading Git information...</div>;
  }

  return (
    <div className="git-panel">
      <div className="git-header">
        <FaGitAlt />
        <span>Git</span>
      </div>

      <div className="git-content">
        <div className="git-section">
          <h3>
            <FaCodeBranch />
            <span>Current Branch</span>
          </h3>
          <div className="current-branch">
            <FaCodeBranch />
            <span>{currentBranch}</span>
          </div>
        </div>

        <div className="git-section">
          <h3>
            <FaCodeBranch />
            <span>Branches</span>
          </h3>
          <div className="branches-list">
            {branches.map(branch => (
              <div
                key={branch.name}
                className={`branch-item ${branch.current ? 'current' : ''}`}
                onClick={() => handleBranchSwitch(branch.name)}
              >
                <span className="branch-name">{branch.name}</span>
                {!branch.current && (
                  <button
                    className="delete-branch"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBranchDelete(branch.name);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
          {showNewBranch ? (
            <div className="new-branch">
              <input
                type="text"
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                placeholder="New branch name"
              />
              <button onClick={handleCreateBranch}>Create</button>
              <button onClick={() => setShowNewBranch(false)}>Cancel</button>
            </div>
          ) : (
            <button className="new-branch-button" onClick={() => setShowNewBranch(true)}>
              <FaPlus />
              <span>New Branch</span>
            </button>
          )}
        </div>

        <div className="git-section">
          <h3>Status</h3>
          <div className="status-list">
            {status.modified.length > 0 && (
              <div className="modified">
                <span className="label">Modified:</span>
                <span className="count">{status.modified.length}</span>
              </div>
            )}
            {status.untracked.length > 0 && (
              <div className="untracked">
                <span className="label">Untracked:</span>
                <span className="count">{status.untracked.length}</span>
              </div>
            )}
            {status.deleted.length > 0 && (
              <div className="deleted">
                <span className="label">Deleted:</span>
                <span className="count">{status.deleted.length}</span>
              </div>
            )}
            {status.staged.length > 0 && (
              <div className="staged">
                <span className="label">Staged:</span>
                <span className="count">{status.staged.length}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitPanel; 