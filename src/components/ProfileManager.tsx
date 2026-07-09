import React, { useState } from 'react';
import { FiX, FiPlus, FiTrash2, FiCheckCircle, FiServer, FiCloud, FiEdit2 } from 'react-icons/fi';
import { useAI } from '../contexts/AIContext';
import type { AIProfile } from '../contexts/AIContext';
import './ProfileManager.css';

interface ProfileManagerProps {
  onClose: () => void;
}

interface Preset {
  label: string;
  kind: 'local' | 'cloud';
  baseUrl: string;
  model: string;
  hint: string;
}

const PRESETS: Preset[] = [
  { label: 'Ollama (local)', kind: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b', hint: 'Runs on your machine via Ollama' },
  { label: 'LM Studio (local)', kind: 'local', baseUrl: 'http://localhost:1234', model: '', hint: 'Local server in LM Studio' },
  { label: 'OpenAI', kind: 'cloud', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: 'Needs an API key' },
  { label: 'OpenRouter', kind: 'cloud', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet', hint: 'Many models, one key' },
  { label: 'Groq', kind: 'cloud', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', hint: 'Fast inference, free tier' }
];

const createId = () => `profile-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

export const ProfileManager: React.FC<ProfileManagerProps> = ({ onClose }) => {
  const { settings, saveProfile, deleteProfile, selectProfile } = useAI();
  const profiles = settings.profiles;
  const [editing, setEditing] = useState<AIProfile | null>(null);

  const startNew = (preset?: Preset) => {
    const localCount = profiles.filter(p => p.kind === (preset?.kind ?? 'local')).length + 1;
    setEditing({
      id: createId(),
      name: preset ? `${preset.kind === 'cloud' ? 'Cloud' : 'Local'} ${localCount}` : `Profile ${profiles.length + 1}`,
      kind: preset?.kind ?? 'local',
      baseUrl: preset?.baseUrl ?? 'http://localhost:1234',
      model: preset?.model ?? '',
      apiKey: ''
    });
  };

  const commit = () => {
    if (!editing || !editing.name.trim()) return;
    saveProfile(editing);
    setEditing(null);
  };

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={e => e.stopPropagation()}>
        <div className="pm-header">
          <div className="pm-title"><FiServer size={16} /> AI Profiles</div>
          <button className="pm-icon-btn" onClick={onClose} title="Close"><FiX size={16} /></button>
        </div>

        {!editing ? (
          <div className="pm-body">
            <div className="pm-list">
              {profiles.map(profile => {
                const active = profile.id === settings.activeProfileId;
                return (
                  <div key={profile.id} className={`pm-row ${active ? 'active' : ''}`}>
                    <span className={`pm-kind ${profile.kind}`}>
                      {profile.kind === 'cloud' ? <FiCloud size={14} /> : <FiServer size={14} />}
                    </span>
                    <div className="pm-row-info">
                      <span className="pm-row-name">{profile.name}</span>
                      <span className="pm-row-sub">{profile.model || 'no model'} · {profile.baseUrl}</span>
                    </div>
                    <div className="pm-row-actions">
                      {active ? (
                        <span className="pm-active"><FiCheckCircle size={13} /> Active</span>
                      ) : (
                        <button className="pm-use" onClick={() => selectProfile(profile.id)}>Use</button>
                      )}
                      <button className="pm-icon-btn" title="Edit" onClick={() => setEditing({ ...profile })}><FiEdit2 size={13} /></button>
                      <button className="pm-icon-btn danger" title="Delete" disabled={profiles.length <= 1} onClick={() => deleteProfile(profile.id)}><FiTrash2 size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pm-presets">
              <div className="pm-presets-label">Add a profile</div>
              <div className="pm-presets-grid">
                {PRESETS.map(preset => (
                  <button key={preset.label} className="pm-preset" onClick={() => startNew(preset)} title={preset.hint}>
                    <span className={`pm-kind ${preset.kind}`}>{preset.kind === 'cloud' ? <FiCloud size={13} /> : <FiServer size={13} />}</span>
                    {preset.label}
                  </button>
                ))}
                <button className="pm-preset blank" onClick={() => startNew()}><FiPlus size={13} /> Blank</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="pm-body pm-edit">
            <label className="pm-field">
              <span>Name</span>
              <input value={editing.name} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Local 1, Cloud 1" />
            </label>
            <label className="pm-field">
              <span>Type</span>
              <div className="pm-kind-toggle">
                <button className={editing.kind === 'local' ? 'active' : ''} onClick={() => setEditing({ ...editing, kind: 'local' })}><FiServer size={13} /> Local</button>
                <button className={editing.kind === 'cloud' ? 'active' : ''} onClick={() => setEditing({ ...editing, kind: 'cloud' })}><FiCloud size={13} /> Cloud</button>
              </div>
            </label>
            <label className="pm-field">
              <span>Endpoint (OpenAI-compatible)</span>
              <input value={editing.baseUrl} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="http://localhost:1234 or https://api.openai.com/v1" />
            </label>
            <label className="pm-field">
              <span>Model</span>
              <input value={editing.model} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="e.g. gpt-4o-mini, qwen2.5-coder:7b" />
            </label>
            {editing.kind === 'cloud' && (
              <label className="pm-field">
                <span>API key</span>
                <input type="password" value={editing.apiKey || ''} onChange={e => setEditing({ ...editing, apiKey: e.target.value })} placeholder="sk-…" />
              </label>
            )}
            <div className="pm-edit-actions">
              <button className="pm-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="pm-btn primary" disabled={!editing.name.trim()} onClick={commit}>Save profile</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileManager;
