import { useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { getColumnInfo, readCSVFile, joinDatasets, applyTransformsUpTo, detectColumnTypes } from '../../utils/dataUtils';
import { useBreakpoint } from '../../hooks/useMediaQuery';
import DataModel from './DataModel';
import ImportWizard from './ImportWizard';
import InlineTableEditor from './InlineTableEditor';

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.xlsb', '.xlsm', '.ods', '.json'];
const ACCEPTED_MIME = '.csv,.xlsx,.xls,.xlsb,.xlsm,.ods,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

function getFileExtension(name) {
  return (name || '').split('.').pop().toLowerCase();
}

// ── File Uploader ─────────────────────────────────────────────────────────────
function FileUploader({ onLoad, compact }) {
  const [dragging, setDragging] = useState(false);
  const [wizardFile, setWizardFile] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = getFileExtension(file.name);

    // CSV: direct import (no wizard needed)
    if (ext === 'csv') {
      try {
        const { data } = await readCSVFile(file);
        if (data.length) onLoad(file.name, data);
        else alert('No data found in file.');
      } catch (err) {
        alert('Parse error: ' + err.message);
      }
      return;
    }

    // Excel or JSON: open wizard
    if (['xlsx', 'xls', 'xlsb', 'xlsm', 'ods', 'json'].includes(ext)) {
      setWizardFile(file);
      return;
    }

    alert('Unsupported file type. Use CSV, Excel (.xlsx/.xls), or JSON.');
  }, [onLoad]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const ext = getFileExtension(file.name);
    if (ACCEPTED_EXTENSIONS.includes('.' + ext)) {
      handleFile(file);
    } else {
      alert('Unsupported file type. Use CSV, Excel (.xlsx/.xls), or JSON.');
    }
  }, [handleFile]);

  return (
    <>
      <div
        className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={compact ? { padding: '14px 12px' } : undefined}
      >
        {!compact && <div className="drop-zone-icon">📂</div>}
        <div style={{ fontWeight: 600, marginBottom: compact ? 0 : 4, fontSize: compact ? 12 : undefined }}>
          {compact ? '📂 Drop file or click to browse' : 'Drop file here or click to browse'}
        </div>
        {!compact && <div className="text-sm text-muted">Supported: CSV, Excel (.xlsx/.xls), JSON</div>}
        <input
          ref={inputRef} type="file" accept={ACCEPTED_MIME} hidden
          onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }}
        />
      </div>
      {wizardFile && (
        <ImportWizard
          file={wizardFile}
          onImport={onLoad}
          onClose={() => setWizardFile(null)}
        />
      )}
    </>
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
    if (type === 'cast' && (!cfg.field || !cfg.targetType)) return alert('Select field and target type.');
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
          <option value="cast">Change type</option>
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

      {type === 'cast' && (
        <>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Field</label>
            <select className="select select-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)}>
              <option value="">— select —</option>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label className="form-label">Convert to</label>
            <select className="select select-sm" value={cfg.targetType || ''} onChange={e => set('targetType', e.target.value)}>
              <option value="">— select —</option>
              <option value="string">String (text)</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Boolean</option>
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
    case 'cast':    return `${t.field} → ${t.targetType}`;
    default:        return t.type;
  }
}

// ── Column type badge with dropdown ───────────────────────────────────────────
const TYPE_OPTIONS = ['string', 'number', 'date', 'boolean'];
const TYPE_ICONS = { string: 'Aa', number: '#', date: '📅', boolean: '⊘' };
const TYPE_COLORS = { string: '#6366f1', number: '#0891b2', date: '#d97706', boolean: '#059669' };

