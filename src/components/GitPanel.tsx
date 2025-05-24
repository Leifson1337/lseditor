import React, { useEffect, useState } from 'react';
import {
  GitService,
  // GitStatus as ServiceGitStatus, // Not directly used, GitStatus from types/GitTypes is used
  GitHubIssue,
  GitHubPullRequest,
  // GitHubRepo, // Not directly used in this component's props/state
  DiffResult // Import DiffResult
} from '../services/GitService';
import {
  FaGitAlt,
  FaCodeBranch,
  FaPlus,
  FaGithub,
  FaExclamationCircle,
  FaSync,
  FaLock,
  // FaLockOpen, // Not used
  FaClone,
  FaLink,
  FaArrowAltCircleRight,
  FaCode,
  FaUpload,
  FaDownload,
  FaCloudDownloadAlt,
  FaLightbulb
} from 'react-icons/fa';
import './GitPanel.css';
import { GitBranch, GitStatus } from '../types/GitTypes';
import { AIService } from '../services/AIService';
import DiffViewer from './DiffViewer'; // Import DiffViewer

// Props for the GitPanel component
interface GitPanelProps {
  workspacePath: string; // Path to the current workspace directory
}

// Tabs for different GitHub features
type GitHubTab = 'overview' | 'issues' | 'pullRequests' | 'repositories';

