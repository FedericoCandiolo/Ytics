import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { exportDashboard, importDashboard } from '../utils/exportUtils';

export default function Header({ onHelpOpen, isMobile, isTablet }) {
  const { state, dispatch } = useApp();
  const importRef = useRef(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
  };

  const handleSave = () => {
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
    setMenuOpen(false);
  };

  const canExport = state.datasets.length > 0 || state.dashboard.pages.reduce((n, p) => n + p.widgets.length, 0) > 0;

  // Compact mode: hide text labels on buttons (tablet)
  const compact = isMobile || isTablet;

  return (
    <header className="header">
      <div className="header-logo">
        <img src="/logo.png" alt="Ytics" className="header-logo-img" />
        {!isMobile && <span>ytics</span>}
      </div>

      <div className="header-title-area">
        <input
          className="header-dashboard-title"
          value={state.dashboard.title}
          onChange={e => dispatch({ type: 'SET_DASHBOARD_TITLE', payload: e.target.value })}
          placeholder="Dashboard title…"
        />
      </div>

      {/* Mode toggle — hidden on mobile (viewer-only) */}
      {!isMobile && (
        <div className="header-mode-toggle">
          <button
            className={`mode-btn ${state.mode === 'developer' ? 'mode-btn--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}
          >
            {compact ? '✏️' : '✏️ Developer'}
          </button>
          <button
            className={`mode-btn ${state.mode === 'viewer' ? 'mode-btn--active' : ''}`}
            onClick={() => dispatch({ type: 'SET_MODE', payload: 'viewer' })}
          >
            {compact ? '👁' : '👁 Viewer'}
          </button>
        </div>
      )}

      {/* Desktop: inline buttons. Mobile/tablet: hamburger menu */}
      {compact ? (
        <div className="header-menu-wrap" ref={menuRef}>
          <button
            className="btn btn-icon header-hamburger"
            onClick={() => setMenuOpen(o => !o)}
            title="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="header-dropdown">
              <button className="header-dropdown-item" onClick={handleNew}>+ New</button>
              <button className="header-dropdown-item" onClick={handleSave}>
                {saveFlash ? '✓ Saved' : '💾 Save'}
              </button>
              <button className="header-dropdown-item" onClick={() => { onHelpOpen(); setMenuOpen(false); }}>? Help</button>
              <button className="header-dropdown-item" onClick={() => { importRef.current?.click(); setMenuOpen(false); }}>
                ⬆ Import
              </button>
              <input ref={importRef} type="file" accept=".ytics,.zip" hidden onChange={handleImport} />
              <button
                className="header-dropdown-item header-dropdown-item--primary"
                disabled={!canExport}
                onClick={() => { exportDashboard(state.datasets, state.dashboard); setMenuOpen(false); }}
              >
                ⬇ Export
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={handleNew} title="New dashboard">
            + New
          </button>
          <button
            className={`btn btn-sm ${saveFlash ? 'btn-success' : 'btn-secondary'}`}
            onClick={handleSave}
            title="Save dashboard"
          >
            {saveFlash ? '✓ Saved' : '💾 Save'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onHelpOpen} title="Help & Documentation">
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
            disabled={!canExport}
            onClick={() => exportDashboard(state.datasets, state.dashboard)}
            title="Export as .ytics"
          >
            ⬇ Export
          </button>
        </div>
      )}
    </header>
  );
}
