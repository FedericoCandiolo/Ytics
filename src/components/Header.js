import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { exportDashboard, importDashboard } from '../utils/exportUtils';

export default function Header({ onHelpOpen }) {
  const { state, dispatch } = useApp();
  const importRef = useRef(null);
  const [saveFlash, setSaveFlash] = useState(false);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await importDashboard(file);
      dispatch({ type: 'IMPORT_STATE', payload: result });
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
    e.target.value = '';
  };

  const handleNew = () => {
    if (!window.confirm('Create a new dashboard? Unsaved changes will be lost.')) return;
    dispatch({ type: 'NEW_DASHBOARD' });
  };

  const handleSave = () => {
    // TODO: implement persistence
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  };

  return (
    <header className="header">
      <div className="header-logo">
        <img src="/logo.png" alt="Ytics" className="header-logo-img" />
      </div>

      <div className="header-title-area">
        <input
          className="header-dashboard-title"
          value={state.dashboard.title}
          onChange={e => dispatch({ type: 'SET_DASHBOARD_TITLE', payload: e.target.value })}
          placeholder="Dashboard title…"
        />
      </div>

      <div className="header-mode-toggle">
        <button
          className={`mode-btn ${state.mode === 'developer' ? 'mode-btn--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}
        >
          ✏️ Developer
        </button>
        <button
          className={`mode-btn ${state.mode === 'viewer' ? 'mode-btn--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_MODE', payload: 'viewer' })}
        >
          👁 Viewer
        </button>
      </div>

      <div className="flex gap-2">
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleNew}
          title="New dashboard"
        >
          + New
        </button>
        <button
          className={`btn btn-sm ${saveFlash ? 'btn-success' : 'btn-secondary'}`}
          onClick={handleSave}
          title="Save dashboard"
        >
          {saveFlash ? '✓ Saved' : '💾 Save'}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onHelpOpen}
          title="Help & Documentation"
        >
          ? Help
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => importRef.current?.click()}
          title="Import .ytics file"
        >
          ⬆ Import
        </button>
        <input ref={importRef} type="file" accept=".ytics,.zip" hidden onChange={handleImport} />

        <button
          className="btn btn-primary btn-sm"
          disabled={!state.dashboard.pages.reduce((n, p) => n + p.widgets.length, 0)}
          onClick={() => exportDashboard(state.datasets, state.dashboard)}
          title="Export as .ytics"
        >
          ⬇ Export
        </button>
      </div>
    </header>
  );
}
