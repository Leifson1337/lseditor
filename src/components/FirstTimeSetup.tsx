import React, { useCallback, useEffect, useMemo, useState } from 'react';

export type BackendChoice = 'ollama' | 'lmstudio' | 'none';

interface GpuInfo {
  hasDedicatedGPU: boolean;
  name: string;
  vramGB: number;
  vramMB: number;
}

type SetupContextScenario =
  | 'ollama-detected'
  | 'lmstudio-detected'
  | 'both-installed'
  | 'ollama-only-installed'
  | 'lm-only-installed'
  | 'no-backend'
  | 'insufficient-hardware';

interface FirstSetupBridge {
  getGpuInfo: () => Promise<GpuInfo>;
  getSetupContext?: () => Promise<{
    scenario: SetupContextScenario;
    canDownloadOllama: boolean;
    ollamaDetected: boolean;
    detectedModels: string[];
    parallel?: {
      ollama: { installed: boolean; running: boolean; baseURL: string | null };
      lmstudio: { installed: boolean; running: boolean; baseURL: string | null };
    } | null;
  }>;
  getOllamaModels?: () => Promise<{ reachable: boolean; models: string[] }>;
  download: (type: 'ollama' | 'lmstudio') => Promise<string>;
  installOllama: (installerPath: string) => Promise<void>;
  revealInFolder: (filePath: string) => Promise<void>;
  openLmStudioPage: () => Promise<void>;
  complete: (payload: { choice: BackendChoice; preferredDefaultModel: string }) => Promise<void>;
  onDownloadProgress: (cb: (data: { loaded: number; total: number | null; status: string }) => void) => () => void;
}

type WizardStep =
  | 'choice'
  | 'ollama-download'
  | 'ollama-install'
  | 'lm-download'
  | 'lm-manual'
  | 'error';

interface ParallelInstallInfo {
  ollama: { installed: boolean; running: boolean; baseURL: string | null };
  lmstudio: { installed: boolean; running: boolean; baseURL: string | null };
}

/** Default Ollama API when a local daemon listens on the standard port. */
const OLLAMA_DEFAULT_ORIGIN = 'http://localhost:11434';

/** Rough minimum VRAM (GB) for common Ollama tags; real usage depends on quant and context. */
const MODEL_VRAM_HINT_GB: Record<string, number> = {
  'phi3:mini': 2.2,
  'llama3.2': 2.8,
  'llama3.2:1b': 1.2,
  'llama3.2:3b': 2.2,
  mistral: 4.5,
  'mistral:latest': 4.5
};

const DOWNLOAD_MODEL_OPTIONS = [
  { value: 'phi3:mini', label: 'phi3:mini' },
  { value: 'llama3.2', label: 'llama3.2' }
];

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    padding: 24,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: 'radial-gradient(ellipse at top, #1e293b 0%, #0f172a 45%, #020617 100%)',
    color: '#e2e8f0'
  },
  card: {
    maxWidth: 480,
    margin: '0 auto',
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 24px 48px rgba(0,0,0,0.45)'
  },
  title: { fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: '#f8fafc' },
  subtitle: { fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 },
  gpuBox: {
    background: 'rgba(56, 189, 248, 0.08)',
    border: '1px solid rgba(56, 189, 248, 0.25)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18
  },
  gpuTitle: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#38bdf8', marginBottom: 6 },
  gpuText: { fontSize: 15, fontWeight: 500 },
  recommend: { fontSize: 14, color: '#cbd5e1', marginBottom: 16, lineHeight: 1.45 },
  btnRow: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  btn: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: 'none',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    color: '#fff'
  },
  btnSecondary: {
    background: 'rgba(148, 163, 184, 0.15)',
    color: '#e2e8f0',
    border: '1px solid rgba(148, 163, 184, 0.35)'
  },
  btnGhost: {
    background: 'transparent',
    color: '#94a3b8',
    border: '1px solid transparent'
  },
  selectLabel: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  select: {
    width: '100%',
    padding: 10,
    borderRadius: 8,
    border: '1px solid rgba(148, 163, 184, 0.3)',
    background: '#0f172a',
    color: '#e2e8f0',
    marginBottom: 16
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    background: 'rgba(148, 163, 184, 0.2)',
    overflow: 'hidden',
    marginTop: 12
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #38bdf8, #a78bfa)',
    borderRadius: 999,
    transition: 'width 0.2s ease'
  },
  status: { fontSize: 12, color: '#94a3b8', marginTop: 8, minHeight: 36 },
  err: { color: '#f87171', fontSize: 13, marginTop: 8 }
};

