import { useState, useEffect } from 'react';
import { PROVIDERS, loadSettings, saveSettings, testConnection } from '../../ai/providers';

export default function AISettings({ onClose }) {
  const [settings, setSettings] = useState(loadSettings);
  const [status, setStatus] = useState({ testing: false, result: null });
  const [models, setModels] = useState([]);
  const [showKey, setShowKey] = useState(false);

  const provider = PROVIDERS[settings.provider];

  const update = (patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
    setStatus({ testing: false, result: null });
    setModels([]);
  };

  const doTest = async () => {
    setStatus({ testing: true, result: null });
    const result = await testConnection(settings);
    setStatus({ testing: false, result });
    if (result.ok && result.models?.length) setModels(result.models);
  };

  // Auto-test on mount
  useEffect(() => { doTest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>AI Settings</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Provider selector */}
          <div className="form-group">
            <label className="form-label">Provider</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(PROVIDERS).map(([key, p]) => (
                <label key={key} className="checkbox-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="ai-provider"
                    checked={settings.provider === key}
                    onChange={() => update({ provider: key, model: '', endpoint: '', apiKey: key === 'ollama' ? '' : settings.apiKey })}
                  />
                  <span style={{ fontSize: 13 }}>
                    {p.name}
                    {!p.needsKey && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>(free, local)</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* API key */}
          {provider.needsKey && (
            <div className="form-group">
              <label className="form-label">API Key</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input input-sm"
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={e => update({ apiKey: e.target.value })}
                  placeholder={`Enter ${provider.name} API key`}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => setShowKey(v => !v)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Stored locally. Never sent to our servers.
              </span>
            </div>
          )}

          {/* Model */}
          <div className="form-group">
            <label className="form-label">Model</label>
            {models.length > 0 ? (
              <select
                className="select select-sm"
                value={settings.model || provider.defaultModel}
                onChange={e => update({ model: e.target.value })}
              >
                {!models.includes(provider.defaultModel) && (
                  <option value={provider.defaultModel}>{provider.defaultModel} (default)</option>
                )}
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="input input-sm"
                value={settings.model}
                onChange={e => update({ model: e.target.value })}
                placeholder={provider.defaultModel}
              />
            )}
          </div>

          {/* Custom endpoint */}
          <div className="form-group">
            <label className="form-label">Endpoint (optional)</label>
            <input
              className="input input-sm"
              value={settings.endpoint}
              onChange={e => update({ endpoint: e.target.value })}
              placeholder={provider.defaultEndpoint}
            />
          </div>

          {/* Connection test */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={doTest} disabled={status.testing}>
              {status.testing ? 'Testing...' : 'Test Connection'}
            </button>
            {status.result && (
              <span style={{ fontSize: 12, color: status.result.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)' }}>
                {status.result.ok
                  ? `Connected${status.result.models?.length ? ` (${status.result.models.length} models)` : ''}`
                  : status.result.error || 'Connection failed'}
              </span>
            )}
          </div>

          {/* Light mode */}
          <div className="form-group">
            <label className="checkbox-row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.lightMode || false} onChange={e => update({ lightMode: e.target.checked })} />
              <span style={{ fontSize: 13 }}>Light mode</span>
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 22, display: 'block' }}>
              Uses minimal context to reduce token usage. Recommended for free tiers.
              AI will use tool calls to explore data instead of receiving it upfront.
            </span>
          </div>

          {/* Enable/disable */}
          <label className="checkbox-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={settings.enabled !== false} onChange={e => update({ enabled: e.target.checked })} />
            <span style={{ fontSize: 13 }}>Enable AI Assistant</span>
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
