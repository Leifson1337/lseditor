import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiX, FiDownload, FiTrash2, FiCheckCircle, FiRefreshCw, FiSearch, FiCpu, FiExternalLink, FiZap, FiAlertTriangle } from 'react-icons/fi';
import { SiMeta, SiGoogle, SiAlibabacloud, SiMicrosoft } from 'react-icons/si';
import { LuLoader2 } from 'react-icons/lu';
import { useAI } from '../contexts/AIContext';
import '../styles/ModelManager.css';

interface InstalledModel {
  name: string;
  size?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modified?: string;
}

interface OllamaStatus {
  running: boolean;
  version?: string;
  host?: string;
}

interface PullProgress {
  model: string;
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  done?: boolean;
  error?: string;
}

type FamilyId = 'qwen' | 'llama' | 'google' | 'microsoft' | 'mistral' | 'deepseek' | 'starcoder' | 'generic';

interface CatalogEntry {
  name: string;
  label: string;
  publisher: string;
  description: string;
  size: string;
  family: FamilyId;
  tags: string[];
}

// Visual identity for each model family — brand icon where available, otherwise
// a colored monogram. Keeps the manager looking polished and recognizable.
const FAMILY_META: Record<FamilyId, { color: string; mono: string; icon?: React.ComponentType<{ size?: number; color?: string }> }> = {
  qwen: { color: '#615CED', mono: 'Q', icon: SiAlibabacloud },
  llama: { color: '#0668E1', mono: 'L', icon: SiMeta },
  google: { color: '#4285F4', mono: 'G', icon: SiGoogle },
  microsoft: { color: '#00A4EF', mono: 'P', icon: SiMicrosoft },
  mistral: { color: '#FF7000', mono: 'M' },
  deepseek: { color: '#4D6BFE', mono: 'D' },
  starcoder: { color: '#FCC419', mono: 'S' },
  generic: { color: '#8b919c', mono: '?' }
};

const familyFromName = (name: string): FamilyId => {
  const n = name.toLowerCase();
  if (n.includes('qwen')) return 'qwen';
  if (n.includes('llama')) return 'llama';
  if (n.includes('gemma')) return 'google';
  if (n.includes('phi')) return 'microsoft';
  if (n.includes('mistral') || n.includes('mixtral')) return 'mistral';
  if (n.includes('deepseek')) return 'deepseek';
  if (n.includes('starcoder')) return 'starcoder';
  return 'generic';
};

const ModelIcon: React.FC<{ family: FamilyId; size?: number }> = ({ family, size = 18 }) => {
  const meta = FAMILY_META[family];
  return (
    <span className="mm-model-icon" style={{ background: `${meta.color}22`, color: meta.color }}>
      {meta.icon ? <meta.icon size={size} color={meta.color} /> : <span className="mm-model-mono">{meta.mono}</span>}
    </span>
  );
};

