import React, { useCallback, useEffect, useState } from 'react';
import { FiCpu, FiServer, FiCloud, FiCheckCircle, FiDownload, FiPlay, FiArrowRight, FiZap } from 'react-icons/fi';
import { useAI } from '../contexts/AIContext';
import type { AIProfile } from '../contexts/AIContext';
import './Onboarding.css';

const STORAGE_KEY = 'lseditor.onboardingComplete';
const ipc = () => (window as any).electron?.ipcRenderer;

interface HardwareInfo {
  totalMemGb: number;
  cpuCount: number;
  cpuModel: string;
  platform: string;
}

type Detect = 'checking' | 'available' | 'missing';

const createId = () => `profile-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

export const Onboarding: React.FC = () => {
  const { settings, saveProfile, selectProfile } = useAI();
  const [done, setDone] = useState<boolean>(() => {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return true; }
  });
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [ollama, setOllama] = useState<Detect>('checking');
  const [ollamaVersion, setOllamaVersion] = useState('');
  const [lmstudio, setLmstudio] = useState<Detect>('checking');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const detect = useCallback(async () => {
    try {
      const info = await ipc()?.invoke('app:getHardwareInfo');
      if (info) setHw(info);
    } catch { /* ignore */ }
    try {
      const status = await ipc()?.invoke('ollama:status');
      setOllama(status?.running ? 'available' : 'missing');
      setOllamaVersion(status?.version || '');
    } catch { setOllama('missing'); }
    try {
      const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(2500) });
      setLmstudio(res.ok ? 'available' : 'missing');
    } catch { setLmstudio('missing'); }
  }, []);

  useEffect(() => { if (!done) detect(); }, [done, detect]);

  if (done) return null;

  const recommendation = hw
    ? hw.totalMemGb >= 16
      ? 'Your machine can comfortably run capable local models (e.g. 7B coders).'
      : hw.totalMemGb >= 8
        ? 'Smaller local models will run well; for big models a cloud provider is smoother.'
        : 'Limited RAM — a cloud provider is recommended for the best experience.'
    : 'Detecting your hardware…';

  const finish = () => {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setDone(true);
  };

  const useProfile = (partial: Omit<AIProfile, 'id'>) => {
    const existing = settings.profiles.find(p => p.baseUrl.replace(/\/$/, '') === partial.baseUrl.replace(/\/$/, ''));
    const profile: AIProfile = existing ? { ...existing, ...partial } : { id: createId(), ...partial };
    saveProfile(profile);
    selectProfile(profile.id);
    finish();
  };

  const startOllama = async () => {
    setBusy('ollama'); setNote('');
    try {
      const res = await ipc()?.invoke('ollama:start');
      if (res?.ok) { setOllama('available'); setNote('Ollama is running.'); }
      else { setNote(res?.error || 'Could not start Ollama. Install it first.'); }
    } finally { setBusy(''); }
  };

  return (
    <div className="ob-overlay">
      <div className="ob-modal">
        <div className="ob-hero">
          <div className="ob-logo"><FiZap size={22} /></div>
          <div>
            <h1>Welcome to LS Editor</h1>
            <p>Let’s connect your AI. Pick a local engine or a cloud provider — you can add more profiles anytime.</p>
          </div>
        </div>

        <div className="ob-hw">
          <div className="ob-hw-item"><FiCpu size={15} /> {hw ? `${hw.cpuCount} cores` : '…'}</div>
          <div className="ob-hw-item"><FiServer size={15} /> {hw ? `${hw.totalMemGb} GB RAM` : '…'}</div>
          <div className="ob-hw-rec">{recommendation}</div>
        </div>

        <div className="ob-cards">
          {/* Ollama */}
          <div className={`ob-card ${ollama === 'available' ? 'ok' : ''}`}>
            <div className="ob-card-head"><span className="ob-card-icon local"><FiServer size={16} /></span> Ollama <span className="ob-card-tag">local</span></div>
            <p>Run open models fully offline on your machine.</p>
            <div className="ob-card-status">
              {ollama === 'checking' && <span className="muted">Checking…</span>}
              {ollama === 'available' && <span className="ok"><FiCheckCircle size={13} /> Detected{ollamaVersion ? ` · v${ollamaVersion}` : ''}</span>}
              {ollama === 'missing' && <span className="muted">Not running</span>}
            </div>
            <div className="ob-card-actions">
              {ollama === 'available' ? (
                <button className="ob-btn primary" onClick={() => useProfile({ name: 'Local 1', kind: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b', apiKey: '' })}>
                  Use Ollama <FiArrowRight size={13} />
                </button>
              ) : (
                <>
                  <button className="ob-btn" disabled={busy === 'ollama'} onClick={startOllama}><FiPlay size={13} /> {busy === 'ollama' ? 'Starting…' : 'Start'}</button>
                  <button className="ob-btn ghost" onClick={() => ipc()?.invoke('shell:openExternal', 'https://ollama.com/download')}><FiDownload size={13} /> Download</button>
                </>
              )}
            </div>
          </div>

          {/* LM Studio */}
          <div className={`ob-card ${lmstudio === 'available' ? 'ok' : ''}`}>
            <div className="ob-card-head"><span className="ob-card-icon local"><FiCpu size={16} /></span> LM Studio <span className="ob-card-tag">local</span></div>
            <p>Friendly desktop app with a local OpenAI-compatible server.</p>
            <div className="ob-card-status">
              {lmstudio === 'checking' && <span className="muted">Checking…</span>}
              {lmstudio === 'available' && <span className="ok"><FiCheckCircle size={13} /> Server detected (1234)</span>}
              {lmstudio === 'missing' && <span className="muted">Server not running</span>}
            </div>
            <div className="ob-card-actions">
              {lmstudio === 'available' ? (
                <button className="ob-btn primary" onClick={() => useProfile({ name: 'Local 1', kind: 'local', baseUrl: 'http://localhost:1234', model: '', apiKey: '' })}>
                  Use LM Studio <FiArrowRight size={13} />
                </button>
              ) : (
                <button className="ob-btn ghost" onClick={() => ipc()?.invoke('shell:openExternal', 'https://lmstudio.ai/')}><FiDownload size={13} /> Get LM Studio</button>
              )}
            </div>
          </div>

          {/* Cloud */}
          <div className="ob-card">
            <div className="ob-card-head"><span className="ob-card-icon cloud"><FiCloud size={16} /></span> Cloud provider <span className="ob-card-tag cloud">cloud</span></div>
            <p>Use OpenAI, OpenRouter, Groq or any OpenAI-compatible API.</p>
            <div className="ob-card-status"><span className="muted">Needs an API key</span></div>
            <div className="ob-card-actions">
              <button className="ob-btn primary" onClick={() => useProfile({ name: 'Cloud 1', kind: 'cloud', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet', apiKey: '' })}>
                Set up cloud <FiArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>

        {note && <div className="ob-note">{note}</div>}

        <div className="ob-foot">
          <button className="ob-skip" onClick={finish}>Skip for now</button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