export const FirstTimeSetup: React.FC = () => {
  const api = window.firstSetup as FirstSetupBridge | undefined;
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>('choice');
  const [preferredModel, setPreferredModel] = useState(DOWNLOAD_MODEL_OPTIONS[0]!.value);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [lmPath, setLmPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scenario, setScenario] = useState<SetupContextScenario>('no-backend');
  const [parallelInfo, setParallelInfo] = useState<ParallelInstallInfo | null>(null);
  const [canDownloadOllama, setCanDownloadOllama] = useState(false);
  const [ollamaTagModels, setOllamaTagModels] = useState<string[] | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);

  const refreshLocalModels = useCallback(async () => {
    if (!api) return;
    setIsRefreshingModels(true);
    try {
      // Prefer the IPC bridge which uses dynamic port detection (findOllamaListeningPort)
      // so that non-default Ollama ports are handled correctly.
      if (api.getOllamaModels) {
        const result = await api.getOllamaModels();
        setOllamaReachable(result.reachable);
        setOllamaTagModels(result.models);
      } else {
        // Fallback: direct fetch against the default origin
        const response = await fetch(`${OLLAMA_DEFAULT_ORIGIN}/api/tags`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { models?: { name?: string }[] };
        const names = (data.models ?? []).map(m => m.name).filter((n): n is string => Boolean(n));
        setOllamaReachable(true);
        setOllamaTagModels(names);
      }
    } catch {
      setOllamaReachable(false);
      setOllamaTagModels([]);
    } finally {
      setIsRefreshingModels(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setLoadError('IPC bridge unavailable.');
      return;
    }
    const load = async () => {
      try {
        if (api.getSetupContext) {
          const ctx = await api.getSetupContext();
          setScenario(ctx.scenario);
          setCanDownloadOllama(Boolean(ctx.canDownloadOllama));
          if (ctx.parallel) {
            setParallelInfo({
              ollama: ctx.parallel.ollama,
              lmstudio: ctx.parallel.lmstudio
            });
          } else {
            setParallelInfo(null);
          }
          if (Array.isArray(ctx.detectedModels) && ctx.detectedModels.length > 0) {
            setOllamaReachable(true);
            setOllamaTagModels(ctx.detectedModels);
          }
        }
        const g = await api.getGpuInfo();
        setGpu(g);
        if (!api.getSetupContext) {
          setCanDownloadOllama(g.hasDedicatedGPU);
        }
        await refreshLocalModels();
      } catch (e) {
        setLoadError(String(e));
      }
    };
    void load();
  }, [api, refreshLocalModels]);

  const modelOptions = useMemo(() => {
    if (Array.isArray(ollamaTagModels) && ollamaTagModels.length > 0) {
      return ollamaTagModels.map(name => ({ value: name, label: name }));
    }
    return DOWNLOAD_MODEL_OPTIONS;
  }, [ollamaTagModels]);

  useEffect(() => {
    if (Array.isArray(ollamaTagModels) && ollamaTagModels.length > 0) {
      if (ollamaTagModels.includes(preferredModel)) return;
      setPreferredModel(ollamaTagModels[0]!);
      return;
    }
    if (DOWNLOAD_MODEL_OPTIONS.some(o => o.value === preferredModel)) return;
    setPreferredModel(DOWNLOAD_MODEL_OPTIONS[0]!.value);
  }, [ollamaTagModels, preferredModel]);

  const estimatedVramGb = useMemo(() => {
    return (
      MODEL_VRAM_HINT_GB[preferredModel] ??
      MODEL_VRAM_HINT_GB[(preferredModel || '').split(':')[0] ?? ''] ??
      null
    );
  }, [preferredModel]);

  const finish = useCallback(
    async (choice: BackendChoice) => {
      if (!api) return;
      await api.complete({ choice, preferredDefaultModel: preferredModel });
    },
    [api, preferredModel]
  );

  const onInstallOllama = useCallback(async () => {
    if (!api) return;
    if (!canDownloadOllama) {
      setErr('Ollama download is disabled on this system.');
      setStep('error');
      return;
    }
    setErr(null);
    setStep('ollama-download');
    setStatus('Downloading Ollama…');
    setProgress(0);
    const unsub = api.onDownloadProgress(({ loaded, total, status: s }) => {
      setStatus(s);
      if (total && total > 0) {
        setProgress(Math.min(100, Math.round((100 * loaded) / total)));
      }
    });
    try {
      const p = await api.download('ollama');
      unsub();
      setStep('ollama-install');
      setStatus('Running silent install (/S)…');
      await api.installOllama(p);
      setStatus('Installation complete.');
      await finish('ollama');
    } catch (e) {
      unsub();
      setErr(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }, [api, canDownloadOllama, finish]);

  const onInstallLmStudio = useCallback(async () => {
    if (!api) return;
    setErr(null);
    setStep('lm-download');
    setStatus('Downloading LM Studio…');
    setProgress(0);
    const unsub = api.onDownloadProgress(({ loaded, total, status: s }) => {
      setStatus(s);
      if (total && total > 0) {
        setProgress(Math.min(100, Math.round((100 * loaded) / total)));
      }
    });
    try {
      const p = await api.download('lmstudio');
      unsub();
      setLmPath(p);
      await api.revealInFolder(p);
      setStep('lm-manual');
      setStatus('');
    } catch (e) {
      unsub();
      await api.openLmStudioPage();
      setStep('lm-manual');
      setLmPath(null);
      setStatus(
        'Automatic download failed. Opened the LM Studio website — download the installer manually, then click Continue.'
      );
    }
  }, [api]);

  const onSkip = useCallback(() => {
    void finish('none');
  }, [finish]);

  if (loadError) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <p style={styles.err}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (!gpu) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <p style={styles.subtitle}>Loading…</p>
        </div>
      </div>
    );
  }

  const isNoBackend = scenario === 'no-backend';
  const isOllamaDetected = scenario === 'ollama-detected';
  const isInsufficientHardware = scenario === 'insufficient-hardware';
  const isBothInstalled = scenario === 'both-installed';
  const isOllamaOnlyInstalled = scenario === 'ollama-only-installed';
  const isLmOnlyInstalled = scenario === 'lm-only-installed';
  const hasLocalModels = Array.isArray(ollamaTagModels) && ollamaTagModels.length > 0;
  const localModelsEmpty = Array.isArray(ollamaTagModels) && ollamaTagModels.length === 0 && ollamaReachable;

  const titleText = isOllamaDetected
    ? 'Ollama detected'
    : isInsufficientHardware
      ? 'Insufficient resources'
      : isBothInstalled
        ? 'Choose your local backend'
        : isOllamaOnlyInstalled
          ? 'Ollama is installed'
          : isLmOnlyInstalled
            ? 'LM Studio is installed'
            : isNoBackend
              ? 'No AI backend found'
              : 'Local AI setup';

  const subtitleText = isOllamaDetected ? (
    <>We detected Ollama on this system. You can continue with local model selection.</>
  ) : isInsufficientHardware ? (
    <>
      This system may not meet the recommended specs for local inference. Open the app and configure AI from Settings.
    </>
  ) : isBothInstalled ? (
    <>
      Both Ollama and LM Studio are installed. Choose which one LS Editor should use for local inference (you can change
      this later in settings).{' '}
      {parallelInfo ? (
        <>
          Ollama: {parallelInfo.ollama.running ? 'server running' : 'not running yet'} · LM Studio:{' '}
          {parallelInfo.lmstudio.running ? 'server running' : 'not running yet'}.
        </>
      ) : null}
    </>
  ) : isOllamaOnlyInstalled ? (
    <>
      Ollama is installed; LM Studio is not. Continue with Ollama or install LM Studio (GUI, GGUF models, OpenAI-compatible
      server).
    </>
  ) : isLmOnlyInstalled ? (
    <>
      LM Studio is installed; Ollama is not. Continue with LM Studio or install Ollama (CLI, `ollama pull`, port 11434).
    </>
  ) : isNoBackend ? (
    <>
      No AI backend was installed. Your system has {gpu.name || 'unknown hardware'} with {gpu.vramGB} GB VRAM. We recommend
      installing a local inference backend:
    </>
  ) : (
    'For best performance with local AI, we recommend installing an inference backend on this system.'
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>{titleText}</h1>
        <p style={styles.subtitle}>{subtitleText}</p>

        <div style={styles.gpuBox}>
          <div style={styles.gpuTitle}>Hardware</div>
          <div style={styles.gpuText}>
            {gpu.name || '—'} · {gpu.vramGB} GB VRAM
          </div>
        </div>

        <div style={styles.selectLabel}>{hasLocalModels ? 'Local models detected' : 'Model to download'}</div>
        {ollamaTagModels === null && (
          <p style={{ ...styles.subtitle, marginTop: -12, marginBottom: 8, fontSize: 11 }}>
            Checking local Ollama at {OLLAMA_DEFAULT_ORIGIN}…
          </p>
        )}
        {hasLocalModels && (
          <p style={{ ...styles.subtitle, marginTop: -12, marginBottom: 8, fontSize: 11, color: '#6ee7b7' }}>
            Loaded {ollamaTagModels.length} model(s) from local Ollama ({OLLAMA_DEFAULT_ORIGIN}/api/tags).
          </p>
        )}
        {localModelsEmpty && (
          <p style={{ ...styles.subtitle, marginTop: -12, marginBottom: 8, fontSize: 11 }}>
            Run <code>ollama pull [model]</code> in a terminal or pick a model to download below.
          </p>
        )}
        {localModelsEmpty && (
          <button
            type="button"
            style={{ ...styles.btn, ...styles.btnSecondary, marginBottom: 10 }}
            onClick={() => void refreshLocalModels()}
            disabled={isRefreshingModels}
          >
            {isRefreshingModels ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {!ollamaReachable && ollamaTagModels !== null && (
          <p style={{ ...styles.subtitle, marginTop: -12, marginBottom: 8, fontSize: 11 }}>
            Local Ollama not detected; showing common defaults. Start Ollama and reopen setup to refresh the list.
          </p>
        )}
        <select
          style={styles.select}
          value={preferredModel}
          onChange={e => setPreferredModel(e.target.value)}
          disabled={step !== 'choice' && step !== 'lm-manual'}
        >
          {modelOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p style={{ ...styles.subtitle, marginTop: -8, fontSize: 12, color: '#a8b5c4' }}>
          VRAM: estimated ~{estimatedVramGb ?? '?'} GB for this tag (varies by quantization) · detected hardware:{' '}
          <strong style={{ color: '#e2e8f0' }}>{gpu.vramGB} GB</strong>
          {estimatedVramGb != null && gpu.vramGB + 0.5 < estimatedVramGb ? (
            <span style={{ color: '#fbbf24' }}> — may be tight; pick a smaller model if needed.</span>
          ) : null}
        </p>

          {step === 'choice' && (
          <>
            <p style={styles.recommend}>Choose an option:</p>
            {isBothInstalled && (
              <p style={{ ...styles.subtitle, marginTop: -8, marginBottom: 12, fontSize: 12 }}>
                <strong>Ollama</strong>: open-source runtime, API on port 11434, models via <code>ollama pull</code>.{' '}
                <strong>LM Studio</strong>: UI for GGUF models, OpenAI-compatible server (often 1234),{' '}
                <code>lms</code> CLI.
              </p>
            )}
            <div style={styles.btnRow}>
              {isBothInstalled && (
                <>
                  <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void finish('ollama')}>
                    Use Ollama
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.btn, ...styles.btnSecondary }}
                    onClick={() => void finish('lmstudio')}
                  >
                    Use LM Studio
                  </button>
                  <button type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => void onSkip()}>
                    Skip (cloud API)
                  </button>
                </>
              )}
              {isOllamaOnlyInstalled && (
                <>
                  <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void finish('ollama')}>
                    Continue with Ollama
                  </button>
                  {canDownloadOllama && (
                    <button
                      type="button"
                      style={{ ...styles.btn, ...styles.btnSecondary }}
                      onClick={() => void onInstallLmStudio()}
                    >
                      Install LM Studio
                    </button>
                  )}
                  <button type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => void onSkip()}>
                    Skip (cloud API)
                  </button>
                </>
              )}
              {isLmOnlyInstalled && (
                <>
                  <button
                    type="button"
                    style={{ ...styles.btn, ...styles.btnPrimary }}
                    onClick={() => void finish('lmstudio')}
                  >
                    Continue with LM Studio
                  </button>
                  {canDownloadOllama && (
                    <button type="button" style={{ ...styles.btn, ...styles.btnSecondary }} onClick={() => void onInstallOllama()}>
                      Install Ollama
                    </button>
                  )}
                  <button type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => void onSkip()}>
                    Skip (cloud API)
                  </button>
                </>
              )}
              {!isBothInstalled && !isOllamaOnlyInstalled && !isLmOnlyInstalled && isOllamaDetected && (
                <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void finish('ollama')}>
                  Continue with Ollama
                </button>
              )}
              {!isBothInstalled &&
                !isOllamaOnlyInstalled &&
                !isLmOnlyInstalled &&
                !isOllamaDetected &&
                canDownloadOllama && (
                <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void onInstallOllama()}>
                  Install Ollama (recommended)
                </button>
              )}
              {!isBothInstalled &&
                !isOllamaOnlyInstalled &&
                !isLmOnlyInstalled &&
                !isOllamaDetected &&
                canDownloadOllama && (
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnSecondary }}
                  onClick={() => void onInstallLmStudio()}
                >
                  Install LM Studio
                </button>
              )}
              {!isBothInstalled && !isOllamaOnlyInstalled && !isLmOnlyInstalled && (
                <button type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => void onSkip()}>
                  {isInsufficientHardware ? 'Open app (AI Settings)' : 'Skip (use cloud API)'}
                </button>
              )}
            </div>
          </>
        )}

        {(step === 'ollama-download' || step === 'ollama-install') && (
          <>
            <p style={styles.recommend}>{status}</p>
            {step === 'ollama-download' && (
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${progress}%` }} />
              </div>
            )}
            {err && <p style={styles.err}>{err}</p>}
          </>
        )}

        {(step === 'lm-download' || step === 'lm-manual') && (
          <>
            {step === 'lm-download' && (
              <>
                <p style={styles.recommend}>{status}</p>
                <div style={styles.progressTrack}>
                  <div style={{ ...styles.progressFill, width: `${progress}%` }} />
                </div>
              </>
            )}
            {step === 'lm-manual' && (
              <>
                <p style={styles.recommend}>
                  {lmPath
                    ? 'Please install LM Studio manually from the downloaded file, then click Continue.'
                    : status || 'Install LM Studio from the installer, then click Continue.'}
                </p>
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 12 }}
                  onClick={() => void finish('lmstudio')}
                >
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {step === 'error' && (
          <>
            <p style={styles.err}>{err}</p>
            <button type="button" style={{ ...styles.btn, ...styles.btnSecondary, marginTop: 12 }} onClick={() => void onSkip()}>
              Close and skip
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default FirstTimeSetup;
