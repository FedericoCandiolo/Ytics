import { useState, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { getColumnInfo, readCSVFile } from '../../utils/dataUtils';

// ── File Uploader ─────────────────────────────────────────────────────────────
function FileUploader({ onLoad }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const parseFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const { data } = await readCSVFile(file);
      if (data.length) onLoad(file.name, data);
      else alert('No data found in file.');
    } catch (err) {
      alert('Parse error: ' + err.message);
    }
  }, [onLoad]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) parseFile(file);
    else alert('Please drop a CSV file.');
  }, [parseFile]);

  return (
    <div
      className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div className="drop-zone-icon">📂</div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop CSV here or click to browse</div>
      <div className="text-sm text-muted">Supported: .csv files</div>
      <input
        ref={inputRef} type="file" accept=".csv" hidden
        onChange={e => parseFile(e.target.files[0])}
      />
    </div>
  );
}

// ── Transform Form ────────────────────────────────────────────────────────────
const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'contains', 'not contains', 'is null', 'is not null'];

function TransformForm({ columns, onAdd, onClose }) {
  const [type, setType] = useState('filter');
  const [cfg, setCfg] = useState({});
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));

  const handleAdd = () => {
    const t = { type, ...cfg };
    if (type === 'filter' && (!cfg.field || !cfg.operator)) return alert('Fill field and operator.');
    if (type === 'rename' && (!cfg.oldName || !cfg.newName)) return alert('Fill old and new name.');
    if (type === 'compute' && (!cfg.newColumn || !cfg.expression)) return alert('Fill column name and expression.');
    if (type === 'sort' && !cfg.field) return alert('Select a field to sort.');
    onAdd(t);
    onClose();
  };

  return (
    <div className="di-add-form">
      <div className="section-title" style={{ marginBottom: 10 }}>Add Transform</div>
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label className="form-label">Type</label>
        <select className="select select-sm" value={type} onChange={e => { setType(e.target.value); setCfg({}); }}>
          <option value="filter">Filter rows</option>
          <option value="rename">Rename column</option>
          <option value="compute">Computed column</option>
          <option value="sort">Sort</option>
        </select>
      </div>

      {type === 'filter' && (
        <>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Field</label>
            <select className="select select-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)}>
              <option value="">— select —</option>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Operator</label>
            <select className="select select-sm" value={cfg.operator || ''} onChange={e => set('operator', e.target.value)}>
              <option value="">— select —</option>
              {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
          </div>
          {cfg.operator && !['is null', 'is not null'].includes(cfg.operator) && (
            <div className="form-group" style={{ marginBottom: 6 }}>
              <label className="form-label">Value</label>
              <input className="input input-sm" value={cfg.value || ''} onChange={e => set('value', e.target.value)} placeholder="value…" />
            </div>
          )}
        </>
      )}

      {type === 'rename' && (
        <>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Column</label>
            <select className="select select-sm" value={cfg.oldName || ''} onChange={e => set('oldName', e.target.value)}>
              <option value="">— select —</option>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">New name</label>
            <input className="input input-sm" value={cfg.newName || ''} onChange={e => set('newName', e.target.value)} placeholder="new column name" />
          </div>
        </>
      )}

      {type === 'compute' && (
        <>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">New column name</label>
            <input className="input input-sm" value={cfg.newColumn || ''} onChange={e => set('newColumn', e.target.value)} placeholder="e.g. profit" />
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Expression (JS)</label>
            <input className="input input-sm" value={cfg.expression || ''} onChange={e => set('expression', e.target.value)} placeholder="e.g. revenue - cost" style={{ fontFamily: 'var(--font-mono)' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            Use column names as variables. Available: {columns.map(c => c.name).join(', ')}
          </div>
        </>
      )}

      {type === 'sort' && (
        <>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Field</label>
            <select className="select select-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)}>
              <option value="">— select —</option>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Direction</label>
            <select className="select select-sm" value={cfg.direction || 'asc'} onChange={e => set('direction', e.target.value)}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </>
      )}

      <div className="flex gap-2" style={{ marginTop: 10 }}>
        <button className="btn btn-primary btn-sm w-full" onClick={handleAdd}>Add</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Transform description helper ──────────────────────────────────────────────
function describeTransform(t) {
  switch (t.type) {
    case 'filter':  return `${t.field} ${t.operator} ${t.value ?? ''}`.trim();
    case 'rename':  return `${t.oldName} → ${t.newName}`;
    case 'compute': return `${t.newColumn} = ${t.expression}`;
    case 'sort':    return `${t.field} (${t.direction})`;
    default:        return t.type;
  }
}

// ── Data Preview ──────────────────────────────────────────────────────────────
function DataPreview({ dataset }) {
  const cols = getColumnInfo(dataset.data);
  const rows = dataset.data.slice(0, 200);

  if (!cols.length) return (
    <div className="empty-state">
      <div className="empty-state-icon">📭</div>
      <p>No data to preview</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {dataset.data.length.toLocaleString()} rows · {cols.length} columns
          {dataset.transforms.length > 0 && ` · ${dataset.transforms.length} transforms applied`}
        </span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.name}>
                  {c.name}
                  <span className="col-type">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map(c => (
                  <td key={c.name} title={String(row[c.name] ?? '')}>
                    {row[c.name] === null || row[c.name] === undefined ? (
                      <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>null</span>
                    ) : String(row[c.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dataset.data.length > 200 && (
        <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: 12 }}>
          Showing first 200 of {dataset.data.length.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

// ── Main DataIntegration component ────────────────────────────────────────────
export default function DataIntegration() {
  const { state, dispatch } = useApp();
  const [showForm, setShowForm] = useState(false);

  const activeDataset = state.datasets.find(d => d.id === state.activeDatasetId);

  const handleLoad = useCallback((name, data) => {
    dispatch({ type: 'LOAD_DATASET', payload: { name, data } });
  }, [dispatch]);

  return (
    <div className="di-layout">
      {/* ── Left: dataset list ── */}
      <div className="di-left">
        <div className="di-left-header">
          <div className="section-title">Datasets</div>
          <FileUploader onLoad={handleLoad} />
        </div>
        <div className="di-datasets">
          {state.datasets.length === 0 && (
            <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              Load a CSV to get started
            </div>
          )}
          {state.datasets.map(ds => (
            <div
              key={ds.id}
              className={`di-dataset-item ${ds.id === state.activeDatasetId ? 'di-dataset-item--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_ACTIVE_DATASET', payload: ds.id })}
            >
              <span style={{ fontSize: 16 }}>🗄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="di-dataset-item-name truncate">{ds.name}</div>
                <div className="di-dataset-item-meta">
                  {ds.data.length.toLocaleString()} rows · {ds.columns.length} cols
                </div>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={e => { e.stopPropagation(); dispatch({ type: 'DELETE_DATASET', payload: ds.id }); }}
                title="Remove dataset"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Center: data preview ── */}
      <div className="di-center">
        <div className="di-preview">
          {activeDataset
            ? <DataPreview dataset={activeDataset} />
            : <div className="empty-state" style={{ height: '100%' }}>
                <div className="empty-state-icon">📊</div>
                <h3>No dataset selected</h3>
                <p>Load a CSV file from the left panel to preview and transform your data.</p>
              </div>
          }
        </div>
      </div>

      {/* ── Right: transforms ── */}
      <div className="di-right">
        <div className="di-right-header">
          <span style={{ fontWeight: 600, fontSize: 13 }}>Transforms</span>
          <button
            className="btn btn-primary btn-sm"
            disabled={!activeDataset}
            onClick={() => setShowForm(true)}
          >
            + Add
          </button>
        </div>

        <div className="di-transforms">
          {!activeDataset && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              Select a dataset to add transforms
            </div>
          )}
          {activeDataset?.transforms.length === 0 && activeDataset && (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              No transforms yet.<br />Transforms are applied in order.
            </div>
          )}
          {activeDataset?.transforms.map((t, idx) => (
            <div key={t.id} className="di-transform-item">
              <div className="di-transform-header">
                <span style={{ color: 'var(--text-muted)', fontSize: 10, width: 16 }}>{idx + 1}</span>
                <span className="di-transform-type">{t.type}</span>
                <span className="di-transform-desc truncate">{describeTransform(t)}</span>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ fontSize: 11, padding: '2px 4px' }}
                  onClick={() => dispatch({ type: 'REMOVE_TRANSFORM', payload: { datasetId: activeDataset.id, transformId: t.id } })}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {showForm && activeDataset && (
          <TransformForm
            columns={getColumnInfo(activeDataset.data)}
            onAdd={(t) => dispatch({ type: 'ADD_TRANSFORM', payload: { datasetId: activeDataset.id, transform: t } })}
            onClose={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}
