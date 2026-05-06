import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { exportDashboard, importDashboard, generateDashboardBlob } from '../utils/exportUtils';
import { pickFile, downloadFile, createFile, updateFile } from '../utils/googleDrive';
import { TYPE_ICONS } from './Widgets/WidgetContainer';

// ── Google Drive icon (inline SVG for the buttons) ──────────────────────────
const DriveIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style={{ verticalAlign: 'middle' }}>
    <path d="M6.6 66.85L0 53.9 27.6 0h18.6L6.6 66.85z" fill="#0066da"/>
    <path d="M27.6 78l13.2-24.1H87.3L74.1 78H27.6z" fill="#00ac47"/>
    <path d="M45.3 29.1l16.2 24.8H87.3L58.8 0H45.6L45.3 29.1z" fill="#ea4335"/>
    <path d="M45.3 29.1L27.6 0H46.2L58.8 24.8 45.3 29.1z" fill="#00832d"/>
    <path d="M6.6 66.85L27.6 78l13.2-24.1-16.2-24.8L6.6 66.85z" fill="#2684fc"/>
    <path d="M45.3 29.1l16.2 24.8H40.8L27.6 78H74.1l13.2-24.1H61.5L45.3 29.1z" fill="#ffba00"/>
  </svg>
);

// ── Examples Modal ──────────────────────────────────────────────────────────