// A curated catalog of strong, commonly-used Ollama models.
const MODEL_CATALOG: CatalogEntry[] = [
  { name: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', publisher: 'Alibaba', description: 'Top-tier open coding model. Best all-round choice for code.', size: '4.7 GB', family: 'qwen', tags: ['coding', 'recommended'] },
  { name: 'qwen2.5-coder:1.5b', label: 'Qwen2.5 Coder 1.5B', publisher: 'Alibaba', description: 'Tiny, fast coder that runs on modest hardware.', size: '1.0 GB', family: 'qwen', tags: ['coding', 'fast'] },
  { name: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', publisher: 'Alibaba', description: 'Larger Qwen coder for high-quality code generation.', size: '9.0 GB', family: 'qwen', tags: ['coding'] },
  { name: 'qwen2.5:7b', label: 'Qwen2.5 7B', publisher: 'Alibaba', description: 'Capable general-purpose assistant.', size: '4.7 GB', family: 'qwen', tags: ['chat'] },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', publisher: 'Meta', description: 'Compact, capable general-purpose chat model.', size: '2.0 GB', family: 'llama', tags: ['chat', 'fast'] },
  { name: 'llama3.2:1b', label: 'Llama 3.2 1B', publisher: 'Meta', description: 'Ultra-light model for very low-end machines.', size: '1.3 GB', family: 'llama', tags: ['chat', 'fast'] },
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B', publisher: 'Meta', description: 'Strong general assistant with broad knowledge.', size: '4.7 GB', family: 'llama', tags: ['chat', 'recommended'] },
  { name: 'deepseek-coder-v2:16b', label: 'DeepSeek Coder V2 16B', publisher: 'DeepSeek', description: 'Powerful coding model for larger machines.', size: '8.9 GB', family: 'deepseek', tags: ['coding'] },
  { name: 'deepseek-r1:7b', label: 'DeepSeek R1 7B', publisher: 'DeepSeek', description: 'Reasoning-focused model with strong chain-of-thought.', size: '4.7 GB', family: 'deepseek', tags: ['reasoning'] },
  { name: 'mistral:7b', label: 'Mistral 7B', publisher: 'Mistral AI', description: 'Fast, efficient generalist model.', size: '4.1 GB', family: 'mistral', tags: ['chat'] },
  { name: 'phi3.5:3.8b', label: 'Phi 3.5 Mini', publisher: 'Microsoft', description: 'Small model with great reasoning per byte.', size: '2.2 GB', family: 'microsoft', tags: ['chat', 'fast'] },
  { name: 'gemma2:9b', label: 'Gemma 2 9B', publisher: 'Google', description: 'Open model with strong instruction following.', size: '5.4 GB', family: 'google', tags: ['chat'] },
  { name: 'gemma2:2b', label: 'Gemma 2 2B', publisher: 'Google', description: 'Lightweight Gemma for fast responses.', size: '1.6 GB', family: 'google', tags: ['chat', 'fast'] },
  { name: 'codegemma:7b', label: 'CodeGemma 7B', publisher: 'Google', description: 'Coding model for fill-in-the-middle and generation.', size: '5.0 GB', family: 'google', tags: ['coding'] },
  { name: 'starcoder2:3b', label: 'StarCoder2 3B', publisher: 'BigCode', description: 'Code completion model trained on permissive sources.', size: '1.7 GB', family: 'starcoder', tags: ['coding', 'fast'] }
];

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const looksLikeTag = (value: string) => /^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$/i.test(value.trim());

// Models pulled via a registry fallback are stored under a prefixed name
// (e.g. "ollama.com/library/qwen2.5-coder:1.5b"). Strip the registry/library
// prefix so catalog entries and installed models line up.
const bareName = (name: string) =>
  name.replace(/^(registry\.ollama\.(ai|com)|ollama\.com)\/(library\/)?/i, '').replace(/^library\//i, '');

interface ModelManagerProps {
  onClose: () => void;
}

export const ModelManager: React.FC<ModelManagerProps> = ({ onClose }) => {
  const { settings, updateSettings, refreshModels } = useAI();

  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [query, setQuery] = useState('');
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'coding' | 'chat'>('all');

  const ipc = (window as any).electron?.ipcRenderer;
  const usingOllama = settings.baseUrl?.includes('11434');

  const checkStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const result: OllamaStatus = await ipc?.invoke('ollama:status');
      setStatus(result || { running: false });
      return result?.running;
    } catch {
      setStatus({ running: false });
      return false;
    } finally {
      setCheckingStatus(false);
    }
  }, [ipc]);

  const loadInstalled = useCallback(async () => {
    setLoadingInstalled(true);
    try {
      const result = await ipc?.invoke('ollama:list');
      setInstalled(result?.models || []);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingInstalled(false);
    }
  }, [ipc]);

  useEffect(() => {
    (async () => {
      const running = await checkStatus();
      if (running) await loadInstalled();
    })();
  }, [checkStatus, loadInstalled]);

  // Subscribe to pull progress events from the main process.
  useEffect(() => {
    if (!ipc?.on) return;
    const handler = (_event: unknown, data: PullProgress) => {
      setPulls(prev => ({ ...prev, [data.model]: data }));
      if (data.done) {
        setBusyModel(current => (current === data.model ? null : current));
        if (data.error) return; // keep the error visible on the card
        loadInstalled();
        setTimeout(() => {
          setPulls(prev => {
            const next = { ...prev };
            delete next[data.model];
            return next;
          });
        }, 2500);
      }
    };
    ipc.on('ollama:pullProgress', handler);
    return () => ipc.removeListener?.('ollama:pullProgress', handler);
  }, [ipc, loadInstalled]);

  const handlePull = useCallback(async (modelName: string) => {
    const name = modelName.trim();
    if (!name) return;
    setErrorText('');
    setBusyModel(name);
    setPulls(prev => ({ ...prev, [name]: { model: name, status: 'starting' } }));
    try {
      const result = await ipc?.invoke('ollama:pull', name);
      if (result && result.ok === false && result.error) {
        setPulls(prev => ({ ...prev, [name]: { model: name, status: 'error', error: result.error, done: true } }));
        setBusyModel(null);
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      setBusyModel(null);
    }
  }, [ipc]);

  const handleCancel = useCallback(async (modelName: string) => {
    try {
      await ipc?.invoke('ollama:cancelPull', modelName);
    } finally {
      setBusyModel(null);
      setPulls(prev => {
        const next = { ...prev };
        delete next[modelName];
        return next;
      });
    }
  }, [ipc]);

  const handleRemove = useCallback(async (modelName: string) => {
    if (!window.confirm(`Remove model "${modelName}"? This deletes the downloaded weights.`)) return;
    try {
      await ipc?.invoke('ollama:remove', modelName);
      await loadInstalled();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }, [ipc, loadInstalled]);

  const handleUse = useCallback((modelName: string) => {
    updateSettings({ baseUrl: OLLAMA_BASE_URL, model: modelName });
    refreshModels();
  }, [updateSettings, refreshModels]);

  // Map of bare model name → actual installed name (which may carry a registry
  // prefix when it was pulled via the ollama.com fallback).
  const installedByBare = useMemo(() => {
    const map = new Map<string, string>();
    installed.forEach(m => map.set(bareName(m.name), m.name));
    return map;
  }, [installed]);
  const isInstalled = useCallback((name: string) => installedByBare.has(bareName(name)), [installedByBare]);
  const actualInstalledName = useCallback((name: string) => installedByBare.get(bareName(name)) || name, [installedByBare]);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredCatalog = useMemo(() => MODEL_CATALOG.filter(entry => {
    if (filter !== 'all' && !entry.tags.includes(filter)) return false;
    if (!normalizedQuery) return true;
    return (
      entry.name.toLowerCase().includes(normalizedQuery) ||
      entry.label.toLowerCase().includes(normalizedQuery) ||
      entry.publisher.toLowerCase().includes(normalizedQuery) ||
      entry.tags.some(tag => tag.includes(normalizedQuery))
    );
  }), [normalizedQuery, filter]);

  // Only as a fallback: when the search yields nothing but looks like a real
  // model tag, offer to pull it directly (search-first, not a custom-entry box).
  const offerDirectPull = filteredCatalog.length === 0 && normalizedQuery.length > 1 && looksLikeTag(query)
    && !isInstalled(query.trim());

  const isNetworkError = (msg?: string) =>
    !!msg && /manifest|connection|timed out|wsarecv|dial|refused|lookup|network|registry/i.test(msg);

  const renderProgress = (modelName: string) => {
    const progress = pulls[modelName];
    if (!progress) return null;
    const pct = progress.total && progress.completed
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : undefined;

    if (progress.error) {
      return (
        <div className="mm-progress error">
          <div className="mm-pull-error">
            <FiAlertTriangle size={13} />
            <div>
              <div className="mm-pull-error-title">Download failed</div>
              <div className="mm-pull-error-msg">{progress.error}</div>
              {isNetworkError(progress.error) && (
                <div className="mm-pull-error-hint">
                  Ollama couldn't reach its model registry. Check your internet connection, VPN, or
                  per-app firewall (e.g. NetLimiter) and allow <code>ollama.exe</code> to access the network.
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    const label = progress.done ? 'Installed' : (progress.status || 'Downloading');
    return (
      <div className={`mm-progress ${progress.done ? 'done' : ''}`}>
        <div className="mm-progress-track">
          <div
            className={`mm-progress-fill ${pct === undefined && !progress.done ? 'indeterminate' : ''}`}
            style={pct !== undefined ? { width: `${pct}%` } : (progress.done ? { width: '100%' } : undefined)}
          />
        </div>
        <div className="mm-progress-meta">
          <span>{label}</span>
          <span>
            {pct !== undefined ? `${pct}%` : ''}
            {progress.total ? ` · ${formatBytes(progress.completed)} / ${formatBytes(progress.total)}` : ''}
          </span>
        </div>
      </div>
    );
  };

  const renderActions = (name: string) => {
    const installedHere = isInstalled(name);
    const actual = actualInstalledName(name);
    const active = usingOllama && (settings.model === name || settings.model === actual);
    const isPulling = busyModel === name || (pulls[name] && !pulls[name].done && !pulls[name].error);
    if (active) return <span className="mm-active-pill"><FiCheckCircle size={13} /> In use</span>;
    if (installedHere) return <button className="mm-use-btn" onClick={() => handleUse(actual)}><FiZap size={13} /> Use</button>;
    if (isPulling) return <button className="mm-cancel-btn" onClick={() => handleCancel(name)}>Cancel</button>;
    return <button className="mm-download-btn" onClick={() => handlePull(name)}><FiDownload size={13} /> Get</button>;
  };

  return (
    <div className="mm-overlay" onClick={onClose}>
      <div className="mm-modal" onClick={e => e.stopPropagation()}>
        <div className="mm-header">
          <div className="mm-header-title">
            <span className="mm-header-icon"><FiCpu size={16} /></span>
            <div className="mm-header-text">
              <span className="mm-header-name">Local Models</span>
              <span className="mm-header-sub">
                {status?.running
                  ? <><span className="mm-dot ok" /> Ollama {status.version} · {installed.length} installed</>
                  : checkingStatus
                    ? <><span className="mm-dot" /> Checking…</>
                    : <><span className="mm-dot off" /> Ollama offline</>}
              </span>
            </div>
          </div>
          <div className="mm-header-actions">
            <button className="mm-icon-btn" title="Refresh" onClick={async () => { const ok = await checkStatus(); if (ok) loadInstalled(); }}>
              <FiRefreshCw size={15} className={checkingStatus || loadingInstalled ? 'mm-spin' : ''} />
            </button>
            <button className="mm-icon-btn" title="Close" onClick={onClose}><FiX size={16} /></button>
          </div>
        </div>

        {!status?.running && !checkingStatus && (
          <div className="mm-offline-banner">
            <p><strong>Ollama is not running.</strong> Local models run entirely on your machine via Ollama — free and offline.</p>
            <ol>
              <li>Install from <span className="mm-link" onClick={() => ipc?.invoke('shell:openExternal', 'https://ollama.com/download')}>ollama.com/download <FiExternalLink size={11} /></span></li>
              <li>Start it, then press <FiRefreshCw size={11} /> Refresh.</li>
            </ol>
          </div>
        )}

        {errorText && <div className="mm-error">{errorText}</div>}

        {status?.running && (
          <>
            <div className="mm-toolbar">
              <div className="mm-search">
                <FiSearch size={15} />
                <input
                  type="text"
                  value={query}
                  placeholder="Search models, publishers, capabilities…"
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
                />
                {query && <button className="mm-search-clear" onClick={() => setQuery('')}><FiX size={13} /></button>}
              </div>
              <div className="mm-filters">
                {(['all', 'coding', 'chat'] as const).map(f => (
                  <button key={f} className={`mm-filter ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'All' : f === 'coding' ? 'Coding' : 'Chat'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mm-body">
              {/* Installed first */}
              {installed.length > 0 && !normalizedQuery && filter === 'all' && (
                <section className="mm-section">
                  <h3 className="mm-section-title">Installed</h3>
                  <div className="mm-list">
                    {installed.map(model => {
                      const fam = familyFromName(model.name);
                      return (
                        <div key={model.name} className={`mm-row ${usingOllama && settings.model === model.name ? 'active' : ''}`}>
                          <ModelIcon family={fam} />
                          <div className="mm-row-info">
                            <span className="mm-row-name">{bareName(model.name)}</span>
                            <span className="mm-row-sub">{[model.parameterSize, model.quantization, formatBytes(model.size)].filter(Boolean).join(' · ') || 'Installed'}</span>
                          </div>
                          <div className="mm-row-actions">
                            {renderActions(model.name)}
                            <button className="mm-icon-btn danger" title="Remove" onClick={() => handleRemove(model.name)}><FiTrash2 size={14} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Catalog */}
              <section className="mm-section">
                <h3 className="mm-section-title">
                  {normalizedQuery || filter !== 'all' ? `Results (${filteredCatalog.length})` : 'Available to download'}
                </h3>

                {filteredCatalog.length === 0 ? (
                  <div className="mm-empty">
                    {offerDirectPull ? (
                      <div className="mm-empty-pull">
                        <span>No catalog match for <code>{query.trim()}</code>.</span>
                        <button className="mm-download-btn" disabled={busyModel === query.trim()} onClick={() => handlePull(query.trim())}>
                          {busyModel === query.trim() ? <LuLoader2 className="mm-spin" /> : <FiDownload size={13} />} Pull this tag
                        </button>
                      </div>
                    ) : (
                      <span>No models match your search.</span>
                    )}
                    {offerDirectPull && renderProgress(query.trim())}
                  </div>
                ) : (
                  <div className="mm-grid">
                    {filteredCatalog.map(entry => (
                      <div key={entry.name} className="mm-card">
                        <div className="mm-card-head">
                          <ModelIcon family={entry.family} size={20} />
                          <div className="mm-card-titles">
                            <span className="mm-card-label">{entry.label}</span>
                            <span className="mm-card-pub">{entry.publisher} · {entry.size}</span>
                          </div>
                        </div>
                        <p className="mm-card-desc">{entry.description}</p>
                        <div className="mm-card-tags">
                          {entry.tags.map(tag => <span key={tag} className={`mm-tag mm-tag-${tag}`}>{tag}</span>)}
                        </div>
                        <div className="mm-card-footer">
                          <code className="mm-card-tagname">{entry.name}</code>
                          {renderActions(entry.name)}
                        </div>
                        {renderProgress(entry.name)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ModelManager;
