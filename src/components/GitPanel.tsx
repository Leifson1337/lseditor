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

interface GitPanelProps {
  workspacePath: string;
}

// Tabs für die verschiedenen GitHub-Funktionen
type GitHubTab = 'overview' | 'issues' | 'pullRequests' | 'repositories';

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
  
  // GitHub-spezifische States
  const [isGitHubRepo, setIsGitHubRepo] = useState<boolean>(false);
  const [githubTab, setGithubTab] = useState<GitHubTab>('overview');
  const [githubToken, setGithubToken] = useState<string>('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
  
  // States für neue GitHub-Elemente
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
        
        // Überprüfen, ob es sich um ein GitHub-Repository handelt
        const isGH = await gitService.isGitHubRepo();
        setIsGitHubRepo(isGH);
        
        // GitHub-Token aus dem lokalen Speicher laden
        const savedToken = localStorage.getItem('github_token');
        if (savedToken) {
          setGithubToken(savedToken);
          
          // Wenn es ein GitHub-Repository ist und ein Token vorhanden ist, lade Issues und PRs
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
    
    // Event-Listener für GitHub-Aktionen
    const handleGithubAction = (event: CustomEvent) => {
      const { action } = event.detail;
      
      // GitHub-Tab entsprechend der Aktion setzen
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
    
    // Event-Listener registrieren
    document.addEventListener('github-action', handleGithubAction as EventListener);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener('github-action', handleGithubAction as EventListener);
    };
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
  
  // GitHub-spezifische Handler
  
  const handleSaveToken = () => {
    if (githubToken) {
      localStorage.setItem('github_token', githubToken);
      setShowTokenInput(false);
      
      // Nach dem Speichern des Tokens, lade GitHub-Daten
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
        
        // Frage, ob das lokale Repository mit dem neuen GitHub-Repository verknüpft werden soll
        const shouldLink = window.confirm(
          `Repository "${repo.name}" wurde erfolgreich erstellt.\n\nMöchten Sie das lokale Repository mit dem neuen GitHub-Repository verknüpfen?`
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
  
  const handleCloneRepo = async () => {
    if (!repoUrl) return;
    
    try {
      // Zielverzeichnis abfragen
      const targetDir = await window.electron?.ipcRenderer.invoke('dialog:openDirectory', {
        title: 'Zielverzeichnis für das Repository auswählen'
      });
      
      if (!targetDir) return;
      
      const success = await GitService.cloneGitHubRepo(repoUrl, targetDir);
      
      if (success) {
        setRepoUrl('');
        setShowCloneRepo(false);
        alert(`Repository wurde erfolgreich nach ${targetDir} geklont.`);
      } else {
        alert('Fehler beim Klonen des Repositories.');
      }
    } catch (error) {
      console.error('Failed to clone repository:', error);
      alert(`Fehler beim Klonen des Repositories: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  const handleLinkRepo = async () => {
    if (!repoUrl) return;
    
    try {
      const success = await gitService.linkToGitHubRepo(repoUrl);
      
      if (success) {
        setRepoUrl('');
        setShowLinkRepo(false);
        setIsGitHubRepo(true);
        alert('Repository wurde erfolgreich verknüpft.');
      } else {
        alert('Fehler beim Verknüpfen des Repositories.');
      }
    } catch (error) {
      console.error('Failed to link repository:', error);
      alert(`Fehler beim Verknüpfen des Repositories: ${error instanceof Error ? error.message : String(error)}`);
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
        {/* Git-Bereich */}
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

        {/* GitHub-Bereich */}
        <div className="github-section">
          <h3>
            <FaGithub />
            <span>GitHub</span>
            {!showTokenInput && (
              <button 
                className="token-button"
                onClick={() => setShowTokenInput(true)}
                title="GitHub Token konfigurieren"
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
              {/* GitHub-Tabs */}
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
              
              {/* Tab-Inhalte */}
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
                        <p>Dieses Repository ist nicht mit GitHub verknüpft.</p>
                        <div className="github-actions">
                          <button onClick={() => setShowLinkRepo(true)}>
                            <FaLink />
                            <span>Mit GitHub verknüpfen</span>
                          </button>
                          <button onClick={() => setShowNewRepo(true)}>
                            <FaGithub />
                            <span>Neues Repository erstellen</span>
                          </button>
                          <button onClick={() => setShowCloneRepo(true)}>
                            <FaClone />
                            <span>Repository klonen</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {githubTab === 'issues' && (
                  <div className="github-issues">
                    {!githubToken ? (
                      <p>GitHub-Token erforderlich, um Issues anzuzeigen.</p>
                    ) : !isGitHubRepo ? (
                      <p>Dieses Repository ist nicht mit GitHub verknüpft.</p>
                    ) : (
                      <>
                        <button 
                          className="new-issue-button"
                          onClick={() => setShowNewIssue(true)}
                        >
                          <FaPlus />
                          <span>Neues Issue</span>
                        </button>
                        
                        {showNewIssue && (
                          <div className="new-issue-form">
                            <input
                              type="text"
                              value={newIssueTitle}
                              onChange={e => setNewIssueTitle(e.target.value)}
                              placeholder="Titel"
                              className="issue-title-input"
                            />
                            <textarea
                              value={newIssueBody}
                              onChange={e => setNewIssueBody(e.target.value)}
                              placeholder="Beschreibung"
                              className="issue-body-input"
                            />
                            <div className="issue-form-actions">
                              <button onClick={handleCreateIssue}>Erstellen</button>
                              <button onClick={() => setShowNewIssue(false)}>Abbrechen</button>
                            </div>
                          </div>
                        )}
                        
                        <div className="issues-list">
                          {issues.length === 0 ? (
                            <p>Keine Issues gefunden.</p>
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
                      <p>GitHub-Token erforderlich, um Pull Requests anzuzeigen.</p>
                    ) : !isGitHubRepo ? (
                      <p>Dieses Repository ist nicht mit GitHub verknüpft.</p>
                    ) : (
                      <>
                        <button 
                          className="new-pr-button"
                          onClick={() => setShowNewPR(true)}
                        >
                          <FaPlus />
                          <span>Neuer Pull Request</span>
                        </button>
                        
                        {showNewPR && (
                          <div className="new-pr-form">
                            <input
                              type="text"
                              value={newPRTitle}
                              onChange={e => setNewPRTitle(e.target.value)}
                              placeholder="Titel"
                              className="pr-title-input"
                            />
                            <textarea
                              value={newPRBody}
                              onChange={e => setNewPRBody(e.target.value)}
                              placeholder="Beschreibung"
                              className="pr-body-input"
                            />
                            <div className="pr-branches">
                              <div className="pr-branch-input">
                                <label>Base:</label>
                                <select 
                                  value={newPRBase}
                                  onChange={e => setNewPRBase(e.target.value)}
                                >
                                  <option value="">Basis-Branch auswählen</option>
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
                                  <option value="">Feature-Branch auswählen</option>
                                  {branches.map(branch => (
                                    <option key={branch.name} value={branch.name}>
                                      {branch.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="pr-form-actions">
                              <button onClick={handleCreatePR}>Erstellen</button>
                              <button onClick={() => setShowNewPR(false)}>Abbrechen</button>
                            </div>
                          </div>
                        )}
                        
                        <div className="prs-list">
                          {pullRequests.length === 0 ? (
                            <p>Keine Pull Requests gefunden.</p>
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
                      <p>GitHub-Token erforderlich, um Repository-Funktionen zu nutzen.</p>
                    ) : (
                      <>
                        <div className="repo-actions">
                          <button onClick={() => setShowNewRepo(true)}>
                            <FaPlus />
                            <span>Neues Repository</span>
                          </button>
                          <button onClick={() => setShowCloneRepo(true)}>
                            <FaClone />
                            <span>Repository klonen</span>
                          </button>
                          <button onClick={() => setShowLinkRepo(true)}>
                            <FaLink />
                            <span>Repository verknüpfen</span>
                          </button>
                        </div>
                        
                        {showNewRepo && (
                          <div className="new-repo-form">
                            <h4>Neues Repository erstellen</h4>
                            <input
                              type="text"
                              value={newRepoName}
                              onChange={e => setNewRepoName(e.target.value)}
                              placeholder="Repository-Name"
                              className="repo-name-input"
                            />
                            <textarea
                              value={newRepoDescription}
                              onChange={e => setNewRepoDescription(e.target.value)}
                              placeholder="Beschreibung (optional)"
                              className="repo-description-input"
                            />
                            <div className="repo-privacy">
                              <label>
                                <input
                                  type="checkbox"
                                  checked={newRepoPrivate}
                                  onChange={e => setNewRepoPrivate(e.target.checked)}
                                />
                                Privates Repository
                              </label>
                            </div>
                            <div className="repo-form-actions">
                              <button onClick={handleCreateRepo}>Erstellen</button>
                              <button onClick={() => setShowNewRepo(false)}>Abbrechen</button>
                            </div>
                          </div>
                        )}
                        
                        {showCloneRepo && (
                          <div className="clone-repo-form">
                            <h4>Repository klonen</h4>
                            <input
                              type="text"
                              value={repoUrl}
                              onChange={e => setRepoUrl(e.target.value)}
                              placeholder="Repository-URL (https://github.com/username/repo.git)"
                              className="repo-url-input"
                            />
                            <div className="repo-form-actions">
                              <button onClick={handleCloneRepo}>Klonen</button>
                              <button onClick={() => setShowCloneRepo(false)}>Abbrechen</button>
                            </div>
                          </div>
                        )}
                        
                        {showLinkRepo && (
                          <div className="link-repo-form">
                            <h4>Repository verknüpfen</h4>
                            <input
                              type="text"
                              value={repoUrl}
                              onChange={e => setRepoUrl(e.target.value)}
                              placeholder="Repository-URL (https://github.com/username/repo.git)"
                              className="repo-url-input"
                            />
                            <div className="repo-form-actions">
                              <button onClick={handleLinkRepo}>Verknüpfen</button>
                              <button onClick={() => setShowLinkRepo(false)}>Abbrechen</button>
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