function TypeBadge({ col, datasetId, dispatch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleCast = (targetType) => {
    if (targetType === col.type) { setOpen(false); return; }
    dispatch({
      type: 'ADD_TRANSFORM',
      payload: {
        datasetId,
        transform: { type: 'cast', field: col.name, targetType },
      },
    });
    setOpen(false);
  };

  return (
    <span className="col-type-wrap" ref={ref}>
      <span
        className="col-type col-type--clickable"
        style={{ color: TYPE_COLORS[col.type] || '#6366f1' }}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="Click to change type"
      >
        {TYPE_ICONS[col.type] || 'Aa'} {col.type}
      </span>
      {open && (
        <div className="col-type-dropdown">
          {TYPE_OPTIONS.map(t => (
            <button
              key={t}
              className={`col-type-option ${t === col.type ? 'col-type-option--active' : ''}`}
              onClick={() => handleCast(t)}
            >
              <span style={{ color: TYPE_COLORS[t], marginRight: 6 }}>{TYPE_ICONS[t]}</span>
              {t}
              {t === col.type && ' ✓'}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ── Data Preview ──────────────────────────────────────────────────────────────
function DataPreview({ dataset, dispatch }) {
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
                  <TypeBadge col={c} datasetId={dataset.id} dispatch={dispatch} />
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

// ── Source icon helper ────────────────────────────────────────────────────────
function sourceIcon(source) {
  if (!source) return '📂';
  switch (source.type) {
    case 'file':    return '📂';
    case 'inline':  return '✏️';
    case 'join':    return '⛓';
    case 'import':  return '📦';
    default:        return '📂';
  }
}

function sourceLabel(source) {
  if (!source) return 'File import';
  switch (source.type) {
    case 'file':    return 'File import';
    case 'inline':  return 'Inline table';
    case 'join':    return `${source.joinType} join: ${source.leftName}.${source.leftField} = ${source.rightName}.${source.rightField}`;
    case 'import':  return 'Imported';
    default:        return 'File import';
  }
}

// ── Dataset item with inline rename ──────────────────────────────────────────
function DatasetItem({ ds, isActive, dispatch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ds.name);
  const inputRef = useRef(null);

  const startEdit = (e) => {
    e.stopPropagation();
    setDraft(ds.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== ds.name) {
      dispatch({ type: 'RENAME_DATASET', payload: { id: ds.id, name: trimmed } });
    }
    setEditing(false);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${ds.name}"? This cannot be undone.`)) {
      dispatch({ type: 'DELETE_DATASET', payload: ds.id });
    }
  };

  return (
    <div
      className={`di-dataset-item ${isActive ? 'di-dataset-item--active' : ''}`}
      onClick={() => dispatch({ type: 'SET_ACTIVE_DATASET', payload: ds.id })}
    >
      <span style={{ fontSize: 16 }} title={sourceLabel(ds.source)}>{sourceIcon(ds.source)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            className="input input-sm"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            onClick={e => e.stopPropagation()}
            style={{ padding: '1px 4px', fontSize: 12, width: '100%' }}
            autoFocus
          />
        ) : (
          <div className="di-dataset-item-name truncate" onDoubleClick={startEdit}>{ds.name}</div>
        )}
        <div className="di-dataset-item-meta">
          {ds.data.length.toLocaleString()} rows · {ds.columns.length} cols
          {ds.transforms.length > 0 && ` · ${ds.transforms.length} tx`}
        </div>
      </div>
      {!editing && (
        <button
          className="btn btn-ghost btn-icon di-delete-btn"
          onClick={handleDelete}
          title="Delete dataset"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Transforms content (shared between desktop right panel & tablet tab) ─────
function TransformsContent({ activeDataset, dispatch, showForm, setShowForm }) {
  return (
    <>
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
    </>
  );
}

// ── Join Panel ───────────────────────────────────────────────────────────────
const JOIN_TYPES = [
  { value: 'inner', label: 'Inner Join', desc: 'Only matching rows from both tables' },
  { value: 'left',  label: 'Left Join',  desc: 'All rows from left, matching from right' },
  { value: 'right', label: 'Right Join', desc: 'All rows from right, matching from left' },
  { value: 'full',  label: 'Full Join',  desc: 'All rows from both tables' },
];

function JoinPanel({ datasets, dispatch }) {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [leftField, setLeftField] = useState('');
  const [rightField, setRightField] = useState('');
  const [joinType, setJoinType] = useState('inner');
  const [resultName, setResultName] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  const leftDs = datasets.find(d => d.id === leftId);
  const rightDs = datasets.find(d => d.id === rightId);
  const leftCols = leftDs ? getColumnInfo(leftDs.data) : [];
  const rightCols = rightDs ? getColumnInfo(rightDs.data) : [];

  // Auto-detect matching columns
  useEffect(() => {
    if (leftCols.length > 0 && rightCols.length > 0 && !leftField && !rightField) {
      const leftNames = new Set(leftCols.map(c => c.name));
      const match = rightCols.find(c => leftNames.has(c.name));
      if (match) {
        setLeftField(match.name);
        setRightField(match.name);
      }
    }
  }, [leftId, rightId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto name
  useEffect(() => {
    if (leftDs && rightDs) {
      setResultName(`${leftDs.name}_${rightDs.name}`);
    }
  }, [leftDs, rightDs]);

  const handlePreview = () => {
    if (!leftDs || !rightDs || !leftField || !rightField) return;
    setError(null);
    try {
      const result = joinDatasets(leftDs.data, rightDs.data, leftField, rightField, joinType);
      setPreview(result.slice(0, 10));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    }
  };

  const handleJoin = () => {
    if (!leftDs || !rightDs || !leftField || !rightField) return;
    setError(null);
    try {
      const result = joinDatasets(leftDs.data, rightDs.data, leftField, rightField, joinType);
      if (result.length === 0) {
        setError('Join produced no rows. Check your join fields and type.');
        return;
      }
      dispatch({ type: 'LOAD_DATASET', payload: {
        name: resultName || 'Joined Table',
        data: result,
        source: {
          type: 'join',
          leftName: leftDs.name,
          rightName: rightDs.name,
          leftField,
          rightField,
          joinType,
        },
      } });
    } catch (err) {
      setError(err.message);
    }
  };

  if (datasets.length < 2) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">🔗</div>
        <h3>Join Tables</h3>
        <p>Load at least 2 datasets to join them together.</p>
      </div>
    );
  }

  return (
    <div className="join-panel">
      <div className="join-panel-title">Join Tables</div>

      <div className="join-config">
        {/* Left table */}
        <div className="join-side">
          <label className="form-label">Left table</label>
          <select className="select select-sm" value={leftId} onChange={e => { setLeftId(e.target.value); setLeftField(''); }}>
            <option value="">— select —</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.data.length} rows)</option>)}
          </select>
          {leftCols.length > 0 && (
            <>
              <label className="form-label" style={{ marginTop: 8 }}>Join field</label>
              <select className="select select-sm" value={leftField} onChange={e => setLeftField(e.target.value)}>
                <option value="">— select —</option>
                {leftCols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
              </select>
            </>
          )}
        </div>

        {/* Join type */}
        <div className="join-type-col">
          <label className="form-label">Join type</label>
          {JOIN_TYPES.map(jt => (
            <label key={jt.value} className={`join-type-option ${joinType === jt.value ? 'join-type-option--active' : ''}`}>
              <input type="radio" name="joinType" value={jt.value} checked={joinType === jt.value} onChange={e => setJoinType(e.target.value)} />
              <div>
                <div className="join-type-label">{jt.label}</div>
                <div className="join-type-desc">{jt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Right table */}
        <div className="join-side">
          <label className="form-label">Right table</label>
          <select className="select select-sm" value={rightId} onChange={e => { setRightId(e.target.value); setRightField(''); }}>
            <option value="">— select —</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.data.length} rows)</option>)}
          </select>
          {rightCols.length > 0 && (
            <>
              <label className="form-label" style={{ marginTop: 8 }}>Join field</label>
              <select className="select select-sm" value={rightField} onChange={e => setRightField(e.target.value)}>
                <option value="">— select —</option>
                {rightCols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Result name + actions */}
      <div className="join-actions">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Result table name</label>
          <input className="input input-sm" value={resultName} onChange={e => setResultName(e.target.value)} placeholder="Joined table name" />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          disabled={!leftDs || !rightDs || !leftField || !rightField}
          onClick={handlePreview}
        >Preview</button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!leftDs || !rightDs || !leftField || !rightField}
          onClick={handleJoin}
        >Join</button>
      </div>

      {error && <div className="join-error">{error}</div>}

      {/* Preview table */}
      {preview && preview.length > 0 && (
        <div className="join-preview">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Preview (first {preview.length} rows)
          </div>
          <div className="wizard-preview-table-wrap">
            <table className="wizard-preview-table">
              <thead>
                <tr>
                  {Object.keys(preview[0]).map(col => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.keys(preview[0]).map(col => (
                      <td key={col}>{row[col] == null ? '' : String(row[col])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pipeline View ────────────────────────────────────────────────────────────
// ── Pipeline: single transform step (interactive) ────────────────────────────
function PipelineStep({ t, idx, total, dsId, isInspected, onInspect, dispatch }) {
  const [editing, setEditing] = useState(false);
  const [editCfg, setEditCfg] = useState({});

  const startEdit = () => {
    // Pre-fill editCfg from the transform
    const { id, type, disabled, ...rest } = t;
    setEditCfg(rest);
    setEditing(true);
  };

  const saveEdit = () => {
    dispatch({ type: 'UPDATE_TRANSFORM', payload: { datasetId: dsId, transformId: t.id, updates: editCfg } });
    setEditing(false);
  };

  const toggleDisabled = () => {
    dispatch({ type: 'UPDATE_TRANSFORM', payload: { datasetId: dsId, transformId: t.id, updates: { disabled: !t.disabled } } });
  };

  const moveUp = () => {
    if (idx > 0) dispatch({ type: 'MOVE_TRANSFORM', payload: { datasetId: dsId, from: idx, to: idx - 1 } });
  };

  const moveDown = () => {
    if (idx < total - 1) dispatch({ type: 'MOVE_TRANSFORM', payload: { datasetId: dsId, from: idx, to: idx + 1 } });
  };

  const remove = () => {
    dispatch({ type: 'REMOVE_TRANSFORM', payload: { datasetId: dsId, transformId: t.id } });
  };

  return (
    <div className={`pl-step ${t.disabled ? 'pl-step--disabled' : ''} ${isInspected ? 'pl-step--inspected' : ''}`}>
      <div className="pl-step-main" onClick={() => onInspect(idx)}>
        {/* Left: number + toggle */}
        <button className="pl-step-toggle" onClick={e => { e.stopPropagation(); toggleDisabled(); }} title={t.disabled ? 'Enable' : 'Disable'}>
          {t.disabled ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--accent, #3b82f6)" strokeWidth="1.5" fill="var(--accent, #3b82f6)"/><path d="M4.5 8L7 10.5L11.5 5.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </button>

        <span className="pl-step-num">{idx + 1}</span>
        <span className="pl-step-type">{t.type}</span>
        <span className="pl-step-desc">{describeTransform(t)}</span>

        {/* Right: actions */}
        <div className="pl-step-actions">
          <button className="pl-act" onClick={e => { e.stopPropagation(); moveUp(); }} disabled={idx === 0} title="Move up">▲</button>
          <button className="pl-act" onClick={e => { e.stopPropagation(); moveDown(); }} disabled={idx === total - 1} title="Move down">▼</button>
          <button className="pl-act" onClick={e => { e.stopPropagation(); startEdit(); }} title="Edit">✎</button>
          <button className="pl-act pl-act--danger" onClick={e => { e.stopPropagation(); remove(); }} title="Delete">✕</button>
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="pl-step-edit">
          {renderEditFields(t.type, editCfg, (k, v) => setEditCfg(c => ({ ...c, [k]: v })))}
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Render inline edit fields for a given transform type */
function renderEditFields(type, cfg, set) {
  switch (type) {
    case 'filter':
      return (
        <>
          <div className="pl-edit-row">
            <label>Field</label>
            <input className="input input-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)} />
          </div>
          <div className="pl-edit-row">
            <label>Operator</label>
            <select className="select select-sm" value={cfg.operator || ''} onChange={e => set('operator', e.target.value)}>
              {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
          </div>
          {cfg.operator && !['is null', 'is not null'].includes(cfg.operator) && (
            <div className="pl-edit-row">
              <label>Value</label>
              <input className="input input-sm" value={cfg.value || ''} onChange={e => set('value', e.target.value)} />
            </div>
          )}
        </>
      );
    case 'rename':
      return (
        <>
          <div className="pl-edit-row">
            <label>Old name</label>
            <input className="input input-sm" value={cfg.oldName || ''} onChange={e => set('oldName', e.target.value)} />
          </div>
          <div className="pl-edit-row">
            <label>New name</label>
            <input className="input input-sm" value={cfg.newName || ''} onChange={e => set('newName', e.target.value)} />
          </div>
        </>
      );
    case 'compute':
      return (
        <>
          <div className="pl-edit-row">
            <label>Column</label>
            <input className="input input-sm" value={cfg.newColumn || ''} onChange={e => set('newColumn', e.target.value)} />
          </div>
          <div className="pl-edit-row">
            <label>Expression</label>
            <input className="input input-sm" value={cfg.expression || ''} onChange={e => set('expression', e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          </div>
        </>
      );
    case 'sort':
      return (
        <>
          <div className="pl-edit-row">
            <label>Field</label>
            <input className="input input-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)} />
          </div>
          <div className="pl-edit-row">
            <label>Direction</label>
            <select className="select select-sm" value={cfg.direction || 'asc'} onChange={e => set('direction', e.target.value)}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </>
      );
    case 'cast':
      return (
        <>
          <div className="pl-edit-row">
            <label>Field</label>
            <input className="input input-sm" value={cfg.field || ''} onChange={e => set('field', e.target.value)} />
          </div>
          <div className="pl-edit-row">
            <label>Type</label>
            <select className="select select-sm" value={cfg.targetType || ''} onChange={e => set('targetType', e.target.value)}>
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Boolean</option>
            </select>
          </div>
        </>
      );
    default:
      return <div className="text-sm text-muted">No editable fields</div>;
  }
}

// ── Pipeline View (full interactive) ─────────────────────────────────────────
function PipelineView({ datasets, dispatch }) {
  const [expandedDs, setExpandedDs] = useState(null);   // dataset id
  const [inspectedStep, setInspectedStep] = useState(-1); // -1 = original, 0..N = after step N
  const [previewData, setPreviewData] = useState(null);

  // When inspected step changes, compute intermediate data
  useEffect(() => {
    if (!expandedDs) { setPreviewData(null); return; }
    const ds = datasets.find(d => d.id === expandedDs);
    if (!ds) { setPreviewData(null); return; }

    if (inspectedStep === -1) {
      // Show original data (before transforms)
      const slice = ds.originalData.slice(0, 50);
      setPreviewData({ rows: slice, cols: Object.keys(slice[0] || {}), rowCount: ds.originalData.length });
    } else {
      const intermediate = applyTransformsUpTo(ds.originalData, ds.transforms, inspectedStep);
      const slice = intermediate.slice(0, 50);
      const types = detectColumnTypes(slice);
      setPreviewData({ rows: slice, cols: Object.keys(slice[0] || {}), rowCount: intermediate.length, types });
    }
  }, [expandedDs, inspectedStep, datasets]);

  if (datasets.length === 0) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">📋</div>
        <h3>No datasets yet</h3>
        <p>Load a file, create an inline table, or join tables to see your data pipeline.</p>
      </div>
    );
  }

  const toggleExpand = (dsId) => {
    if (expandedDs === dsId) {
      setExpandedDs(null);
      setInspectedStep(-1);
      setPreviewData(null);
    } else {
      setExpandedDs(dsId);
      setInspectedStep(-1);
    }
  };

  return (
    <div className="pipeline-view">
      <div className="pipeline-header">
        <span className="pipeline-title">Data Pipeline</span>
        <span className="text-sm text-muted">{datasets.length} table{datasets.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="pipeline-steps">
        {datasets.map((ds, dsIdx) => {
          const isExpanded = expandedDs === ds.id;
          return (
            <div key={ds.id} className="pipeline-step">
              {dsIdx > 0 && <div className="pipeline-connector" />}

              <div className={`pipeline-card ${isExpanded ? 'pipeline-card--expanded' : ''}`}>
                {/* Card header */}
                <div className="pipeline-card-header" onClick={() => toggleExpand(ds.id)} style={{ cursor: 'pointer' }}>
                  <span className="pipeline-card-icon">{sourceIcon(ds.source)}</span>
                  <span className="pipeline-card-name">{ds.name}</span>
                  <span className="pipeline-card-rows">
                    {ds.originalData.length.toLocaleString()} → {ds.data.length.toLocaleString()} rows
                  </span>
                  <span className="pipeline-expand-arrow">{isExpanded ? '▾' : '▸'}</span>
                  <button
                    className="btn btn-ghost btn-icon pipeline-delete"
                    onClick={e => {
                      e.stopPropagation();
                      if (window.confirm(`Delete "${ds.name}"? This cannot be undone.`)) {
                        dispatch({ type: 'DELETE_DATASET', payload: ds.id });
                      }
                    }}
                    title="Delete dataset"
                  >✕</button>
                </div>

                <div className="pipeline-card-source">{sourceLabel(ds.source)}</div>

                {/* Expanded: transform steps */}
                {isExpanded && (
                  <div className="pl-expanded">
                    {/* Original data step */}
                    <div
                      className={`pl-step pl-step--origin ${inspectedStep === -1 ? 'pl-step--inspected' : ''}`}
                      onClick={() => setInspectedStep(-1)}
                    >
                      <div className="pl-step-main">
                        <span className="pl-step-num">0</span>
                        <span className="pl-step-type" style={{ background: 'rgba(16,185,129,.1)', color: '#059669' }}>source</span>
                        <span className="pl-step-desc">Original data ({ds.originalData.length.toLocaleString()} rows, {Object.keys(ds.originalData[0] || {}).length} cols)</span>
                      </div>
                    </div>

                    {/* Transform steps */}
                    {ds.transforms.map((t, ti) => (
                      <PipelineStep
                        key={t.id}
                        t={t}
                        idx={ti}
                        total={ds.transforms.length}
                        dsId={ds.id}
                        isInspected={inspectedStep === ti}
                        onInspect={setInspectedStep}
                        dispatch={dispatch}
                      />
                    ))}

                    {ds.transforms.length === 0 && (
                      <div className="pl-no-transforms">No transforms. Select this table in the sidebar and add transforms from the Transforms panel.</div>
                    )}

                    {/* Data preview at inspected step */}
                    {previewData && previewData.rows.length > 0 && (
                      <div className="pl-preview">
                        <div className="pl-preview-header">
                          {inspectedStep === -1 ? 'Original data' : `After step ${inspectedStep + 1}: ${describeTransform(ds.transforms[inspectedStep])}`}
                          <span className="text-sm text-muted" style={{ marginLeft: 8 }}>
                            {previewData.rowCount.toLocaleString()} rows · {previewData.cols.length} cols
                            {previewData.rowCount > 50 && ' (showing first 50)'}
                          </span>
                        </div>
                        <div className="wizard-preview-table-wrap" style={{ maxHeight: 200 }}>
                          <table className="wizard-preview-table">
                            <thead>
                              <tr>
                                {previewData.cols.map(col => <th key={col}>{col}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.rows.slice(0, 20).map((row, i) => (
                                <tr key={i}>
                                  {previewData.cols.map(col => (
                                    <td key={col}>{row[col] == null ? '' : String(row[col])}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsed: summary */}
                {!isExpanded && ds.transforms.length > 0 && (
                  <div className="pipeline-card-cols" style={{ borderTop: '1px solid var(--border-light, rgba(0,0,0,.04))' }}>
                    <span className="text-sm text-muted">{ds.transforms.length} transform{ds.transforms.length !== 1 ? 's' : ''}: </span>
                    {ds.transforms.map((t, ti) => (
                      <span key={t.id} className={`pipeline-col-tag ${t.disabled ? 'pipeline-col-tag--disabled' : ''}`}>
                        {ti + 1}. {t.type}{t.disabled ? ' (off)' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Center area (shared between desktop & tablet) ────────────────────────────
function CenterPanel({ view, setView, activeDataset, modelPositions, setModelPositions, dispatch, datasets }) {
  return (
    <div className="di-center">
      <div className="di-view-tabs">
        <button
          className={`di-view-tab ${view === 'data' ? 'di-view-tab--active' : ''}`}
          onClick={() => setView('data')}
        >
          📋 Data Preview
        </button>
        <button
          className={`di-view-tab ${view === 'pipeline' ? 'di-view-tab--active' : ''}`}
          onClick={() => setView('pipeline')}
        >
          📋 Pipeline
        </button>
        <button
          className={`di-view-tab ${view === 'join' ? 'di-view-tab--active' : ''}`}
          onClick={() => setView('join')}
        >
          ⛓ Join
        </button>
        <button
          className={`di-view-tab ${view === 'model' ? 'di-view-tab--active' : ''}`}
          onClick={() => setView('model')}
        >
          🔗 Model
        </button>
      </div>
      {view === 'data' ? (
        <div className="di-preview">
          {activeDataset
            ? <DataPreview dataset={activeDataset} dispatch={dispatch} />
            : <div className="empty-state" style={{ height: '100%' }}>
                <div className="empty-state-icon">📊</div>
                <h3>No dataset selected</h3>
                <p>Load a file to preview and transform your data.</p>
              </div>
          }
        </div>
      ) : view === 'pipeline' ? (
        <div className="di-preview">
          <PipelineView datasets={datasets} dispatch={dispatch} />
        </div>
      ) : view === 'join' ? (
        <div className="di-preview">
          <JoinPanel datasets={datasets} dispatch={dispatch} />
        </div>
      ) : (
        <DataModel positions={modelPositions} onPositionsChange={setModelPositions} />
      )}
    </div>
  );
}

// ── Main DataIntegration component ────────────────────────────────────────────
export default function DataIntegration() {
  const { state, dispatch } = useApp();
  const { isTablet } = useBreakpoint();
  const [showForm, setShowForm] = useState(false);
  const [showInlineEditor, setShowInlineEditor] = useState(false);
  const [view, setView] = useState('data'); // 'data' | 'join' | 'model'
  const [leftTab, setLeftTab] = useState('datasets'); // tablet: 'datasets' | 'transforms'
  const modelPositions = state.dashboard.modelPositions;
  const setModelPositions = useCallback((pos) => {
    dispatch({ type: 'SET_MODEL_POSITIONS', payload: typeof pos === 'function' ? pos(state.dashboard.modelPositions) : pos });
  }, [dispatch, state.dashboard.modelPositions]);

  const activeDataset = state.datasets.find(d => d.id === state.activeDatasetId);

  const handleLoad = useCallback((name, data, source) => {
    dispatch({ type: 'LOAD_DATASET', payload: { name, data, source } });
  }, [dispatch]);

  // ── Tablet: merge left + right into a single tabbed panel ──
  if (isTablet) {
    const txCount = activeDataset?.transforms.length || 0;
    return (
      <div className="di-layout">
        <div className="di-left di-left--tablet">
          {/* Sub-tabs: Datasets | Transforms */}
          <div className="di-panel-tabs">
            <button
              className={`di-panel-tab ${leftTab === 'datasets' ? 'di-panel-tab--active' : ''}`}
              onClick={() => setLeftTab('datasets')}
            >
              🗄 Datasets
              {state.datasets.length > 0 && (
                <span className="badge badge-blue" style={{ marginLeft: 4 }}>{state.datasets.length}</span>
              )}
            </button>
            <button
              className={`di-panel-tab ${leftTab === 'transforms' ? 'di-panel-tab--active' : ''}`}
              onClick={() => setLeftTab('transforms')}
            >
              ⚙ Transforms
              {txCount > 0 && (
                <span className="badge badge-purple" style={{ marginLeft: 4 }}>{txCount}</span>
              )}
            </button>
          </div>

          {leftTab === 'datasets' ? (
            <>
              <div style={{ padding: '8px 10px' }}>
                <FileUploader onLoad={handleLoad} compact />
                <button
                  className="btn btn-secondary btn-sm w-full"
                  style={{ marginTop: 6, fontSize: 12 }}
                  onClick={() => setShowInlineEditor(true)}
                >+ Inline Table</button>
              </div>
              <div className="di-datasets">
                {state.datasets.length === 0 && (
                  <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                    Load a file or create an inline table
                  </div>
                )}
                {state.datasets.map(ds => (
                  <DatasetItem key={ds.id} ds={ds} isActive={ds.id === state.activeDatasetId} dispatch={dispatch} />
                ))}
              </div>
            </>
          ) : (
            <TransformsContent
              activeDataset={activeDataset}
              dispatch={dispatch}
              showForm={showForm}
              setShowForm={setShowForm}
            />
          )}
        </div>

        <CenterPanel
          view={view} setView={setView}
          activeDataset={activeDataset}
          modelPositions={modelPositions}
          setModelPositions={setModelPositions}
          dispatch={dispatch}
          datasets={state.datasets}
        />
        {showInlineEditor && (
          <InlineTableEditor onImport={handleLoad} onClose={() => setShowInlineEditor(false)} />
        )}
      </div>
    );
  }

  // ── Desktop: original three-panel layout ──
  return (
    <div className="di-layout">
      {/* ── Left: dataset list ── */}
      <div className="di-left">
        <div className="di-left-header">
          <div className="section-title">Datasets</div>
          <FileUploader onLoad={handleLoad} />
          <button
            className="btn btn-secondary btn-sm w-full"
            style={{ marginTop: 6 }}
            onClick={() => setShowInlineEditor(true)}
          >+ Inline Table</button>
        </div>
        <div className="di-datasets">
          {state.datasets.length === 0 && (
            <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              Load a file or create an inline table
            </div>
          )}
          {state.datasets.map(ds => (
            <DatasetItem
              key={ds.id}
              ds={ds}
              isActive={ds.id === state.activeDatasetId}
              dispatch={dispatch}
            />
          ))}
        </div>
      </div>

      <CenterPanel
        view={view} setView={setView}
        activeDataset={activeDataset}
        modelPositions={modelPositions}
        setModelPositions={setModelPositions}
        dispatch={dispatch}
        datasets={state.datasets}
      />

      {/* ── Right: transforms ── */}
      <div className="di-right">
        <TransformsContent
          activeDataset={activeDataset}
          dispatch={dispatch}
          showForm={showForm}
          setShowForm={setShowForm}
        />
      </div>
      {showInlineEditor && (
        <InlineTableEditor onImport={handleLoad} onClose={() => setShowInlineEditor(false)} />
      )}
    </div>
  );
}
