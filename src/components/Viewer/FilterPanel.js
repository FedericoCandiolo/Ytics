import { useState, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useApp } from '../../context/AppContext';
import { getFieldsByTable } from '../../utils/associativeEngine';
import { v4 as uuid } from 'uuid';

const isMobileDevice = () => window.innerWidth <= 767;

// Attach a handler that fires on click/tap outside ref
function useOutsideClose(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [ref, onClose, active]);
}

// ── Selection pill popup (categorical) ───────────────────────────────────────
function SelectionPopup({ field, colStore, associativeState, selectedValues, dispatch, onClose }) {
  const [search, setSearch] = useState('');

  const allValues = useMemo(() => {
    const dict = colStore.dicts?.[field];
    if (dict) return [...dict].sort();
    const vals = new Set();
    for (const table of Object.values(colStore.tables || {})) {
      const col = table.columns?.[field];
      if (!col) continue;
      if (col.kind === 'string') {
        const d = colStore.dicts[col.dictKey] || [];
        for (let i = 0; i < table.length; i++) vals.add(d[col.buf[i]]);
      } else {
        for (let i = 0; i < table.length; i++) vals.add(String(col.buf[i]));
      }
    }
    return [...vals].sort();
  }, [field, colStore]);

  const fieldState = associativeState?.fieldStates?.[field];
  const selected = new Set(selectedValues || []);
  const filtered = search
    ? allValues.filter(v => (v || '(blank)').toLowerCase().includes(search.toLowerCase()))
    : allValues;

  const toggle = (v) => dispatch({ type: 'TOGGLE_SELECTION', payload: { field, value: v } });

  const getValueStyle = (v) => {
    if (selected.has(v)) return { color: 'var(--accent)', fontWeight: 600 };
    if (fieldState?.excluded?.has(v)) return { color: 'var(--text-light)', opacity: 0.4, textDecoration: 'line-through' };
    if (fieldState?.possible?.has(v)) return { color: 'var(--text)' };
    return {};
  };

  return (
    <div>
      <input
        className="input input-sm"
        placeholder="Search..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 8, width: '100%' }}
        autoFocus
      />
      <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 4 }}>No matches</div>
        )}
        {filtered.map(v => (
          <label key={v} className="checkbox-row" style={{ marginBottom: 6, minHeight: 32, ...getValueStyle(v) }}>
            <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
            <span style={{ fontSize: 13 }}>{v || '(blank)'}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm"
          onClick={() => dispatch({ type: 'SET_SELECTION', payload: { field, values: search ? filtered : allValues } })}>
          {search ? `All visible (${filtered.length})` : 'All'}
        </button>
        <button className="btn btn-ghost btn-sm"
          onClick={() => dispatch({ type: 'CLEAR_SELECTION', payload: field })}>
          None
        </button>
      </div>
    </div>
  );
}

// ── Single selection pill ────────────────────────────────────────────────────
function SelectionPill({ field, values, colStore, associativeState, dispatch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClose(ref, () => setOpen(false), open);

  const isActive = values && values.length > 0;
  const summary = isActive ? `${values.length} selected` : 'all';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className={`filter-pill ${isActive ? 'filter-pill--active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span>{field}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{summary}</span>
        <button
          style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-light)', padding: '0 2px', minWidth: 20, minHeight: 20 }}
          onClick={e => { e.stopPropagation(); dispatch({ type: 'REMOVE_SELECTION', payload: field }); }}
          title="Remove selection pane"
        >✕</button>
      </div>
      {open && (
        <div className="filter-popup">
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{field}</div>
          <SelectionPopup
            field={field}
            colStore={colStore}
            associativeState={associativeState}
            selectedValues={values}
            dispatch={dispatch}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Add selection popup ──────────────────────────────────────────────────────
function AddSelectionPopup({ colStore, existingFields, onAdd, onClose }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const tableGroups = useMemo(() => {
    return getFieldsByTable(colStore)
      .map(g => ({ ...g, fields: g.fields.filter(f => !existingFields.has(f.name)) }))
      .filter(g => g.fields.length > 0);
  }, [colStore, existingFields]);

  const q = search.toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return tableGroups;
    return tableGroups
      .map(g => ({ ...g, fields: g.fields.filter(c => c.name.toLowerCase().includes(q)) }))
      .filter(g => g.fields.length > 0);
  }, [tableGroups, q]);

  const singleGroup = filtered.length === 1;

  return (
    // No inline position — let .filter-popup CSS handle desktop (absolute) and mobile (fixed bottom)
    <div className="filter-popup">
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Add Selection</div>
      <input
        ref={inputRef}
        className="input input-sm"
        style={{ width: '100%', marginBottom: 6 }}
        placeholder="Search fields..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>No fields match</div>
        )}
        {filtered.map(g => (
          <div key={g.tableId}>
            {!singleGroup && (
              <div style={{ padding: '4px 10px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {g.tableName}
              </div>
            )}
            {g.fields.map(c => (
              <div key={c.name}
                className="filter-popup-item"
                onClick={() => { onAdd(c.name); onClose(); }}>
                {c.name} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({c.type})</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2" style={{ marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Bookmark list content (shared between panel and sheet) ────────────────────
function BookmarkContent({ bookmarks, selections, dispatch, onClose, autoFocus }) {
  const hasSelections = Object.values(selections).some(v => Array.isArray(v));

  const suggestedName = useMemo(() => {
    const parts = Object.entries(selections)
      .filter(([, v]) => v?.length > 0)
      .map(([f, v]) => `${f}: ${v.slice(0, 2).join(', ')}${v.length > 2 ? '…' : ''}`);
    return parts.length ? parts.join(' · ').slice(0, 50) : `Bookmark ${bookmarks.length + 1}`;
  }, [selections, bookmarks.length]);

  const [newName, setNewName] = useState(suggestedName);
  useEffect(() => setNewName(suggestedName), [suggestedName]);

  const handleSave = () => {
    const name = newName.trim();
    if (!name) return;
    dispatch({ type: 'SAVE_BOOKMARK', payload: { id: uuid(), name } });
    onClose();
  };

  return (
    <>
      {/* Save current selections */}
      {hasSelections && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Save current selections as:</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input input-sm"
              style={{ flex: 1 }}
              placeholder="Bookmark name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              autoFocus={autoFocus}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={!newName.trim()}
              style={{ minWidth: 54 }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Saved list */}
      {bookmarks.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
          {hasSelections
            ? 'No bookmarks yet — save one above.'
            : 'Make a selection first, then save it as a bookmark.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bookmarks.map(bm => {
            const preview = Object.entries(bm.selections || {})
              .filter(([, v]) => v?.length > 0)
              .map(([f, v]) => `${f}: ${v.slice(0, 2).join(', ')}${v.length > 2 ? '…' : ''}`)
              .join(' · ');
            return (
              <div key={bm.id} style={{
                display: 'flex', alignItems: 'stretch',
                background: 'var(--bg-alt)', borderRadius: 8, overflow: 'hidden',
              }}>
                <button
                  className="btn btn-ghost"
                  style={{
                    flex: 1, textAlign: 'left', padding: '10px 12px', height: 'auto',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 2, borderRadius: 0, minHeight: 48,
                  }}
                  onClick={() => { dispatch({ type: 'LOAD_BOOKMARK', payload: bm.id }); onClose(); }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>🔖 {bm.name}</span>
                  {preview && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.3 }}>
                      {preview}
                    </span>
                  )}
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: 44, flexShrink: 0, color: 'var(--text-muted)', fontSize: 14, borderRadius: 0 }}
                  onClick={() => dispatch({ type: 'DELETE_BOOKMARK', payload: bm.id })}
                  title="Delete bookmark"
                >✕</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Bookmarks panel — dropdown on desktop, bottom sheet on mobile ─────────────
function BookmarksPanel({ bookmarks, selections, dispatch, onClose }) {
  const ref = useRef(null);
  const mobile = isMobileDevice();
  useOutsideClose(ref, onClose, !mobile); // desktop only; mobile uses overlay tap

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontWeight: 600, fontSize: 14 }}>Bookmarks</span>
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', padding: '0 4px', lineHeight: 1, minWidth: 32, minHeight: 32 }}
      >×</button>
    </div>
  );

  if (mobile) {
    return ReactDOM.createPortal(
      <>
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 498 }}
          onClick={onClose}
        />
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 499,
          background: 'var(--card)',
          borderRadius: '20px 20px 0 0',
          padding: '12px 16px 36px',
          maxHeight: '72vh', overflowY: 'auto',
          boxShadow: '0 -4px 32px rgba(0,0,0,.18)',
        }}>
          {/* drag handle */}
          <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 14px' }} />
          {header}
          <BookmarkContent
            bookmarks={bookmarks}
            selections={selections}
            dispatch={dispatch}
            onClose={onClose}
            autoFocus={false}
          />
        </div>
      </>,
      document.body
    );
  }

  return (
    <div ref={ref} className="filter-popup" style={{ right: 0, left: 'auto', minWidth: 280, maxWidth: 340 }}>
      {header}
      <BookmarkContent
        bookmarks={bookmarks}
        selections={selections}
        dispatch={dispatch}
        onClose={onClose}
        autoFocus
      />
    </div>
  );
}

// ── FilterPanel ───────────────────────────────────────────────────────────────
export default function FilterPanel() {
  const { state, dispatch, associativeState } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const addRef = useRef(null);
  useOutsideClose(addRef, () => setAddOpen(false), addOpen);

  const selections = state.selections || {};
  const selectionEntries = Object.entries(selections);
  const existingFields = new Set(selectionEntries.map(([f]) => f));
  const bookmarks = state.dashboard.bookmarks || [];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>Selections:</span>

      <button className="btn btn-ghost btn-sm" title="Undo selection (Ctrl+Z)"
        onClick={() => dispatch({ type: 'SELECTION_UNDO' })} style={{ padding: '0 6px', fontSize: 14 }}>←</button>
      <button className="btn btn-ghost btn-sm" title="Redo selection (Ctrl+Y)"
        onClick={() => dispatch({ type: 'SELECTION_REDO' })} style={{ padding: '0 6px', fontSize: 14 }}>→</button>

      {selectionEntries.map(([field, values]) => (
        <SelectionPill
          key={field}
          field={field}
          values={values}
          colStore={state.colStore}
          associativeState={associativeState}
          dispatch={dispatch}
        />
      ))}

      <div ref={addRef} style={{ position: 'relative' }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={state.datasets.length === 0}
          onClick={() => setAddOpen(o => !o)}
        >
          + Selection
        </button>
        {addOpen && (
          <AddSelectionPopup
            colStore={state.colStore}
            existingFields={existingFields}
            onAdd={field => dispatch({ type: 'SET_SELECTION', payload: { field, values: [] } })}
            onClose={() => setAddOpen(false)}
          />
        )}
      </div>

      {selectionEntries.length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'CLEAR_ALL_SELECTIONS' })}>
          Clear all
        </button>
      )}

      {/* Bookmarks */}
      <div style={{ position: 'relative', marginLeft: 'auto' }}>
        <button
          className={`btn btn-sm ${bookmarks.length > 0 ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setBookmarksOpen(o => !o)}
          title="Saved selection bookmarks"
          disabled={state.datasets.length === 0}
          style={{ gap: 4 }}
        >
          🔖
          {bookmarks.length > 0 && (
            <span style={{
              background: 'var(--primary)', color: '#fff',
              borderRadius: 10, fontSize: 10, fontWeight: 700,
              padding: '1px 5px', lineHeight: 1.4,
            }}>{bookmarks.length}</span>
          )}
        </button>
        {bookmarksOpen && (
          <BookmarksPanel
            bookmarks={bookmarks}
            selections={selections}
            dispatch={dispatch}
            onClose={() => setBookmarksOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
