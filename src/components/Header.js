import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { exportDashboard, importDashboard } from '../utils/exportUtils';
import { TYPE_ICONS } from './Widgets/WidgetContainer';

export default function Header({ onHelpOpen, isMobile, isTablet }) {
  const { state, dispatch } = useApp();
  const importRef = useRef(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
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
        {!logoError ? (
          <img src="/logo.png" alt="ytics" className="header-logo-img" onError={() => setLogoError(true)} />
        ) : (
          !isMobile && <span>ytics</span>
        )}
      </div>

      <div className="header-title-area">
        <input
          className="header-dashboard-title"
          value={state.dashboard.title}
          onChange={e => dispatch({ type: 'SET_DASHBOARD_TITLE', payload: e.target.value })}
          placeholder="Dashboard title…"
        />
      </div>

      {/* Widget search */}
      <WidgetSearch />

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
                onClick={() => { exportDashboard(state.datasets, state.dashboard, state.selections); setMenuOpen(false); }}
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
            onClick={() => exportDashboard(state.datasets, state.dashboard, state.selections)}
            title="Export as .ytics"
          >
            ⬇ Export
          </button>
        </div>
      )}
    </header>
  );
}

/* ── Dashboard-level widget search ────────────────────────────────────────── */

function WidgetSearch() {
  const { state, dispatch } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Build flat list of all widgets across all pages
  const allWidgets = useMemo(() => {
    const items = [];
    for (const page of state.dashboard.pages) {
      for (const w of page.widgets) {
        items.push({
          id: w.id,
          title: w.title || 'Untitled',
          type: w.type,
          icon: TYPE_ICONS[w.type] || '📊',
          pageId: page.id,
          pageName: page.name || 'Page',
        });
      }
    }
    return items;
  }, [state.dashboard.pages]);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const lc = q.toLowerCase();
    return allWidgets.filter(w =>
      w.title.toLowerCase().includes(lc) ||
      w.type.toLowerCase().includes(lc) ||
      w.pageName.toLowerCase().includes(lc)
    ).slice(0, 12);
  }, [q, allWidgets]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset selected index when results change
  useEffect(() => { setSelectedIdx(0); }, [results]);

  const navigate = useCallback((item) => {
    dispatch({ type: 'NAVIGATE_TO_WIDGET', payload: { pageId: item.pageId, widgetId: item.id } });
    setOpen(false);
    setQ('');
  }, [dispatch]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      navigate(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQ('');
    }
  }, [results, selectedIdx, navigate]);

  const totalWidgets = allWidgets.length;

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-light)"
          strokeWidth="2" strokeLinecap="round" style={{ position: 'absolute', left: 8, pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          className="input input-sm"
          style={{ width: open ? 240 : 160, paddingLeft: 28, transition: 'width 0.2s' }}
          placeholder={`Search ${totalWidgets} widget${totalWidgets !== 1 ? 's' : ''}...`}
          value={q}
          onChange={e => { setQ(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { if (q.trim()) setOpen(true); }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          zIndex: 1000, maxHeight: 320, overflowY: 'auto',
          padding: '4px 0',
        }}>
          {results.map((item, i) => (
            <div
              key={item.id}
              onClick={() => navigate(item)}
              onMouseEnter={() => setSelectedIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', cursor: 'pointer', fontSize: 13,
                background: i === selectedIdx ? 'var(--bg-hover, #f1f5f9)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: 500, color: 'var(--text)',
                }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {item.type} · {item.pageName}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          zIndex: 1000, padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)',
          textAlign: 'center',
        }}>
          No widgets match "{q}"
        </div>
      )}
    </div>
  );
}
