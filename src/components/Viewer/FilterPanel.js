import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { getColumnInfo } from '../../utils/dataUtils';
import { v4 as uuid } from 'uuid';

// ── Categorical filter popup ──────────────────────────────────────────────────
function CatFilter({ filter, allData, onUpdate, onClose }) {
  const values = [...new Set(allData.map(d => String(d[filter.field] ?? '')))].sort();
  const selected = filter.values ?? [];

  const toggle = (v) => {
    const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v];
    onUpdate({ values: next });
  };

  return (
    <div>
      <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        {values.map(v => (
          <label key={v} className="checkbox-row" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
            <span style={{ fontSize: 12 }}>{v || '(blank)'}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-secondary btn-sm" onClick={() => onUpdate({ values: values })}>All</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onUpdate({ values: [] })}>None</button>
      </div>
    </div>
  );
}

// ── Range filter popup ────────────────────────────────────────────────────────
function RangeFilter({ filter, allData, onUpdate }) {
  const nums = allData.map(d => Number(d[filter.field])).filter(v => !isNaN(v));
  const [globalMin, globalMax] = [Math.min(...nums), Math.max(...nums)];
  const [min, max] = filter.range ?? [globalMin, globalMax];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Min</label>
          <input className="input input-sm" type="number" value={min}
            onChange={e => onUpdate({ range: [parseFloat(e.target.value), max] })} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Max</label>
          <input className="input input-sm" type="number" value={max}
            onChange={e => onUpdate({ range: [min, parseFloat(e.target.value)] })} />
        </div>
      </div>
      <button className="btn btn-ghost btn-sm"
        onClick={() => onUpdate({ range: [globalMin, globalMax] })}>
        Reset to full range ({globalMin.toFixed(2)} – {globalMax.toFixed(2)})
      </button>
    </div>
  );
}

// ── Single filter pill ────────────────────────────────────────────────────────
function FilterPill({ filter, allData, onUpdate, onRemove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isActive = filter.filterType === 'categorical'
    ? filter.values?.length > 0
    : filter.range != null;

  const summary = filter.filterType === 'categorical'
    ? filter.values?.length ? `${filter.values.length} selected` : 'all'
    : filter.range ? `${filter.range[0]} – ${filter.range[1]}` : 'any';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className={`filter-pill ${isActive ? 'filter-pill--active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span>{filter.field}</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{summary}</span>
        <button
          style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-light)', padding: 0 }}
          onClick={e => { e.stopPropagation(); onRemove(); }}
        >✕</button>
      </div>
      {open && (
        <div className="filter-popup">
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{filter.field}</div>
          {filter.filterType === 'categorical'
            ? <CatFilter filter={filter} allData={allData} onUpdate={u => onUpdate({ ...filter, ...u })} onClose={() => setOpen(false)} />
            : <RangeFilter filter={filter} allData={allData} onUpdate={u => onUpdate({ ...filter, ...u })} />
          }
        </div>
      )}
    </div>
  );
}

// ── Add filter popup ──────────────────────────────────────────────────────────
function AddFilterPopup({ datasets, onAdd, onClose }) {
  const [datasetId, setDatasetId] = useState(datasets[0]?.id || '');
  const [field, setField] = useState('');
  const [filterType, setFilterType] = useState('categorical');

  const ds = datasets.find(d => d.id === datasetId);
  const cols = ds ? getColumnInfo(ds.data) : [];

  const handleAdd = () => {
    if (!field || !datasetId) return;
    const f = {
      id: uuid(),
      datasetId,
      field,
      filterType,
      active: true,
      values: filterType === 'categorical' ? [] : undefined,
      range: undefined,
    };
    onAdd(f);
    onClose();
  };

  return (
    <div className="filter-popup" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Add Filter</div>
      {datasets.length > 1 && (
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label className="form-label">Dataset</label>
          <select className="select select-sm" value={datasetId} onChange={e => { setDatasetId(e.target.value); setField(''); }}>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label className="form-label">Field</label>
        <select className="select select-sm" value={field} onChange={e => {
          const col = cols.find(c => c.name === e.target.value);
          setField(e.target.value);
          setFilterType(col?.type === 'number' ? 'range' : 'categorical');
        }}>
          <option value="">— select —</option>
          {cols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Filter type</label>
        <select className="select select-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="categorical">Categorical</option>
          <option value="range">Numeric range</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={!field} onClick={handleAdd}>Add</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── FilterPanel ───────────────────────────────────────────────────────────────
export default function FilterPanel() {
  const { state, dispatch } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeFilters = Object.values(state.filters);

  const getDataForFilter = (filter) => {
    const ds = state.datasets.find(d => d.id === filter.datasetId);
    return ds?.data ?? [];
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>Filters:</span>

      {activeFilters.map(f => (
        <FilterPill
          key={f.id}
          filter={f}
          allData={getDataForFilter(f)}
          onUpdate={(updated) => dispatch({ type: 'SET_FILTER', payload: updated })}
          onRemove={() => dispatch({ type: 'REMOVE_FILTER', payload: f.id })}
        />
      ))}

      <div ref={addRef} style={{ position: 'relative' }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={state.datasets.length === 0}
          onClick={() => setAddOpen(o => !o)}
        >
          + Filter
        </button>
        {addOpen && (
          <AddFilterPopup
            datasets={state.datasets}
            onAdd={f => dispatch({ type: 'SET_FILTER', payload: f })}
            onClose={() => setAddOpen(false)}
          />
        )}
      </div>

      {activeFilters.length > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}>
          Clear all
        </button>
      )}
    </div>
  );
}
