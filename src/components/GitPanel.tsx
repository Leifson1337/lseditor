import React, { useEffect, useState } from 'react';
import { 
  GitService, 
  GitStatus as ServiceGitStatus, 
  GitHubIssue, 
  GitHubPullRequest,
  GitHubRepo
} from '../services/GitService';
import { 
  FaGitAlt, 
  FaCodeBranch, 
  FaPlus, 
  FaGithub, 
  FaExclamationCircle,
  FaSync,
  FaLock,
  FaLockOpen,
  FaClone,
  FaLink,
  FaArrowAltCircleRight,
  FaCode
} from 'react-icons/fa';
import './GitPanel.css';
import { GitBranch, GitStatus } from '../types/GitTypes';

// Props for the GitPanel component
interface GitPanelProps {
  workspacePath: string; // Path to the current workspace directory
}

// Tabs for different GitHub features
// 'overview' | 'issues' | 'pullRequests' | 'repositories'
type GitHubTab = 'overview' | 'issues' | 'pullRequests' | 'repositories';

// GitPanel provides a UI for Git and GitHub operations within the editor
export const GitPanel: React.FC<GitPanelProps> = ({ workspacePath }) => {
  // Git service instance for interacting with git commands and state
  const [gitService] = useState(() => GitService.getInstance(workspacePath));
  // List of local branches
  const [branches, setBranches] = useState<GitBranch[]>([]);
  // Current git status (staged, modified, etc.)
  const [status, setStatus] = useState<GitStatus>({
    current: '',
    staged: [],
    not_added: [],
    modified: [],
    deleted: [],
    renamed: [],
    untracked: []
  });
  // Name of the current branch
  const [currentBranch, setCurrentBranch] = useState<string>('');
  // State for new branch creation
  const [newBranchName, setNewBranchName] = useState<string>('');
  const [showNewBranch, setShowNewBranch] = useState<boolean>(false);
  // Loading state for async git operations
  const [isLoading, setIsLoading] = useState(true);
  
  // GitHub-specific states
  const [isGitHubRepo, setIsGitHubRepo] = useState<boolean>(false); // True if repo is hosted on GitHub
  const [githubTab, setGithubTab] = useState<GitHubTab>('overview'); // Current selected GitHub tab
  const [githubToken, setGithubToken] = useState<string>(''); // GitHub personal access token
  const [issues, setIssues] = useState<GitHubIssue[]>([]); // List of GitHub issues
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]); // List of pull requests
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false); // Show token input dialog
  
  // States for new GitHub items
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

  useEffect(() => {
    // Update git information on mount and when dependencies change
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
        
        // Check if this is a GitHub repository
        const isGH = await gitService.isGitHubRepo();
        setIsGitHubRepo(isGH);
        
        // Load GitHub token from local storage
        const savedToken = localStorage.getItem('github_token');
        if (savedToken) {
          setGithubToken(savedToken);
          
          // If this is a GitHub repository and a token is available, load issues and PRs
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
    
    // Event listener for GitHub actions
    const handleGithubAction = (event: CustomEvent) => {
      const { action } = event.detail;
      
      // Set GitHub tab based on the action
      if (action === 'issues') {
        setGithubTab('issues');
      } else if (action === 'pullRequests') {
        setGithubTab('pullRequests');
      } else if (action === 'repositories') {
        setGithubTab('repositories');
      } else if (action === 'newRepo') {
        setGithubTab('repositories');
        setShowNewRepo(true);
      }
    };
    
    // Register event listener
    document.addEventListener('github-action', handleGithubAction as EventListener);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener('github-action', handleGithubAction as EventListener);
    };
  }, [gitService]);

  // Handle branch switching
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

  // Handle branch deletion
  const handleBranchDelete = async (branchName: string) => {
    try {
      await gitService.deleteBranch(branchName);
    } catch (error) {
      console.error('Failed to delete branch:', error);
    }
  };

  // Handle new branch creation
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
  
  // GitHub-specific handlers
  
  // Save GitHub token
  const handleSaveToken = () => {
    if (githubToken) {
      localStorage.setItem('github_token', githubToken);
      setShowTokenInput(false);
      
      // Load GitHub data after saving the token
      if (isGitHubRepo) {
        Promise.all([
          gitService.getGitHubIssues(githubToken),
          gitService.getGitHubPullRequests(githubToken)
        ]).then(([ghIssues, ghPRs]) => {
          setIssues(ghIssues);
          setPullRequests(ghPRs);
        }).catch(error => {
          console.error('Error loading GitHub data:', error);
        });
      }
    }
  };
  
  // Create new GitHub issue
  const handleCreateIssue = async () => {
    if (!newIssueTitle || !githubToken) return;
    
    try {
      const issue = await gitService.createGitHubIssue(
        newIssueTitle,
        newIssueBody,
        githubToken
      );
      
      if (issue) {
        setIssues([issue, ...issues]);
        setNewIssueTitle('');
        setNewIssueBody('');
        setShowNewIssue(false);
      }
    } catch (error) {
      console.error('Failed to create issue:', error);
    }
  };
  
  // Create new GitHub pull request
  const handleCreatePR = async () => {
    if (!newPRTitle || !newPRBase || !newPRHead || !githubToken) return;
    
    try {
      const pr = await gitService.createGitHubPullRequest(
        newPRTitle,
        newPRBody,
        newPRHead,
        newPRBase,
        githubToken
      );
      
      if (pr) {
        setPullRequests([pr, ...pullRequests]);
        setNewPRTitle('');
        setNewPRBody('');
        setNewPRBase('');
        setNewPRHead('');
        setShowNewPR(false);
      }
    } catch (error) {
      console.error('Failed to create pull request:', error);
    }
  };
  
  // Create new GitHub repository
  const handleCreateRepo = async () => {
    if (!newRepoName || !githubToken) return;
    
    try {
      const repo = await gitService.createGitHubRepo(
        newRepoName,
        newRepoDescription,
        newRepoPrivate,
        githubToken
      );
      
      if (repo) {
        setNewRepoName('');
        setNewRepoDescription('');
        setNewRepoPrivate(false);
        setShowNewRepo(false);
        
        // Ask if the local repository should be linked to the new GitHub repository
        const shouldLink = window.confirm(
          `Repository "${repo.name}" was successfully created.\n\nDo you want to link the local repository to the new GitHub repository?`
        );
        
        if (shouldLink) {
          await gitService.linkToGitHubRepo(repo.url);
          setIsGitHubRepo(true);
        }
      }
    } catch (error) {
      console.error('Failed to create repository:', error);
    }
  };
  
  // Clone GitHub repository
  const handleCloneRepo = async () => {
    if (!repoUrl) return;
    
    try {
      // Ask for target directory
      const targetDir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory', {
        title: 'Select target directory for the repository'
      });
      
      if (!targetDir) return;
      
      const success = await GitService.cloneGitHubRepo(repoUrl, targetDir);
      
      if (success) {
        setRepoUrl('');
        setShowCloneRepo(false);
        alert(`Repository was successfully cloned to ${targetDir}.`);
      } else {
        alert('Failed to clone repository.');
      }
    } catch (error) {
      console.error('Failed to clone repository:', error);
      alert(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  // Link repository to GitHub
  const handleLinkRepo = async () => {
    if (!repoUrl) return;
    
    try {
      const success = await gitService.linkToGitHubRepo(repoUrl);
      
      if (success) {
        setRepoUrl('');
        setShowLinkRepo(false);
        setIsGitHubRepo(true);
        alert('Repository was successfully linked.');
      } else {
        alert('Failed to link repository.');
      }
    } catch (error) {
      console.error('Failed to link repository:', error);
      alert(`Failed to link repository: ${error instanceof Error ? error.message : String(error)}`);
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
        {isGitHubRepo && (
          <div className="github-indicator">
            <FaGithub />
            <span>GitHub</span>
          </div>
        )}
      </div>

      <div className="git-content">
        {/* Git section */}
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
            {status.staged.length > 0 && (
              <div className="staged">
                <span className="label">Staged:</span>
                <span className="count">{status.staged.length}</span>
              </div>
            )}
          </div>
        </div>

        {/* GitHub section */}
        <div className="github-section">
          <h3>
            <FaGithub />
            <span>GitHub</span>
            {!showTokenInput && (
              <button 
                className="token-button"
                onClick={() => setShowTokenInput(true)}
                title="Configure GitHub token"
              >
                <FaLock />
              </button>
            )}
          </h3>
          
          {showTokenInput ? (
            <div className="token-input">
              <input
                type="password"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="GitHub Personal Access Token"
              />
              <button onClick={handleSaveToken}>Save</button>
              <button onClick={() => setShowTokenInput(false)}>Cancel</button>
            </div>
          ) : (
            <>
              {/* GitHub tabs */}
              <div className="github-tabs">
                <button 
                  className={`github-tab ${githubTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setGithubTab('overview')}
                >
                  Overview
                </button>
                <button 
                  className={`github-tab ${githubTab === 'issues' ? 'active' : ''}`}
                  onClick={() => setGithubTab('issues')}
                >
                  Issues
                </button>
                <button 
                  className={`github-tab ${githubTab === 'pullRequests' ? 'active' : ''}`}
                  onClick={() => setGithubTab('pullRequests')}
                >
                  Pull Requests
                </button>
                <button 
                  className={`github-tab ${githubTab === 'repositories' ? 'active' : ''}`}
                  onClick={() => setGithubTab('repositories')}
                >
                  Repositories
                </button>
              </div>
              
              {/* Tab contents */}
              <div className="github-tab-content">
                {githubTab === 'overview' && (
                  <div className="github-overview">
                    {isGitHubRepo ? (
                      <>
                        <div className="github-stats">
                          <div className="stat-item">
                            <FaExclamationCircle />
                            <span>{issues.length} Issues</span>
                          </div>
                          <div className="stat-item">
                            <FaArrowAltCircleRight />
                            <span>{pullRequests.length} Pull Requests</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="not-github-repo">
                        <p>This repository is not linked to GitHub.</p>
                        <div className="github-actions">
                          <button onClick={() => setShowLinkRepo(true)}>
                            <FaLink />
                            <span>Link to GitHub</span>
                          </button>
                          <button onClick={() => setShowNewRepo(true)}>
                            <FaGithub />
                            <span>Create new repository</span>
                          </button>
                          <button onClick={() => setShowCloneRepo(true)}>
                            <FaClone />
                            <span>Clone repository</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {githubTab === 'issues' && (
                  <div className="github-issues">
                    {!githubToken ? (
                      <p>GitHub token required to display issues.</p>
                    ) : !isGitHubRepo ? (
                      <p>This repository is not linked to GitHub.</p>
                    ) : (
                      <>
                        <button 
                          className="new-issue-button"
                          onClick={() => setShowNewIssue(true)}
                        >
                          <FaPlus />
                          <span>New Issue</span>
                        </button>
                        
                        {showNewIssue && (
                          <div className="new-issue-form">
                            <input
                              type="text"
                              value={newIssueTitle}
                              onChange={e => setNewIssueTitle(e.target.value)}
                              placeholder="Title"
                              className="issue-title-input"
                            />
                            <textarea
                              value={newIssueBody}
                              onChange={e => setNewIssueBody(e.target.value)}
                              placeholder="Description"
                              className="issue-body-input"
                            />
                            <div className="issue-form-actions">
                              <button onClick={handleCreateIssue}>Create</button>
                              <button onClick={() => setShowNewIssue(false)}>Cancel</button>
                            </div>
                          </div>
                        )}
                        
                        <div className="issues-list">
                          {issues.length === 0 ? (
                            <p>No issues found.</p>
                          ) : (
                            issues.map(issue => (
                              <div key={issue.id} className="issue-item">
                                <div className="issue-header">
                                  <span className="issue-number">#{issue.number}</span>
                                  <span className="issue-title">{issue.title}</span>
                                  <span className={`issue-state ${issue.state}`}>{issue.state}</span>
                                </div>
                                <div className="issue-info">
                                  <span className="issue-user">@{issue.user}</span>
                                  <span className="issue-date">
                                    {new Date(issue.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                
                {githubTab === 'pullRequests' && (
                  <div className="github-prs">
                    {!githubToken ? (
                      <p>GitHub token required to display pull requests.</p>
                    ) : !isGitHubRepo ? (
                      <p>This repository is not linked to GitHub.</p>
                    ) : (
                      <>
                        <button 
                          className="new-pr-button"
                          onClick={() => setShowNewPR(true)}
                        >
                          <FaPlus />
                          <span>New Pull Request</span>
                        </button>
                        
                        {showNewPR && (
                          <div className="new-pr-form">
                            <input
                              type="text"
                              value={newPRTitle}
                              onChange={e => setNewPRTitle(e.target.value)}
                              placeholder="Title"
                              className="pr-title-input"
                            />
                            <textarea
                              value={newPRBody}
                              onChange={e => setNewPRBody(e.target.value)}
                              placeholder="Description"
                              className="pr-body-input"
                            />
                            <div className="pr-branches">
                              <div className="pr-branch-input">
                                <label>Base:</label>
                                <select 
                                  value={newPRBase}
                                  onChange={e => setNewPRBase(e.target.value)}
                                >
                                  <option value="">Select base branch</option>
                                  {branches.map(branch => (
                                    <option key={branch.name} value={branch.name}>
                                      {branch.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="pr-branch-input">
                                <label>Head:</label>
                                <select 
                                  value={newPRHead}
                                  onChange={e => setNewPRHead(e.target.value)}
                                >
                                  <option value="">Select feature branch</option>
                                  {branches.map(branch => (
                                    <option key={branch.name} value={branch.name}>
                                      {branch.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="pr-form-actions">
                              <button onClick={handleCreatePR}>Create</button>
                              <button onClick={() => setShowNewPR(false)}>Cancel</button>
                            </div>
                          </div>
                        )}
                        
                        <div className="prs-list">
                          {pullRequests.length === 0 ? (
                            <p>No pull requests found.</p>
                          ) : (
                            pullRequests.map(pr => (
                              <div key={pr.id} className="pr-item">
                                <div className="pr-header">
                                  <span className="pr-number">#{pr.number}</span>
                                  <span className="pr-title">{pr.title}</span>
                                  <span className={`pr-state ${pr.state}`}>{pr.state}</span>
                                </div>
                                <div className="pr-info">
                                  <span className="pr-user">@{pr.user}</span>
                                  <span className="pr-date">
                                    {new Date(pr.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                                <div className="pr-branches">
                                  <span className="pr-branch">{pr.head} → {pr.base}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
                
                {githubTab === 'repositories' && (
                  <div className="github-repos">
                    {!githubToken ? (
                      <p>GitHub token required to use repository features.</p>
                    ) : (
                      <>
                        <div className="repo-actions">
                          <button onClick={() => setShowNewRepo(true)}>
                            <FaPlus />
                            <span>New Repository</span>
                          </button>
                          <button onClick={() => setShowCloneRepo(true)}>
                            <FaClone />
                            <span>Clone Repository</span>
                          </button>
                          <button onClick={() => setShowLinkRepo(true)}>
                            <FaLink />
                            <span>Link Repository</span>
                          </button>
                        </div>
                        
                        {showNewRepo && (
                          <div className="new-repo-form">
                            <h4>Create new repository</h4>
                            <input
                              type="text"
                              value={newRepoName}
                              onChange={e => setNewRepoName(e.target.value)}
                              placeholder="Repository name"
                              className="repo-name-input"
                            />
                            <textarea
                              value={newRepoDescription}
                              onChange={e => setNewRepoDescription(e.target.value)}
                              placeholder="Description (optional)"
                              className="repo-description-input"
                            />
                            <div className="repo-privacy">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={newRepoPrivate}
                                  onChange={e => setNewRepoPrivate(e.target.checked)}
                                />
                                Private repository
                              </label>
                            </div>
                            <div className="repo-form-actions">
                              <button onClick={handleCreateRepo}>Create</button>
                              <button onClick={() => setShowNewRepo(false)}>Cancel</button>
                            </div>
                          </div>
                        )}
                        
                        {showCloneRepo && (
                          <div className="clone-repo-form">
                            <h4>Clone repository</h4>
                            <input
                              type="text"
                              value={repoUrl}
                              onChange={e => setRepoUrl(e.target.value)}
                              placeholder="Repository URL (https://github.com/username/repo.git)"
                              className="repo-url-input"
                            />
                            <div className="repo-form-actions">
                              <button onClick={handleCloneRepo}>Clone</button>
                              <button onClick={() => setShowCloneRepo(false)}>Cancel</button>
                            </div>
                          </div>
                        )}
                        
                        {showLinkRepo && (
                          <div className="link-repo-form">
                            <h4>Link repository</h4>
                            <input
                              type="text"
                              value={repoUrl}
                              onChange={e => setRepoUrl(e.target.value)}
                              placeholder="Repository URL (https://github.com/username/repo.git)"
                              className="repo-url-input"
                            />
                            <div className="repo-form-actions">
                              <button onClick={handleLinkRepo}>Link</button>
                              <button onClick={() => setShowLinkRepo(false)}>Cancel</button>
                            </div>
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