// GitPanel provides a UI for Git and GitHub operations within the editor
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

  const [isGitHubRepo, setIsGitHubRepo] = useState<boolean>(false);
  const [githubTab, setGithubTab] = useState<GitHubTab>('overview');
  const [githubToken, setGithubToken] = useState<string>('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);

  const [newIssueTitle, setNewIssueTitle] = useState<string>('');
  const [newIssueBody, setNewIssueBody] = useState<string>('');
  const [showNewIssue, setShowNewIssue] = useState<boolean>(false);

  const [newPRTitle, setNewPRTitle] = useState<string>('');
  const [newPRBody, setNewPRBody] = useState<string>('');
  const [newPRBase, setNewPRBase] = useState<string>('');
  const [newPRHead, setNewPRHead] = useState<string>('');
  const [showNewPR, setShowNewPR] = useState<boolean>(false);

  const [newRepoName, setNewRepoName] = useState<string>('');
  const [newRepoDescription, setNewRepoDescription] = useState<string>('');
  const [newRepoPrivate, setNewRepoPrivate] = useState<boolean>(false);
  const [showNewRepo, setShowNewRepo] = useState<boolean>(false);

  const [repoUrl, setRepoUrl] = useState<string>('');
  const [showCloneRepo, setShowCloneRepo] = useState<boolean>(false);
  const [showLinkRepo, setShowLinkRepo] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);

  const [selectedFileDiff, setSelectedFileDiff] = useState<{ filePath: string; diffResult: DiffResult } | null>(null);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState<boolean>(false);

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
          not_added: serviceStatus.untracked, // From GitService's getStatus
          modified: serviceStatus.modified, // From GitService's getStatus (unstaged changes to tracked files)
          deleted: serviceStatus.deleted,
          renamed: [], // simple-git status doesn't explicitly list renamed, often as M or D+A
          untracked: serviceStatus.untracked // Explicitly from GitService's getStatus
        });
        const current = gitService.getCurrentBranch();
        setCurrentBranch(current || '');

        const isGH = await gitService.isGitHubRepo();
        setIsGitHubRepo(isGH);

        const savedToken = localStorage.getItem('github_token');
        if (savedToken) {
          setGithubToken(savedToken);
          if (isGH) {
            try {
              const [ghIssues, ghPRs] = await Promise.all([
                gitService.getGitHubIssues(savedToken),
                gitService.getGitHubPullRequests(savedToken)
              ]);
              setIssues(ghIssues);
              setPullRequests(ghPRs);
            } catch (error) {
              console.error('Error loading GitHub data:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error updating git info:', error);
        setStatus({ current: '', staged: [], not_added: [], modified: [], deleted: [], renamed: [], untracked: [] });
        setBranches([]);
        setCurrentBranch('');
      } finally {
        setIsLoading(false);
      }
    };

    updateGitInfo();
    const interval = setInterval(updateGitInfo, 5000); // Refresh interval

    const handleGithubAction = (event: CustomEvent) => {
      const { action } = event.detail;
      if (action === 'issues') setGithubTab('issues');
      else if (action === 'pullRequests') setGithubTab('pullRequests');
      else if (action === 'repositories') setGithubTab('repositories');
      else if (action === 'newRepo') {
        setGithubTab('repositories');
        setShowNewRepo(true);
      }
    };
    document.addEventListener('github-action', handleGithubAction as EventListener);

    return () => {
      clearInterval(interval);
      document.removeEventListener('github-action', handleGithubAction as EventListener);
    };
  }, [gitService]);

  const refreshGitData = async () => {
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
        not_added: serviceStatus.untracked,
        modified: serviceStatus.modified,
        deleted: serviceStatus.deleted,
        renamed: [],
        untracked: serviceStatus.untracked
      });
      const current = gitService.getCurrentBranch();
      setCurrentBranch(current || '');
    } catch (error) {
      console.error('Error refreshing git data:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleBranchSwitch = async (branchName: string) => {
    try {
      await gitService.checkout(branchName);
      await refreshGitData();
    } catch (error) {
      console.error('Error switching branch:', error);
      alert(`Failed to switch to branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleBranchDelete = async (branchName: string) => {
    try {
      await gitService.deleteBranch(branchName);
      await refreshGitData();
    } catch (error) {
      console.error('Failed to delete branch:', error);
      alert(`Failed to delete branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName) return;
    try {
      await gitService.createBranch(newBranchName);
      setNewBranchName('');
      setShowNewBranch(false);
      await refreshGitData();
    } catch (error) {
      console.error('Failed to create branch:', error);
      alert(`Failed to create branch ${newBranchName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSaveToken = () => {
    if (githubToken) {
      localStorage.setItem('github_token', githubToken);
      setShowTokenInput(false);
      if (isGitHubRepo) {
        Promise.all([
          gitService.getGitHubIssues(githubToken),
          gitService.getGitHubPullRequests(githubToken)
        ]).then(([ghIssues, ghPRs]) => {
          setIssues(ghIssues);
          setPullRequests(ghPRs);
        }).catch(error => console.error('Error loading GitHub data after saving token:', error));
      }
    }
  };

  const handleCreateIssue = async () => {
    if (!newIssueTitle || !githubToken) return;
    try {
      const issue = await gitService.createGitHubIssue(newIssueTitle, newIssueBody, githubToken);
      if (issue) {
        setIssues([issue, ...issues]);
        setNewIssueTitle(''); setNewIssueBody(''); setShowNewIssue(false);
      }
    } catch (error) { console.error('Failed to create issue:', error); }
  };

  const handleCreatePR = async () => {
    if (!newPRTitle || !newPRBase || !newPRHead || !githubToken) return;
    try {
      const pr = await gitService.createGitHubPullRequest(newPRTitle, newPRBody, newPRHead, newPRBase, githubToken);
      if (pr) {
        setPullRequests([pr, ...pullRequests]);
        setNewPRTitle(''); setNewPRBody(''); setNewPRBase(''); setNewPRHead(''); setShowNewPR(false);
      }
    } catch (error) { console.error('Failed to create pull request:', error); }
  };
  
  const handleCreateRepo = async () => {
    if (!newRepoName || !githubToken) return;
    try {
      const repo = await gitService.createGitHubRepo(newRepoName, newRepoDescription, newRepoPrivate, githubToken);
      if (repo) {
        setNewRepoName(''); setNewRepoDescription(''); setNewRepoPrivate(false); setShowNewRepo(false);
        if (window.confirm(`Repository "${repo.name}" created. Link local to this GitHub repo?`)) {
          await gitService.linkToGitHubRepo(repo.url);
          setIsGitHubRepo(true);
        }
      }
    } catch (error) { console.error('Failed to create repository:', error); }
  };

  const handleCloneRepo = async () => {
    if (!repoUrl) return;
    try {
      const targetDir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory', { title: 'Select target directory' });
      if (!targetDir) return;
      const success = await GitService.cloneGitHubRepo(repoUrl, targetDir);
      if (success) {
        setRepoUrl(''); setShowCloneRepo(false); alert(`Repo cloned to ${targetDir}.`);
      } else { alert('Failed to clone repository.'); }
    } catch (error) { console.error('Failed to clone repository:', error); alert(`Clone failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleLinkRepo = async () => {
    if (!repoUrl) return;
    try {
      const success = await gitService.linkToGitHubRepo(repoUrl);
      if (success) {
        setRepoUrl(''); setShowLinkRepo(false); setIsGitHubRepo(true); alert('Repo linked.');
      } else { alert('Failed to link repository.'); }
    } catch (error) { console.error('Failed to link repository:', error); alert(`Link failed: ${error instanceof Error ? error.message : String(error)}`); }
  };
  
  const handleGitOperation = async (operation: 'push' | 'pull' | 'fetch', setLoading: React.Dispatch<React.SetStateAction<boolean>>) => {
    setLoading(true);
    try {
      await gitService[operation]();
      await refreshGitData();
      alert(`${operation.charAt(0).toUpperCase() + operation.slice(1)} successful!`);
    } catch (error) {
      console.error(`Failed to ${operation}:`, error);
      alert(`Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePush = () => handleGitOperation('push', setIsPushing);
  const handlePull = () => handleGitOperation('pull', setIsPulling);
  const handleFetch = () => handleGitOperation('fetch', setIsFetching);

  const handleStageFile = async (filePath: string) => {
    try {
      await gitService.stage([filePath]);
      await refreshGitData();
    } catch (error) { console.error('Failed to stage file:', error); alert(`Stage failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleUnstageFile = async (filePath: string) => {
    try {
      await gitService.unstage([filePath]);
      await refreshGitData();
    } catch (error) { console.error('Failed to unstage file:', error); alert(`Unstage failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) { alert('Commit message cannot be empty.'); return; }
    setIsCommitting(true);
    try {
      await gitService.commit(commitMessage);
      setCommitMessage('');
      await refreshGitData();
      alert('Commit successful!');
    } catch (error) { console.error('Failed to commit:', error); alert(`Commit failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsCommitting(false); }
  };
  
  const handleSuggestCommitMessage = async () => {
    setIsSuggesting(true);
    try {
      const stagedDiff = await gitService.getStagedDiff();
      if (!stagedDiff || stagedDiff.trim() === "") {
        alert('No staged changes to generate a commit message from.');
        setIsSuggesting(false);
        return;
      }
      const aiService = AIService.getInstance({} as any); // Placeholder config
      if (!aiService.isInitialized) { await aiService.initialize(); }
      const suggestedMessage = await aiService.generateCommitMessage(stagedDiff);
      setCommitMessage(suggestedMessage);
    } catch (error) { console.error('Failed to suggest commit message:', error); alert(`Suggestion failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setIsSuggesting(false); }
  };

  const handleFileClick = async (filePath: string, isStaged: boolean) => {
    try {
      let diffResult: DiffResult;
      if (isStaged) {
        const rawDiff = await gitService.git.diff(['--staged', filePath]);
        // Construct DiffResult; DiffViewer primarily uses raw but other fields are for structure
        diffResult = { raw: rawDiff, files: [filePath], insertions: 0, deletions: 0, changed: [] };
      } else {
        diffResult = await gitService.getDiff(filePath);
      }
      setSelectedFileDiff({ filePath, diffResult });
      setIsDiffModalOpen(true);
    } catch (error) {
      console.error('Error fetching diff for file:', filePath, error);
      alert(`Could not load diff for ${filePath}.`);
    }
  };

  const closeDiffModal = () => {
    setIsDiffModalOpen(false);
    setSelectedFileDiff(null);
  };

  if (isLoading) { return <div>Loading Git information...</div>; }

  return (
    <div className="git-panel">
      <div className="git-header">
        <FaGitAlt /> <span>Git</span>
        {isGitHubRepo && <div className="github-indicator"><FaGithub /> <span>GitHub</span></div>}
      </div>

      <div className="git-content">
        <div className="git-section">
          <h3><FaCodeBranch /> Current Branch</h3>
          <div className="current-branch"><FaCodeBranch /> <span>{currentBranch}</span></div>
        </div>

        <div className="git-section">
          <h3><FaCodeBranch /> Branches</h3>
          <div className="branches-list">
            {branches.map(branch => (
              <div key={branch.name} className={`branch-item ${branch.current ? 'current' : ''}`} onClick={() => handleBranchSwitch(branch.name)}>
                <span className="branch-name">{branch.name}</span>
                {!branch.current && <button className="delete-branch" onClick={(e) => { e.stopPropagation(); handleBranchDelete(branch.name); }}>Delete</button>}
              </div>
            ))}
          </div>
          {showNewBranch ? (
            <div className="new-branch">
              <input type="text" value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="New branch name" />
              <button onClick={handleCreateBranch}>Create</button>
              <button onClick={() => setShowNewBranch(false)}>Cancel</button>
            </div>
          ) : (
            <button className="new-branch-button" onClick={() => setShowNewBranch(true)}><FaPlus /> New Branch</button>
          )}
        </div>

        <div className="git-section">
          <h3>Actions</h3>
          <div className="git-actions">
            <button onClick={handlePush} disabled={isPushing}><FaUpload /> {isPushing ? 'Pushing...' : 'Push'}</button>
            <button onClick={handlePull} disabled={isPulling}><FaDownload /> {isPulling ? 'Pulling...' : 'Pull'}</button>
            <button onClick={handleFetch} disabled={isFetching}><FaCloudDownloadAlt /> {isFetching ? 'Fetching...' : 'Fetch'}</button>
            <button onClick={refreshGitData} disabled={isLoading}><FaSync /> Refresh</button>
          </div>
        </div>

        <div className="git-section">
          <h3>Commit Changes</h3>
          <textarea className="commit-message-input" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Commit message" rows={3} disabled={isCommitting || isSuggesting} />
          <div className="commit-actions">
            <button className="commit-button" onClick={handleCommit} disabled={isCommitting || isSuggesting || (status.staged.length === 0 && status.modified.length === 0 && status.untracked.length === 0)}>{isCommitting ? 'Committing...' : 'Commit'}</button>
            <button className="suggest-commit-button" onClick={handleSuggestCommitMessage} disabled={isSuggesting || isCommitting || status.staged.length === 0} title="Suggest commit message (AI)">{isSuggesting ? <FaSync className="fa-spin" /> : <FaLightbulb />} {isSuggesting ? 'Suggesting...' : 'Suggest'}</button>
          </div>
        </div>

        <div className="git-section">
          <h3>Staged Changes ({status.staged.length})</h3>
          {status.staged.length === 0 ? <p>No files staged.</p> : (
            <div className="file-list">
              {status.staged.map(file => (
                <div key={`staged-${file}`} className="file-item staged-file">
                  <span className="file-name" onClick={() => handleFileClick(file, true)} title={`View diff for ${file}`}>{file}</span>
                  <button onClick={() => handleUnstageFile(file)}>Unstage</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="git-section">
          <h3>Modified Files ({status.modified.length + status.untracked.length})</h3>
          {(status.modified.length + status.untracked.length) === 0 ? <p>No modified or untracked files.</p> : (
            <div className="file-list">
              {status.modified.map(file => (
                <div key={`modified-${file}`} className="file-item modified-file">
                  <span className="file-name" onClick={() => handleFileClick(file, false)} title={`View diff for ${file}`}>{file} (Modified)</span>
                  <button onClick={() => handleStageFile(file)}>Stage</button>
                </div>
              ))}
              {status.untracked.map(file => (
                <div key={`untracked-${file}`} className="file-item untracked-file">
                  <span className="file-name" onClick={() => handleFileClick(file, false)} title={`View diff for ${file}`}>{file} (Untracked)</span>
                  <button onClick={() => handleStageFile(file)}>Stage</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {isDiffModalOpen && selectedFileDiff && (
          <div className="diff-modal-overlay" onClick={closeDiffModal}>
            <div className="diff-modal-content" onClick={e => e.stopPropagation()}>
              <div className="diff-modal-header">
                <h3>Diff for {selectedFileDiff.filePath}</h3>
                <button onClick={closeDiffModal} className="diff-modal-close-button">&times;</button>
              </div>
              <DiffViewer
                filePath={selectedFileDiff.filePath}
                diffResult={selectedFileDiff.diffResult}
              />
            </div>
          </div>
        )}

        {/* GitHub Section */}
        <div className="github-section">
          <h3><FaGithub /> GitHub</h3>
          {/* ... (GitHub content remains the same) ... */}
          {showTokenInput ? (
            <div className="token-input">
              <input type="password" value={githubToken} onChange={e => setGithubToken(e.target.value)} placeholder="GitHub Personal Access Token" />
              <button onClick={handleSaveToken}>Save</button>
              <button onClick={() => setShowTokenInput(false)}>Cancel</button>
            </div>
          ) : (
            <>
              {!isGitHubRepo && !githubToken && (
                 <button className="token-button" onClick={() => setShowTokenInput(true)} title="Configure GitHub token"><FaLock /> Configure Token</button>
              )}
              <div className="github-tabs">
                <button className={`github-tab ${githubTab === 'overview' ? 'active' : ''}`} onClick={() => setGithubTab('overview')}>Overview</button>
                <button className={`github-tab ${githubTab === 'issues' ? 'active' : ''}`} onClick={() => setGithubTab('issues')}>Issues</button>
                <button className={`github-tab ${githubTab === 'pullRequests' ? 'active' : ''}`} onClick={() => setGithubTab('pullRequests')}>Pull Requests</button>
                <button className={`github-tab ${githubTab === 'repositories' ? 'active' : ''}`} onClick={() => setGithubTab('repositories')}>Repositories</button>
              </div>
              <div className="github-tab-content">
                {githubTab === 'overview' && (
                  <div className="github-overview">
                    {isGitHubRepo ? (
                      <div className="github-stats">
                        <div className="stat-item"><FaExclamationCircle /> {issues.length} Issues</div>
                        <div className="stat-item"><FaArrowAltCircleRight /> {pullRequests.length} Pull Requests</div>
                      </div>
                    ) : (
                      <div className="not-github-repo">
                        <p>This repository is not linked to GitHub.</p>
                        <div className="github-actions">
                          <button onClick={() => setShowLinkRepo(true)}><FaLink /> Link to GitHub</button>
                          <button onClick={() => { setGithubTab('repositories'); setShowNewRepo(true);}}><FaGithub /> Create new repository</button>
                          <button onClick={() => { setGithubTab('repositories'); setShowCloneRepo(true);}}><FaClone /> Clone repository</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {githubTab === 'issues' && (
                  <div className="github-issues">
                    {!githubToken ? <p>GitHub token required.</p> : !isGitHubRepo ? <p>Not a GitHub repository.</p> : (
                      <>
                        <button className="new-issue-button" onClick={() => setShowNewIssue(true)}><FaPlus /> New Issue</button>
                        {showNewIssue && (
                          <div className="new-issue-form">
                            <input type="text" value={newIssueTitle} onChange={e => setNewIssueTitle(e.target.value)} placeholder="Title" />
                            <textarea value={newIssueBody} onChange={e => setNewIssueBody(e.target.value)} placeholder="Description" />
                            <button onClick={handleCreateIssue}>Create</button> <button onClick={() => setShowNewIssue(false)}>Cancel</button>
                          </div>
                        )}
                        <div className="issues-list">
                          {issues.length === 0 ? <p>No issues.</p> : issues.map(issue => (
                            <div key={issue.id} className="issue-item">
                              <div>#{issue.number} {issue.title} ({issue.state})</div>
                              <div>@{issue.user} on {new Date(issue.created_at).toLocaleDateString()}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                 {githubTab === 'pullRequests' && (
                  <div className="github-prs">
                     {!githubToken ? <p>GitHub token required.</p> : !isGitHubRepo ? <p>Not a GitHub repository.</p> : (
                      <>
                        <button className="new-pr-button" onClick={() => setShowNewPR(true)}><FaPlus /> New Pull Request</button>
                        {showNewPR && (
                          <div className="new-pr-form">
                            <input type="text" value={newPRTitle} onChange={e => setNewPRTitle(e.target.value)} placeholder="Title" />
                            <textarea value={newPRBody} onChange={e => setNewPRBody(e.target.value)} placeholder="Description" />
                            <select value={newPRBase} onChange={e => setNewPRBase(e.target.value)}><option value="">Base Branch</option>{branches.map(b => <option key={`base-${b.name}`} value={b.name}>{b.name}</option>)}</select>
                            <select value={newPRHead} onChange={e => setNewPRHead(e.target.value)}><option value="">Head Branch</option>{branches.map(b => <option key={`head-${b.name}`} value={b.name}>{b.name}</option>)}</select>
                            <button onClick={handleCreatePR}>Create</button> <button onClick={() => setShowNewPR(false)}>Cancel</button>
                          </div>
                        )}
                        <div className="prs-list">
                          {pullRequests.length === 0 ? <p>No PRs.</p> : pullRequests.map(pr => (
                            <div key={pr.id} className="pr-item">
                              <div>#{pr.number} {pr.title} ({pr.state})</div>
                              <div>{pr.head} → {pr.base} by @{pr.user} on {new Date(pr.created_at).toLocaleDateString()}</div>
                            </div>
                          ))}
                        </div>
                      </>
                     )}
                  </div>
                )}
                {githubTab === 'repositories' && (
                  <div className="github-repos">
                    {!githubToken ? <p>GitHub token required.</p> : (
                      <>
                        <div className="repo-actions">
                          <button onClick={() => setShowNewRepo(true)}><FaPlus /> New Repository</button>
                          <button onClick={() => setShowCloneRepo(true)}><FaClone /> Clone Repository</button>
                          {!isGitHubRepo && <button onClick={() => setShowLinkRepo(true)}><FaLink /> Link Current Repository</button>}
                        </div>
                        {showNewRepo && (
                          <div className="new-repo-form">
                            <h4>Create New Repository</h4>
                            <input type="text" value={newRepoName} onChange={e => setNewRepoName(e.target.value)} placeholder="Repo name" />
                            <textarea value={newRepoDescription} onChange={e => setNewRepoDescription(e.target.value)} placeholder="Description" />
                            <label><input type="checkbox" checked={newRepoPrivate} onChange={e => setNewRepoPrivate(e.target.checked)} /> Private</label>
                            <button onClick={handleCreateRepo}>Create</button> <button onClick={() => setShowNewRepo(false)}>Cancel</button>
                          </div>
                        )}
                        {showCloneRepo && (
                          <div className="clone-repo-form">
                            <h4>Clone Repository</h4>
                            <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="Repo URL" />
                            <button onClick={handleCloneRepo}>Clone</button> <button onClick={() => setShowCloneRepo(false)}>Cancel</button>
                          </div>
                        )}
                        {showLinkRepo && (
                          <div className="link-repo-form">
                            <h4>Link Current Repository</h4>
                            <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="Repo URL" />
                            <button onClick={handleLinkRepo}>Link</button> <button onClick={() => setShowLinkRepo(false)}>Cancel</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GitPanel;