function ExamplesModal({ onClose, onLoad }) {
  const [examples, setExamples] = useState(null);
  const [loading, setLoading] = useState(null); // id of loading example

  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/examples/manifest.json`)
      .then(r => r.ok ? r.json() : [])
      .then(setExamples)
      .catch(() => setExamples([]));
  }, []);

  const handleLoad = async (ex) => {
    setLoading(ex.file);
    try {
      const res = await fetch(`${process.env.PUBLIC_URL}/examples/${ex.file}`);
      if (!res.ok) throw new Error('File not found');
      const blob = await res.blob();
      await onLoad(blob, ex.name);
      onClose();
    } catch (err) {
      alert('Failed to load example: ' + err.message);
      setLoading(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-card, #fff)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,.2)',
        width: 'min(680px, 90vw)', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border, #e2e8f0)',
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            Example Dashboards
          </h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--text-muted)', padding: '2px 6px',
          }}>x</button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {examples === null && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              Loading examples...
            </div>
          )}
          {examples?.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
              No examples available yet.
            </div>
          )}
          {examples?.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}>
              {examples.map(ex => (
                <div
                  key={ex.file}
                  onClick={() => !loading && handleLoad(ex)}
                  style={{
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: 10, overflow: 'hidden', cursor: loading ? 'wait' : 'pointer',
                    transition: 'box-shadow 0.15s, transform 0.15s',
                    opacity: loading && loading !== ex.file ? 0.5 : 1,
                  }}
                  onMouseEnter={e => { if (!loading) { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    height: 140, background: 'var(--bg-hover, #f1f5f9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {ex.thumbnail ? (
                      <img
                        src={`${process.env.PUBLIC_URL}/examples/${ex.thumbnail}`}
                        alt={ex.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <span style={{ fontSize: 36, opacity: 0.3 }}>📊</span>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                      {loading === ex.file ? 'Loading...' : ex.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {ex.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Header({ onHelpOpen, onAIToggle, isAIOpen, isMobile, isTablet }) {
  const { state, dispatch } = useApp();
  const importRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [saveDropdown, setSaveDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const menuRef = useRef(null);
  const openRef = useRef(null);
  const saveRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!menuOpen && !openDropdown && !saveDropdown) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (openRef.current && !openRef.current.contains(e.target)) setOpenDropdown(false);
      if (saveRef.current && !saveRef.current.contains(e.target)) setSaveDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [menuOpen, openDropdown, saveDropdown]);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await importDashboard(file);
      dispatch({ type: 'IMPORT_STATE', payload: { ...result, fileOrigin: { source: 'local' } } });
    } catch (err) {
      alert('Failed to import: ' + err.message);
    }
    e.target.value = '';
  };

  const handleOpenFromDrive = async () => {
    setOpenDropdown(false);
    setMenuOpen(false);
    try {
      const picked = await pickFile();
      if (!picked) return;
      const buffer = await downloadFile(picked.id);
      const blob = new Blob([buffer], { type: 'application/zip' });
      // Create a File object for importDashboard
      const file = new File([blob], picked.name, { type: 'application/zip' });
      const result = await importDashboard(file);
      dispatch({
        type: 'IMPORT_STATE',
        payload: { ...result, fileOrigin: { source: 'googledrive', fileId: picked.id, fileName: picked.name } },
      });
    } catch (err) {
      if (err.message !== 'Google authorization cancelled') {
        alert('Failed to open from Google Drive: ' + err.message);
      }
    }
  };

  const handleSave = async () => {
    setSaveDropdown(false);
    setMenuOpen(false);
    if (state.fileOrigin?.source === 'googledrive') {
      // Update existing file on Drive
      setSaving(true);
      try {
        const blob = await generateDashboardBlob(state.datasets, state.dashboard, state.selections);
        await updateFile(state.fileOrigin.fileId, blob);
      } catch (err) {
        alert('Failed to save to Google Drive: ' + err.message);
      }
      setSaving(false);
    } else {
      // Download locally
      exportDashboard(state.datasets, state.dashboard, state.selections);
    }
  };

  const handleSaveToDrive = async () => {
    setSaveDropdown(false);
    setMenuOpen(false);
    setSaving(true);
    try {
      const blob = await generateDashboardBlob(state.datasets, state.dashboard, state.selections);
      const fileName = (state.dashboard.title || 'dashboard').replace(/[^a-z0-9]/gi, '_');
      if (state.fileOrigin?.source === 'googledrive') {
        await updateFile(state.fileOrigin.fileId, blob);
      } else {
        const created = await createFile(fileName, blob);
        dispatch({
          type: 'SET_FILE_ORIGIN',
          payload: { source: 'googledrive', fileId: created.id, fileName: created.name },
        });
      }
    } catch (err) {
      if (err.message !== 'Google authorization required') {
        alert('Failed to save to Google Drive: ' + err.message);
      }
    }
    setSaving(false);
  };

  const handleDownload = () => {
    setSaveDropdown(false);
    setMenuOpen(false);
    exportDashboard(state.datasets, state.dashboard, state.selections);
  };

  const handleNew = () => {
    if (!window.confirm('Create a new dashboard? Unsaved changes will be lost.')) return;
    dispatch({ type: 'NEW_DASHBOARD' });
    setMenuOpen(false);
  };

  const handleLoadExample = async (blob, name) => {
    const file = new File([blob], name + '.ytics', { type: 'application/zip' });
    const result = await importDashboard(file);
    dispatch({ type: 'IMPORT_STATE', payload: { ...result, fileOrigin: null } });
  };

  const canExport = state.datasets.length > 0 || state.dashboard.pages.reduce((n, p) => n + p.widgets.length, 0) > 0;
  const isDriveFile = state.fileOrigin?.source === 'googledrive';

  // Compact mode: hide text labels on buttons (tablet)
  const compact = isMobile || isTablet;

  // Shared dropdown styles
  const dropdownStyle = {
    position: 'absolute', top: 'calc(100% + 4px)', right: 0,
    background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #e2e8f0)',
    borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
    zIndex: 1000, minWidth: 180, padding: '4px 0',
  };
  const dropdownItemStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 14px', border: 'none', background: 'none',
    cursor: 'pointer', fontSize: 13, color: 'var(--text)', textAlign: 'left',
    whiteSpace: 'nowrap',
  };

  const openLocalBtn = (onClick) => (
    <button
      style={dropdownItemStyle}
      onClick={() => { importRef.current?.click(); if (onClick) onClick(); }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <span>📁</span> From computer
    </button>
  );

  const openDriveBtn = (onClick) => (
    <button
      style={dropdownItemStyle}
      onClick={() => { handleOpenFromDrive(); if (onClick) onClick(); }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <DriveIcon /> From Google Drive
    </button>
  );

  return (
    <header className="header">
      <input ref={importRef} type="file" accept=".ytics,.zip" hidden onChange={handleImport} />
      <div className="header-logo">
        {!logoError ? (
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="ytics" className="header-logo-img" onError={() => setLogoError(true)} />
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
        {isDriveFile && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4, flexShrink: 0 }} title={state.fileOrigin.fileName}>
            <DriveIcon size={10} /> Drive
          </span>
        )}
      </div>

      {/* AI toggle */}
      <button
        className={`btn btn-sm ${isAIOpen ? 'btn-primary' : 'btn-secondary'}`}
        onClick={onAIToggle}
        title="AI Assistant"
        style={{ flexShrink: 0 }}
      >
        {compact ? '✦' : '✦ AI'}
      </button>

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
              <button className="header-dropdown-item" onClick={() => { setShowExamples(true); setMenuOpen(false); }}>Examples</button>
              <button className="header-dropdown-item" onClick={() => { onHelpOpen(); setMenuOpen(false); }}>? Help</button>
              <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', margin: '4px 0' }} />
              <button className="header-dropdown-item" onClick={() => { importRef.current?.click(); setMenuOpen(false); }}>
                📁 Open from computer
              </button>
              <button className="header-dropdown-item" onClick={handleOpenFromDrive}>
                <DriveIcon /> Open from Drive
              </button>
              <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', margin: '4px 0' }} />
              <button
                className="header-dropdown-item header-dropdown-item--primary"
                disabled={!canExport || saving}
                onClick={handleSave}
              >
                {saving ? '⏳ Saving…' : isDriveFile ? '☁️ Save to Drive' : '⬇ Save'}
              </button>
              {isDriveFile && (
                <button className="header-dropdown-item" disabled={!canExport} onClick={handleDownload}>
                  ⬇ Download copy
                </button>
              )}
              {!isDriveFile && canExport && (
                <button className="header-dropdown-item" disabled={saving} onClick={handleSaveToDrive}>
                  <DriveIcon /> Save to Drive
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={handleNew} title="New dashboard">
            + New
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowExamples(true)} title="Example dashboards">
            Examples
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onHelpOpen} title="Help & Documentation">
            ? Help
          </button>

          {/* Open button with dropdown */}
          <div ref={openRef} style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setOpenDropdown(o => !o)}
              title="Open .ytics file"
            >
              ⬆ Open ▾
            </button>
            {openDropdown && (
              <div style={dropdownStyle}>
                {openLocalBtn(() => setOpenDropdown(false))}
                {openDriveBtn(() => setOpenDropdown(false))}
              </div>
            )}
          </div>

          {/* Save button with dropdown */}
          <div ref={saveRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex' }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={!canExport || saving}
                onClick={handleSave}
                title={isDriveFile ? `Save to Google Drive (${state.fileOrigin.fileName})` : 'Save as .ytics'}
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                {saving ? '⏳' : isDriveFile ? '☁️' : '⬇'} Save
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!canExport}
                onClick={() => setSaveDropdown(o => !o)}
                title="More save options"
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.3)', padding: '0 6px' }}
              >
                ▾
              </button>
            </div>
            {saveDropdown && (
              <div style={dropdownStyle}>
                <button
                  style={dropdownItemStyle}
                  onClick={handleDownload}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span>⬇</span> Download .ytics
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={handleSaveToDrive}
                  disabled={saving}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <DriveIcon /> {isDriveFile ? 'Update on Drive' : 'Save to Google Drive'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showExamples && (
        <ExamplesModal
          onClose={() => setShowExamples(false)}
          onLoad={handleLoadExample}
        />
      )}
    </header>
  );
}

/* ── Dashboard-level widget search ────────────────────────────────────────── */

export function WidgetSearch() {
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
