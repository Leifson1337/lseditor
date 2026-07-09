import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiGitBranch, FiRefreshCw, FiUpload, FiDownload, FiPlus, FiMinus,
  FiRotateCcw, FiCheck, FiChevronDown, FiX, FiGitCommit,
  FiGithub, FiExternalLink, FiGitPullRequest, FiLogOut
} from 'react-icons/fi';
import './GitPanel.css';

interface GitHubAuth {
  authenticated: boolean;
  login?: string;
  name?: string;
  avatarUrl?: string;
  error?: string;
}

interface GitHubRepo { owner: string; repo: string; url?: string; }

interface PullRequest {
  number: number;
  title: string;
  author?: string;
  head?: string;
  base?: string;
  url: string;
  draft?: boolean;
}

interface PromptField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'password';
}
interface PromptConfig {
  title: string;
  fields: PromptField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
}

// A small input modal — replaces window.prompt(), which Electron disables.
const PromptModal: React.FC<{ config: PromptConfig; onClose: () => void }> = ({ config, onClose }) => {
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(config.fields.map(f => [f.key, f.value]))
  );
  const submit = () => { config.onSubmit(values); onClose(); };
  return (
    <div className="git-prompt-overlay" onClick={onClose}>
      <div className="git-prompt-modal" onClick={e => e.stopPropagation()}>
        <div className="git-prompt-title">{config.title}</div>
        {config.fields.map((f, i) => (
          <label key={f.key} className="git-prompt-field">
            <span>{f.label}</span>
            <input
              type={f.type || 'text'}
              autoFocus={i === 0}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
            />
          </label>
        ))}
        <div className="git-prompt-actions">
          <button className="git-btn" onClick={onClose}>Cancel</button>
          <button className="git-btn primary" onClick={submit}>{config.submitLabel}</button>
        </div>
      </div>
    </div>
  );
};

interface GitChange {
  path: string;
  type: string;
}

interface GitStatus {
  isRepo: boolean;
  current?: string;
  tracking?: string;
  ahead?: number;
  behind?: number;
  staged?: GitChange[];
  unstaged?: GitChange[];
  conflicted?: string[];
  error?: string;
}

interface GitPanelProps {
  projectPath?: string;
  onOpenFile?: (path: string) => void;
}

const ipc = () => (window as any).electron?.ipcRenderer;

const typeBadge = (type: string): string => {
  switch (type) {
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'conflicted': return 'U';
    case 'copied': return 'C';
    default: return 'M';
  }
};

const fileName = (p: string) => p.split(/[\\/]/).pop() || p;
const fileDir = (p: string) => {
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
};

