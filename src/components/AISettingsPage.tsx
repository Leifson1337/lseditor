import React, { useState, useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import { useAI } from '../contexts/AIContext';
import '../styles/AISettingsPage.css';

interface AISettingsPageProps {
  onClose: () => void;
}

const AISettingsPage: React.FC<AISettingsPageProps> = ({ onClose }) => {
  const { settings, updateSettings } = useAI();
  const [temperature, setTemperature] = useState(settings.temperature);
  const [topP, setTopP] = useState(settings.topP);
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens);
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState(settings.globalSystemPrompt ?? '');
  const [replaceBasePrompt, setReplaceBasePrompt] = useState(settings.replaceBasePrompt ?? false);

  useEffect(() => {
    setTemperature(settings.temperature);
    setTopP(settings.topP);
    setMaxTokens(settings.maxTokens);
    setGlobalSystemPrompt(settings.globalSystemPrompt ?? '');
    setReplaceBasePrompt(settings.replaceBasePrompt ?? false);
  }, [settings.temperature, settings.topP, settings.maxTokens, settings.globalSystemPrompt, settings.replaceBasePrompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = () => {
    updateSettings({
      temperature,
      topP,
      maxTokens,
      globalSystemPrompt: globalSystemPrompt.trim(),
      replaceBasePrompt: replaceBasePrompt && Boolean(globalSystemPrompt.trim())
    });
    onClose();
  };

  return (
    <div
      className="ai-settings-page-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-settings-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ai-settings-page">
        <div className="ai-settings-page-header">
          <h2 id="ai-settings-title">AI settings</h2>
          <button type="button" className="ai-settings-page-close" onClick={onClose} title="Close (Esc)">
            <FiX size={18} />
          </button>
        </div>
        <div className="ai-settings-page-body">
          <p className="ai-settings-page-desc">
            These values apply to all AI completions. Connection, model, and tools are configured from the chat panel
            (gear icon).
          </p>

          <div className="ai-settings-page-field">
            <label htmlFor="ai-set-temp">Temperature</label>
            <div className="ai-settings-page-range-row">
              <input
                id="ai-set-temp"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value) || 0)}
              />
              <span className="ai-settings-page-range-value">{temperature}</span>
            </div>
          </div>

          <div className="ai-settings-page-field">
            <label htmlFor="ai-set-topp">Top P</label>
            <div className="ai-settings-page-range-row">
              <input
                id="ai-set-topp"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={topP}
                onChange={e => setTopP(parseFloat(e.target.value) || 0)}
              />
              <span className="ai-settings-page-range-value">{topP}</span>
            </div>
          </div>

          <div className="ai-settings-page-field">
            <label htmlFor="ai-set-max">Max tokens</label>
            <input
              id="ai-set-max"
              type="number"
              min={256}
              max={128000}
              step={256}
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 4096)}
            />
          </div>

          <div className="ai-settings-page-field">
            <label className="ai-settings-page-checkbox-row">
              <input
                type="checkbox"
                checked={replaceBasePrompt}
                onChange={e => setReplaceBasePrompt(e.target.checked)}
              />
              <span>Replace built-in base prompt (base-prompt.md) with the text below</span>
            </label>
            <label htmlFor="ai-set-sys">System prompt / instructions</label>
            <textarea
              id="ai-set-sys"
              value={globalSystemPrompt}
              onChange={e => setGlobalSystemPrompt(e.target.value)}
              placeholder="Optional instructions for every request. When “Replace built-in base prompt” is on, this text replaces config/base-prompt.md entirely; otherwise it is added after the base prompt."
              spellCheck={false}
            />
          </div>
        </div>
        <div className="ai-settings-page-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default AISettingsPage;
