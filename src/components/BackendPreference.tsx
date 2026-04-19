import React, { useCallback, useEffect, useState } from 'react';

/** Mirror of `ParallelBackendSnapshot` in main — kept local to avoid bundling Node/Electron-only modules in the renderer. */
interface BackendPreferenceSnapshot {
  ollama: {
    installed: boolean;
    running: boolean;
    port: number | null;
    baseURL: string | null;
    models: string[];
    exePath: string | null;
  };
  lmstudio: {
    installed: boolean;
    running: boolean;
    port: number | null;
    scheme: 'http' | 'https' | null;
    baseURL: string | null;
    exePath: string | null;
  };
  gpuInfo: { hasDedicatedGPU: boolean; name: string; vramGB: number; vramMB: number };
}

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
    maxWidth: 520,
    margin: '0 auto',
    background: 'rgba(15, 23, 42, 0.9)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 24px 48px rgba(0,0,0,0.45)'
  },
  title: { fontSize: 18, fontWeight: 600, margin: '0 0 8px', color: '#f8fafc' },
  subtitle: { fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
    marginBottom: 16
  },
  option: {
    borderRadius: 12,
    padding: 16,
    border: '1px solid rgba(148, 163, 184, 0.25)',
    background: 'rgba(30, 41, 59, 0.6)',
    cursor: 'pointer',
    textAlign: 'left' as const
  },
  optionTitle: { fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#38bdf8' },
  optionBody: { fontSize: 12, color: '#94a3b8', lineHeight: 1.45 },
  mono: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 11,
    color: '#a5b4fc',
    marginTop: 8,
    wordBreak: 'break-all' as const
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  btn: {
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    color: '#fff'
  },
  btnGhost: {
    background: 'transparent',
    color: '#94a3b8',
    border: '1px solid rgba(148, 163, 184, 0.35)'
  },
  err: { color: '#f87171', fontSize: 13 }
};

declare global {
  interface Window {
    backendPreference?: {
      getSnapshot: () => Promise<BackendPreferenceSnapshot | null>;
      complete: (choice: 'ollama' | 'lmstudio') => Promise<void>;
      cancel: () => Promise<void>;
    };
  }
}

export const BackendPreference: React.FC = () => {
  const api = window.backendPreference;
  const [snap, setSnap] = useState<BackendPreferenceSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!api) {
      setErr('IPC unavailable.');
      return;
    }
    void api.getSnapshot().then(setSnap);
  }, [api]);

  const onPick = useCallback(
    async (choice: 'ollama' | 'lmstudio') => {
      if (!api) return;
      try {
        await api.complete(choice);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [api]
  );

  const onCancel = useCallback(async () => {
    if (!api) return;
    await api.cancel();
  }, [api]);

  if (err && !snap) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <p style={styles.err}>{err}</p>
        </div>
      </div>
    );
  }

  if (!snap) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <p style={styles.subtitle}>Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>Choose a local AI backend</h1>
        <p style={styles.subtitle}>
          Both Ollama and LM Studio are installed. Pick which one LS Editor should prefer for URLs, status, and
          autostart. You can change this later in AI settings.
        </p>

        <div style={styles.row}>
          <button type="button" style={styles.option} onClick={() => void onPick('ollama')}>
            <div style={styles.optionTitle}>Ollama</div>
            <div style={styles.optionBody}>
              Open-source runtime, <code>ollama pull</code> models, defaults to port 11434.
            </div>
            <div style={styles.mono}>
              {snap.ollama.baseURL ?? 'not running'}
              {snap.ollama.models.length > 0 ? ` · ${snap.ollama.models.length} model(s)` : ''}
            </div>
          </button>
          <button type="button" style={styles.option} onClick={() => void onPick('lmstudio')}>
            <div style={{ ...styles.optionTitle, color: '#a78bfa' }}>LM Studio</div>
            <div style={styles.optionBody}>Desktop UI for GGUF models and OpenAI-compatible server (often 1234).</div>
            <div style={styles.mono}>{snap.lmstudio.baseURL ?? 'not running'}</div>
          </button>
        </div>

        {err ? <p style={styles.err}>{err}</p> : null}

        <div style={styles.actions}>
          <button type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => void onCancel()}>
            Use Ollama (default)
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackendPreference;