export const GitPanel: React.FC<GitPanelProps> = ({ projectPath, onOpenFile }) => {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null);
  const [gh, setGh] = useState<GitHubAuth | null>(null);
  const [ghRepo, setGhRepo] = useState<GitHubRepo | null>(null);
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [ghBusy, setGhBusy] = useState('');
  const [ghError, setGhError] = useState('');
  // Electron disables window.prompt(), so we use our own input modal instead.
  const [prompt, setPrompt] = useState<PromptConfig | null>(null);

  const cwd = projectPath?.trim() || undefined;

  const refresh = useCallback(async () => {
    if (!cwd || !ipc()) return;
    setLoading(true);
    try {
      const result: GitStatus = await ipc().invoke('git:status', cwd);
      setStatus(result);
      setError(result?.error || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadBranches = useCallback(async () => {
    if (!cwd) return;
    try {
      const result = await ipc()?.invoke('git:branches', cwd);
      setBranches(result?.all || []);
    } catch { /* ignore */ }
  }, [cwd]);

  const run = useCallback(async (label: string, channel: string, ...args: any[]) => {
    if (!cwd) return;
    setBusy(label);
    setError('');
    try {
      const res = await ipc()?.invoke(channel, cwd, ...args);
      if (res && res.ok === false) setError(res.error || `${label} failed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [cwd, refresh]);

  const handleCommit = useCallback(async () => {
    if (!message.trim()) return;
    await run('Committing', 'git:commit', message.trim());
    setMessage('');
  }, [message, run]);

  const openDiff = useCallback(async (file: string, staged: boolean) => {
    if (!cwd) return;
    try {
      const text = await ipc()?.invoke('git:diff', cwd, file, staged);
      setDiff({ file, text: text || '(no diff available)' });
    } catch { /* ignore */ }
  }, [cwd]);

  // ── GitHub ──
  const loadPulls = useCallback(async (repo: GitHubRepo) => {
    try {
      const res = await ipc()?.invoke('github:pulls', repo.owner, repo.repo);
      if (res?.ok) setPulls(res.pulls || []);
      else setGhError(res?.error || '');
    } catch { /* ignore */ }
  }, []);

  const loadGithub = useCallback(async () => {
    if (!ipc()) return;
    try {
      const auth: GitHubAuth = await ipc().invoke('github:status');
      setGh(auth);
      if (cwd) {
        const repo: GitHubRepo | null = await ipc().invoke('github:repoFromRemote', cwd);
        setGhRepo(repo);
        if (auth?.authenticated && repo) await loadPulls(repo);
        else setPulls([]);
      }
    } catch { /* ignore */ }
  }, [cwd, loadPulls]);

  useEffect(() => { loadGithub(); }, [loadGithub]);

  const connectWithToken = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setGhBusy('connect');
    setGhError('');
    try {
      const res = await ipc()?.invoke('github:setToken', token.trim());
      if (res?.ok) await loadGithub();
      else setGhError(res?.error || 'Authentication failed');
    } finally {
      setGhBusy('');
    }
  }, [loadGithub]);

  const handleConnect = useCallback(() => {
    setPrompt({
      title: 'Connect GitHub',
      submitLabel: 'Connect',
      fields: [{ key: 'token', label: 'Personal Access Token (scope: repo)', value: '', placeholder: 'ghp_…', type: 'password' }],
      onSubmit: values => { void connectWithToken(values.token || ''); }
    });
  }, [connectWithToken]);

  const handleSignOut = useCallback(async () => {
    await ipc()?.invoke('github:clearToken');
    setGh({ authenticated: false });
    setPulls([]);
  }, []);

  const submitCreatePR = useCallback(async (title: string, base: string) => {
    if (!ghRepo || !status?.current || !title.trim() || !base.trim()) return;
    setGhBusy('pr');
    setGhError('');
    try {
      const res = await ipc()?.invoke('github:createPull', ghRepo.owner, ghRepo.repo, {
        title: title.trim(),
        head: status.current,
        base: base.trim()
      });
      if (res?.ok) {
        await loadPulls(ghRepo);
        if (res.url) ipc()?.invoke('shell:openExternal', res.url);
      } else {
        setGhError(res?.error || 'Failed to create pull request');
      }
    } finally {
      setGhBusy('');
    }
  }, [ghRepo, status, loadPulls]);

  const handleCreatePR = useCallback(() => {
    if (!ghRepo || !status?.current) return;
    setPrompt({
      title: 'Create Pull Request',
      submitLabel: 'Create',
      fields: [
        { key: 'title', label: 'Title', value: `Update from ${status.current}`, placeholder: 'Pull request title' },
        { key: 'base', label: 'Base branch (merge into)', value: 'main', placeholder: 'main' }
      ],
      onSubmit: values => { void submitCreatePR(values.title || '', values.base || ''); }
    });
  }, [ghRepo, status, submitCreatePR]);

  const openExternal = useCallback((url: string) => { ipc()?.invoke('shell:openExternal', url); }, []);

  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];
  const canCommit = staged.length > 0 && message.trim().length > 0 && !busy;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  const diffLines = useMemo(() => (diff ? diff.text.split('\n') : []), [diff]);

  if (!cwd) {
    return <div className="git-panel git-empty">Open a folder to use source control.</div>;
  }

  if (status && status.isRepo === false) {
    return (
      <div className="git-panel git-empty">
        <FiGitBranch size={28} />
        <p>This folder is not a Git repository.</p>
        <button className="git-btn primary" disabled={!!busy} onClick={() => run('Initializing', 'git:init')}>
          {busy ? 'Initializing…' : 'Initialize Repository'}
        </button>
        {error && <div className="git-error">{error}</div>}
      </div>
    );
  }

  const renderChange = (change: GitChange, area: 'staged' | 'unstaged') => (
    <div key={`${area}-${change.path}`} className={`git-file type-${change.type}`}>
      <span className={`git-type-badge t-${change.type}`}>{typeBadge(change.type)}</span>
      <button
        className="git-file-name"
        title={change.path}
        onClick={() => { openDiff(change.path, area === 'staged'); }}
        onDoubleClick={() => onOpenFile?.(cwd ? `${cwd}/${change.path}` : change.path)}
      >
        <span className="git-file-base">{fileName(change.path)}</span>
        <span className="git-file-dir">{fileDir(change.path)}</span>
      </button>
      <div className="git-file-actions">
        {area === 'unstaged' && (
          <button title="Discard changes" className="git-icon-btn" onClick={() => {
            if (window.confirm(`Discard changes to ${change.path}? This cannot be undone.`)) run('Discarding', 'git:discard', [change.path]);
          }}><FiRotateCcw size={13} /></button>
        )}
        <button
          title={area === 'staged' ? 'Unstage' : 'Stage'}
          className="git-icon-btn"
          onClick={() => run(area === 'staged' ? 'Unstaging' : 'Staging', area === 'staged' ? 'git:unstage' : 'git:stage', [change.path])}
        >
          {area === 'staged' ? <FiMinus size={13} /> : <FiPlus size={13} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="git-panel">
      <div className="git-header">
        <div className="git-branch" onClick={() => { setShowBranches(v => !v); if (!showBranches) loadBranches(); }}>
          <FiGitBranch size={14} />
          <span className="git-branch-name">{status?.current || '—'}</span>
          <FiChevronDown size={12} />
          {(ahead > 0 || behind > 0) && (
            <span className="git-sync-counts">
              {behind > 0 && <span>↓{behind}</span>}
              {ahead > 0 && <span>↑{ahead}</span>}
            </span>
          )}
        </div>
        <div className="git-header-actions">
          <button className="git-icon-btn" title="Fetch" disabled={!!busy} onClick={() => run('Fetching', 'git:fetch')}><FiRefreshCw size={14} className={busy === 'Fetching' ? 'spin' : ''} /></button>
          <button className="git-icon-btn" title="Pull" disabled={!!busy} onClick={() => run('Pulling', 'git:pull')}><FiDownload size={14} /></button>
          <button className="git-icon-btn" title="Push" disabled={!!busy} onClick={() => run('Pushing', 'git:push')}><FiUpload size={14} /></button>
          <button className="git-icon-btn" title="Refresh" disabled={loading} onClick={refresh}><FiRotateCcw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
      </div>

      {showBranches && (
        <div className="git-branch-list">
          {branches.length === 0 && <div className="git-branch-empty">No branches</div>}
          {branches.map(b => (
            <button key={b} className={`git-branch-item ${b === status?.current ? 'active' : ''}`}
              onClick={() => { setShowBranches(false); if (b !== status?.current) run('Switching branch', 'git:checkout', b); }}>
              {b === status?.current && <FiCheck size={12} />} {b}
            </button>
          ))}
          <button className="git-branch-item new" onClick={() => {
            setShowBranches(false);
            setPrompt({
              title: 'Create New Branch',
              submitLabel: 'Create',
              fields: [{ key: 'name', label: 'Branch name', value: '', placeholder: 'feature/my-branch' }],
              onSubmit: values => { if (values.name?.trim()) run('Creating branch', 'git:createBranch', values.name.trim()); }
            });
          }}><FiPlus size={12} /> Create new branch…</button>
        </div>
      )}

      <div className="git-commit-box">
        <textarea
          placeholder={`Message (commit on ${status?.current || 'branch'})`}
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={2}
        />
        <button className="git-btn primary git-commit-btn" disabled={!canCommit} onClick={handleCommit}>
          <FiGitCommit size={14} /> {busy === 'Committing' ? 'Committing…' : `Commit${staged.length ? ` (${staged.length})` : ''}`}
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      <div className="git-changes">
        {staged.length > 0 && (
          <div className="git-section">
            <div className="git-section-head">
              <span>Staged Changes</span>
              <div className="git-section-actions">
                <span className="git-count">{staged.length}</span>
                <button className="git-icon-btn" title="Unstage all" onClick={() => run('Unstaging all', 'git:unstageAll')}><FiMinus size={13} /></button>
              </div>
            </div>
            {staged.map(c => renderChange(c, 'staged'))}
          </div>
        )}

        <div className="git-section">
          <div className="git-section-head">
            <span>Changes</span>
            <div className="git-section-actions">
              <span className="git-count">{unstaged.length}</span>
              {unstaged.length > 0 && (
                <button className="git-icon-btn" title="Stage all" onClick={() => run('Staging all', 'git:stageAll')}><FiPlus size={13} /></button>
              )}
            </div>
          </div>
          {unstaged.length === 0 && staged.length === 0 && (
            <div className="git-clean">No changes — working tree clean.</div>
          )}
          {unstaged.map(c => renderChange(c, 'unstaged'))}
        </div>
      </div>

      {/* GitHub */}
      <div className="git-github">
        <div className="git-section-head git-github-head">
          <span><FiGithub size={12} /> GitHub</span>
          {gh?.authenticated && (
            <div className="git-section-actions">
              <span className="git-gh-user" title={gh.name || gh.login}>@{gh.login}</span>
              <button className="git-icon-btn" title="Sign out of GitHub" onClick={handleSignOut}><FiLogOut size={13} /></button>
            </div>
          )}
        </div>

        {!gh?.authenticated ? (
          <div className="git-gh-connect">
            <button className="git-btn primary" disabled={ghBusy === 'connect'} onClick={handleConnect}>
              <FiGithub size={14} /> {ghBusy === 'connect' ? 'Connecting…' : 'Connect GitHub'}
            </button>
            <span className="git-gh-hint">Sign in with a Personal Access Token to see and create pull requests.</span>
          </div>
        ) : !ghRepo ? (
          <div className="git-gh-hint git-gh-pad">Connected as @{gh.login}. No GitHub remote detected for this repo.</div>
        ) : (
          <div className="git-gh-pr">
            <div className="git-gh-pr-bar">
              <span className="git-gh-repo" title={`${ghRepo.owner}/${ghRepo.repo}`}>{ghRepo.owner}/{ghRepo.repo}</span>
              <div className="git-section-actions">
                <button className="git-icon-btn" title="Refresh pull requests" onClick={() => loadPulls(ghRepo)}><FiRefreshCw size={13} /></button>
                <button className="git-btn primary git-gh-newpr" disabled={ghBusy === 'pr'} onClick={handleCreatePR}>
                  <FiGitPullRequest size={13} /> {ghBusy === 'pr' ? 'Creating…' : 'New PR'}
                </button>
              </div>
            </div>
            {pulls.length === 0 ? (
              <div className="git-gh-hint git-gh-pad">No open pull requests.</div>
            ) : (
              pulls.map(pr => (
                <button key={pr.number} className="git-gh-pr-item" onClick={() => openExternal(pr.url)} title={pr.title}>
                  <FiGitPullRequest size={13} className={pr.draft ? 'draft' : 'open'} />
                  <span className="git-gh-pr-title">{pr.title}</span>
                  <span className="git-gh-pr-meta">#{pr.number}</span>
                  <FiExternalLink size={11} />
                </button>
              ))
            )}
          </div>
        )}
        {ghError && <div className="git-error">{ghError}</div>}
      </div>

      {prompt && <PromptModal config={prompt} onClose={() => setPrompt(null)} />}

      {diff && (
        <div className="git-diff-overlay" onClick={() => setDiff(null)}>
          <div className="git-diff-modal" onClick={e => e.stopPropagation()}>
            <div className="git-diff-head">
              <span title={diff.file}>{fileName(diff.file)}</span>
              <button className="git-icon-btn" onClick={() => setDiff(null)}><FiX size={15} /></button>
            </div>
            <pre className="git-diff-body">
              {diffLines.map((line, i) => {
                let cls = '';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
                else if (line.startsWith('@@')) cls = 'hunk';
                else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls = 'meta';
                return <div key={i} className={`git-diff-line ${cls}`}>{line || ' '}</div>;
              })}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default GitPanel;
