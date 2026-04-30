import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { getFieldsByTable } from '../../utils/associativeEngine';

// ── Selection pill popup (categorical) ───────────────────────────────────────
function SelectionPopup({ field, colStore, associativeState, selectedValues, dispatch, onClose }) {
  const [search, setSearch] = useState('');

  // Get all possible values from the shared dictionary
  const allValues = useMemo(() => {
    const dict = colStore.dicts?.[field];
    if (dict) return [...dict].sort();
    // Fallback: scan all tables for this field
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

  const toggle = (v) => {
    dispatch({ type: 'TOGGLE_SELECTION', payload: { field, value: v } });
  };

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
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 4 }}>No matches</div>
        )}
        {filtered.map(v => (
          <label key={v} className="checkbox-row" style={{ marginBottom: 4, ...getValueStyle(v) }}>
            <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
            <span style={{ fontSize: 12 }}>{v || '(blank)'}</span>
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

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
          style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-light)', padding: 0 }}
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

  // Group fields by table, excluding already-selected fields
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
  const itemStyle = { padding: '4px 8px', cursor: 'pointer', fontSize: 12, borderRadius: 3 };

  return (
    <div className="filter-popup" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, minWidth: 220 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Add Selection</div>
      <input
        ref={inputRef}
        className="input input-sm"
        style={{ width: '100%', marginBottom: 6 }}
        placeholder="Search fields..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0' }}>
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
              <div key={c.name} style={itemStyle}
                onClick={() => { onAdd(c.name); onClose(); }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}>
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

// ── FilterPanel (now selection-based) ────────────────────────────────────────
export default function FilterPanel() {
  const { state, dispatch, associativeState } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selections = state.selections || {};
  const selectionEntries = Object.entries(selections);
  const existingFields = new Set(selectionEntries.map(([f]) => f));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>Selections:</span>

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
    </div>
  );
}
