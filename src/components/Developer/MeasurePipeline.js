import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { getColumnInfo, AGGREGATIONS_BASIC, AGGREGATIONS_ADVANCED, AGGREGATIONS_PARAM, executeMeasurePipeline, detectColumnTypes } from '../../utils/dataUtils';
import { useApp } from '../../context/AppContext';

// ── Searchable field picker for pipeline step editors ────────────────────────
// Supports single-select (click) and multi-select (checkboxes).
function PipelineFieldPicker({ cols, tableGroups, value, onChange, placeholder = '— field —',
                                mode = 'single', style }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const q = search.toLowerCase();
  const groups = useMemo(() => {
    if (tableGroups && tableGroups.length > 1) {
      return tableGroups
        .map(g => ({ ...g, fields: q ? g.fields.filter(c => c.name.toLowerCase().includes(q)) : g.fields }))
        .filter(g => g.fields.length > 0);
    }
    // Flat list
    const list = q ? cols.filter(c => c.name.toLowerCase().includes(q)) : cols;
    if (list.length === 0) return [];
    return [{ key: '__flat', fields: list }];
  }, [tableGroups, cols, q]);

  const showGroupLabels = tableGroups && tableGroups.length > 1;

  const handlePick = useCallback((val) => {
    if (mode === 'single') { onChange(val); setOpen(false); setSearch(''); }
  }, [mode, onChange]);

  const handleToggle = useCallback((name) => {
    const arr = Array.isArray(value) ? value : [];
    onChange(arr.includes(name) ? arr.filter(n => n !== name) : [...arr, name]);
  }, [value, onChange]);

  const displayText = mode === 'single'
    ? (value || placeholder)
    : (Array.isArray(value) && value.length > 0 ? `${value.length} selected` : placeholder);

  const itemStyle = { padding: '3px 8px', cursor: 'pointer', fontSize: 11, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 4 };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <div className="select select-sm"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: (mode === 'single' && !value) ? 'var(--text-muted)' : undefined, userSelect: 'none' }}
        onClick={() => setOpen(!open)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{displayText}</span>
        <span style={{ fontSize: 8, marginLeft: 3, flexShrink: 0 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg, #fff)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,.1)', marginTop: 1, maxHeight: 220, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '4px 4px 3px', borderBottom: '1px solid var(--border)' }}>
            <input ref={inputRef} className="input input-sm" style={{ width: '100%', fontSize: 11 }}
              placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '2px 0' }}>
            {mode === 'single' && (
              <div style={{ ...itemStyle, color: 'var(--text-muted)' }} onClick={() => handlePick('')}>{placeholder}</div>
            )}
            {groups.length === 0 && (
              <div style={{ padding: '6px 8px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>No match</div>
            )}
            {groups.map(g => (
              <div key={g.key || g.tableId}>
                {showGroupLabels && g.tableName && (
                  <div style={{ padding: '3px 8px 1px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{g.tableName}</div>
                )}
                {g.fields.map(c => mode === 'multi' ? (
                  <label key={c.name} style={{ ...itemStyle, cursor: 'pointer' }}>
                    <input type="checkbox" checked={Array.isArray(value) && value.includes(c.name)} onChange={() => handleToggle(c.name)} />
                    {c.name} <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>({c.type})</span>
                  </label>
                ) : (
                  <div key={c.name} style={{ ...itemStyle, background: value === c.name ? '#eff6ff' : undefined }}
                    onClick={() => handlePick(c.name)}
                    onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                    onMouseLeave={e => e.currentTarget.style.background = value === c.name ? '#eff6ff' : ''}>
                    {c.name} <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>({c.type})</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_TYPES_BASIC = [
  { type: 'groupBy', label: 'Group & Aggregate', icon: '⊞', desc: 'Group rows and compute aggregated values' },
  { type: 'topN',    label: 'Top / Bottom N',    icon: '⊤', desc: 'Keep top or bottom N rows (per group)' },
  { type: 'filter',  label: 'Filter',            icon: '⊘', desc: 'Filter rows by condition' },
  { type: 'compute', label: 'Compute Column',    icon: 'ƒ', desc: 'Create a new column from expression' },
  { type: 'sort',    label: 'Sort',              icon: '↕', desc: 'Sort rows by a column' },
];

const STEP_TYPES_ADVANCED = [
  { type: 'formula', label: 'Formula Measure', icon: '∑', desc: 'Compute a measure from a formula (e.g. std / mean)' },
];

const AGG_SHORT = { sum: 'sum', count: 'count', mean: 'avg', min: 'min', max: 'max', median: 'med', std: 'std', p25: 'p25', p75: 'p75', p90: 'p90', p95: 'p95' };

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'contains', 'not contains', 'is null', 'is not null'];

function makeStep(type) {
  const base = { id: uuid(), type };
  switch (type) {
    case 'groupBy': return { ...base, fields: [], aggregations: [{ field: '', fn: 'sum', as: '' }] };
    case 'topN':    return { ...base, groupBy: [], orderBy: '', direction: 'desc', n: 1 };
    case 'filter':  return { ...base, field: '', operator: '>', value: '' };
    case 'compute': return { ...base, newColumn: '', expression: '' };
    case 'formula': return { ...base, newColumn: '', expression: '', description: '' };
    case 'sort':    return { ...base, field: '', direction: 'desc' };
    default:        return base;
  }
}

// Compute the effective output name of an aggregation
function aggOutputName(agg) {
  if (agg.as) return agg.as;
  if (!agg.field) return '';
  return `${AGG_SHORT[agg.fn] || agg.fn}_${agg.field}`;
}

export default function MeasurePipeline({ measures, dataset, onUpdate, allColumns, tableGroups }) {
  const { state } = useApp();
  const advancedStats = state.dashboard.advancedStats;
  const STEP_TYPES = advancedStats ? [...STEP_TYPES_BASIC, ...STEP_TYPES_ADVANCED] : STEP_TYPES_BASIC;
  const [expanded, setExpanded] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const rawData = useMemo(() => dataset?.data ?? [], [dataset]);
  const dataCols = useMemo(() => getColumnInfo(rawData), [rawData]);
  // Use allColumns (all fields from all tables) for first step's field dropdowns,
  // falling back to columns detected from the data
  const rawCols = allColumns?.length > 0 ? allColumns : dataCols;

  // Compute columns available at each step (input columns) AND output columns after each step
  const { stepInputCols, stepOutputCols, stepRowCounts } = useMemo(() => {
    const inputs = [rawCols];
    const outputs = [rawCols];
    const counts = [rawData.length];
    let data = rawData.slice(0, 200);
    for (let i = 0; i < measures.length; i++) {
      try {
        data = executeMeasurePipeline(data, [measures[i]]);
        const types = detectColumnTypes(data);
        const cols = Object.keys(types).map(name => ({ name, type: types[name] }));
        outputs.push(cols);
        inputs.push(cols); // output of step i = input of step i+1
        counts.push(data.length);
      } catch {
        const prev = outputs[outputs.length - 1];
        outputs.push(prev);
        inputs.push(prev);
        counts.push(0);
      }
    }
    return { stepInputCols: inputs, stepOutputCols: outputs, stepRowCounts: counts };
  }, [measures, rawData, rawCols]);

  // Preview output
  const previewData = useMemo(() => {
    if (!showPreview || !rawData.length) return [];
    try {
      return executeMeasurePipeline(rawData.slice(0, 100), measures);
    } catch { return []; }
  }, [showPreview, rawData, measures]);

  const addStep = (type) => {
    const step = makeStep(type);
    onUpdate([...measures, step]);
    setExpanded(step.id);
  };

  const updateStep = (id, updates) => {
    onUpdate(measures.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeStep = (id) => {
    onUpdate(measures.filter(s => s.id !== id));
    if (expanded === id) setExpanded(null);
  };

  const moveStep = (from, to) => {
    const arr = [...measures];
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    onUpdate(arr);
  };

  const colsAt = (stepIdx) => stepInputCols[Math.min(stepIdx, stepInputCols.length - 1)] || rawCols;
  const outputAt = (stepIdx) => stepOutputCols[Math.min(stepIdx + 1, stepOutputCols.length - 1)] || rawCols;
  const rowCountAt = (stepIdx) => stepRowCounts[Math.min(stepIdx + 1, stepRowCounts.length - 1)] ?? '?';

  return (
    <div className="measure-pipeline">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="form-label" style={{ marginBottom: 0 }}>Measure Pipeline</div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{measures.length} step{measures.length !== 1 ? 's' : ''}</span>
      </div>

      {measures.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0', lineHeight: 1.5 }}>
          No pipeline steps. Charts use raw data with built-in aggregation.
          Add steps for multi-level calculations. You can chain multiple
          Group &amp; Aggregate steps for nested averages (e.g., avg per country of avg per state of avg salary).
        </div>
      )}

      {/* Input indicator */}
      {measures.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, padding: '3px 8px', fontSize: 10, color: 'var(--text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8', flexShrink: 0 }} />
          Input: {rawCols.length} columns, {rawData.length.toLocaleString()} rows
        </div>
      )}

      {/* Steps */}
      {measures.map((step, idx) => {
        const stepType = STEP_TYPES.find(t => t.type === step.type);
        const isOpen = expanded === step.id;
        const cols = colsAt(idx);
        const outCols = outputAt(idx);
        const outCount = rowCountAt(idx);

        return (
          <div key={step.id} className="pipeline-step" style={{ marginBottom: 2 }}>
            {/* Connector line */}
            <div style={{ display: 'flex', justifyContent: 'center', height: 10 }}>
              <div style={{ width: 2, height: '100%', background: '#cbd5e1' }} />
            </div>

            <div
              className="pipeline-step-header"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                background: isOpen ? '#eff6ff' : 'var(--bg-elevated)', border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--border)'}`,
                borderRadius: isOpen ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                cursor: 'pointer', fontSize: 12,
              }}
              onClick={() => setExpanded(isOpen ? null : step.id)}
            >
              <span style={{ fontWeight: 600, fontSize: 14, width: 18, textAlign: 'center' }}>{stepType?.icon || '?'}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>#{idx + 1}</span>
                {stepType?.label || step.type}
                {step.type === 'groupBy' && step.fields.length > 0 && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> by {step.fields.join(', ')}</span>
                )}
                {step.type === 'topN' && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {step.direction === 'desc' ? 'top' : 'bottom'} {step.n}</span>
                )}
                {step.type === 'filter' && step.field && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {step.field} {step.operator} {step.value}</span>
                )}
                {step.type === 'compute' && step.newColumn && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> → {step.newColumn}</span>
                )}
                {step.type === 'formula' && step.newColumn && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> → {step.newColumn}</span>
                )}
                {step.type === 'sort' && step.field && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {step.field} {step.direction}</span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 2 }}>
                {idx > 0 && (
                  <button className="btn btn-ghost btn-icon btn-sm" title="Move up" onClick={e => { e.stopPropagation(); moveStep(idx, idx - 1); }}>↑</button>
                )}
                {idx < measures.length - 1 && (
                  <button className="btn btn-ghost btn-icon btn-sm" title="Move down" onClick={e => { e.stopPropagation(); moveStep(idx, idx + 1); }}>↓</button>
                )}
                <button className="btn btn-ghost btn-icon btn-sm" title="Remove" onClick={e => { e.stopPropagation(); removeStep(step.id); }}>✕</button>
              </div>
            </div>

            {isOpen && (
              <div style={{ padding: '8px 8px 4px', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--radius) var(--radius)', background: 'var(--bg)' }}>
                {step.type === 'groupBy' && <GroupByEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
                {step.type === 'topN' && <TopNEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
                {step.type === 'filter' && <FilterEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
                {step.type === 'compute' && <ComputeEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
                {step.type === 'formula' && <FormulaEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
                {step.type === 'sort' && <SortEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} tableGroups={idx === 0 ? tableGroups : null} />}
              </div>
            )}

            {/* Output indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', fontSize: 10, color: 'var(--text-muted)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: idx === measures.length - 1 ? '#3b82f6' : '#94a3b8', flexShrink: 0 }} />
              → {outCols.map(c => c.name).join(', ')}
              <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>~{outCount} rows</span>
            </div>
          </div>
        );
      })}

      {/* Add step buttons */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>Add step:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STEP_TYPES.map(st => (
            <button
              key={st.type}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 11 }}
              title={st.desc}
              onClick={() => addStep(st.type)}
            >
              {st.icon} {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      {measures.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, width: '100%' }}
            onClick={() => setShowPreview(p => !p)}
          >
            {showPreview ? '▲ Hide preview' : '▼ Preview output'}
          </button>
          {showPreview && (
            <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginTop: 4, fontSize: 10 }}>
              {previewData.length === 0 ? (
                <div style={{ padding: 8, color: 'var(--text-muted)' }}>No output (check pipeline steps)</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {Object.keys(previewData[0]).map(col => (
                        <th key={col} style={{ padding: '3px 6px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={{ padding: '2px 6px', borderBottom: '1px solid var(--border-light, #f0f0f0)', whiteSpace: 'nowrap' }}>
                            {typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ padding: '2px 6px', color: 'var(--text-muted)', fontSize: 9 }}>
                Showing {Math.min(20, previewData.length)} of {previewData.length} rows (sampled from first 100)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modifier tags for pipeline aggregations ─────────────────────────────────────

function PipelineModifierTags({ distinct, total, onDistinctChange, onTotalChange }) {
  const [open, setOpen] = useState(false);
  const hasModifiers = distinct || total;
  const tagStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: 10, padding: '1px 6px', borderRadius: 10,
    background: 'var(--accent, #3b82f6)', color: '#fff',
    cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: '18px',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2, paddingLeft: 2, flexWrap: 'wrap', position: 'relative' }}>
      {distinct && (
        <span style={tagStyle} onClick={() => onDistinctChange(false)} title="Remove Distinct modifier">
          Distinct <span style={{ fontSize: 9, opacity: 0.8 }}>{'\u2715'}</span>
        </span>
      )}
      {total && (
        <span style={tagStyle} onClick={() => onTotalChange(false)} title="Remove Total modifier">
          Total <span style={{ fontSize: 9, opacity: 0.8 }}>{'\u2715'}</span>
        </span>
      )}
      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 10, padding: '0 4px', lineHeight: '18px', color: 'var(--text-muted)' }}
        onClick={() => setOpen(o => !o)}
        title="Add modifier"
      >
        {hasModifiers ? '+' : '+ Modifier'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 2,
          background: 'var(--bg-elevated, #fff)', border: '1px solid var(--border)', borderRadius: 'var(--radius, 6)',
          boxShadow: '0 4px 12px rgba(0,0,0,.12)', padding: '6px 0', minWidth: 150,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={!!distinct} onChange={e => { onDistinctChange(e.target.checked); }} style={{ margin: 0 }} />
            <div>
              <div style={{ fontWeight: 500 }}>Distinct</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Aggregate only unique values</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={!!total} onChange={e => { onTotalChange(e.target.checked); }} style={{ margin: 0 }} />
            <div>
              <div style={{ fontWeight: 500 }}>Total</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ignore grouping, aggregate all data</div>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}

// ── Step editors ────────────────────────────────────────────────────────────────

function GroupByEditor({ step, cols, onChange, tableGroups }) {
  const { state } = useApp();
  const advancedStats = state.dashboard.advancedStats;
  const addAgg = () => {
    onChange({ aggregations: [...step.aggregations, { field: '', fn: 'sum', as: '' }] });
  };
  const updateAgg = (i, updates) => {
    const aggs = step.aggregations.map((a, j) => j === i ? { ...a, ...updates } : a);
    onChange({ aggregations: aggs });
  };
  const removeAgg = (i) => {
    onChange({ aggregations: step.aggregations.filter((_, j) => j !== i) });
  };

  return (
    <div>
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label className="form-label" style={{ fontSize: 11 }}>Group by columns</label>
        <PipelineFieldPicker cols={cols} tableGroups={tableGroups}
          mode="multi" value={step.fields} placeholder="Select columns..."
          onChange={fields => onChange({ fields })} />
      </div>

      <label className="form-label" style={{ fontSize: 11 }}>Aggregations</label>
      {step.aggregations.map((agg, i) => {
        const autoName = aggOutputName(agg);
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select className="select select-sm" value={agg.fn?.split(':')[0] || 'sum'} onChange={e => {
                const pd = AGGREGATIONS_PARAM[e.target.value];
                updateAgg(i, { fn: pd ? `${e.target.value}:${pd.default}` : e.target.value });
              }} style={{ width: 80 }}>
                <optgroup label="Basic">
                  {Object.entries(AGGREGATIONS_BASIC).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </optgroup>
                {advancedStats && (
                  <optgroup label="Advanced">
                    {Object.entries(AGGREGATIONS_ADVANCED).filter(([v]) => v !== 'concat').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </optgroup>
                )}
                {advancedStats && (
                  <optgroup label="Parameterized">
                    {Object.entries(AGGREGATIONS_PARAM).map(([v, def]) => <option key={v} value={v}>{def.label}</option>)}
                  </optgroup>
                )}
              </select>
              {advancedStats && AGGREGATIONS_PARAM[agg.fn?.split(':')[0]] && (
                AGGREGATIONS_PARAM[agg.fn.split(':')[0]].paramType === 'number' ? (
                  <input type="number" className="input input-sm" style={{ width: 48 }}
                    min={AGGREGATIONS_PARAM[agg.fn.split(':')[0]].min}
                    max={AGGREGATIONS_PARAM[agg.fn.split(':')[0]].max}
                    step={AGGREGATIONS_PARAM[agg.fn.split(':')[0]].step}
                    value={agg.fn.split(':')[1] || AGGREGATIONS_PARAM[agg.fn.split(':')[0]].default}
                    onChange={e => updateAgg(i, { fn: `${agg.fn.split(':')[0]}:${e.target.value}` })}
                  />
                ) : (
                  <input type="text" className="input input-sm" style={{ width: 36 }}
                    value={agg.fn.split(':').slice(1).join(':') ?? AGGREGATIONS_PARAM[agg.fn.split(':')[0]].default}
                    onChange={e => updateAgg(i, { fn: `${agg.fn.split(':')[0]}:${e.target.value}` })}
                    placeholder={AGGREGATIONS_PARAM[agg.fn.split(':')[0]].paramLabel}
                  />
                )
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>of</span>
              <PipelineFieldPicker cols={cols} tableGroups={tableGroups} style={{ flex: 1 }}
                value={agg.field} onChange={v => updateAgg(i, { field: v })} />
              {step.aggregations.length > 1 && (
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAgg(i)}>✕</button>
              )}
            </div>
            <PipelineModifierTags
              distinct={agg.distinct} total={agg.total}
              onDistinctChange={v => updateAgg(i, { distinct: v })}
              onTotalChange={v => updateAgg(i, { total: v })}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, paddingLeft: 2 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>→ save as</span>
              <input
                className="input input-sm"
                placeholder={autoName || 'output name'}
                value={agg.as}
                onChange={e => updateAgg(i, { as: e.target.value })}
                style={{ flex: 1, fontSize: 11 }}
              />
              {!agg.as && autoName && (
                <span style={{ fontSize: 9, color: '#3b82f6', whiteSpace: 'nowrap' }}>({autoName})</span>
              )}
            </div>
          </div>
        );
      })}
      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, marginTop: 4 }} onClick={addAgg}>+ Add aggregation</button>
    </div>
  );
}

function TopNEditor({ step, cols, onChange, tableGroups }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>N (rows to keep)</label>
        <input className="input input-sm" type="number" min={1} value={step.n} onChange={e => onChange({ n: parseInt(e.target.value) || 1 })} />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Order by</label>
        <PipelineFieldPicker cols={cols} tableGroups={tableGroups}
          value={step.orderBy} placeholder="— column —" onChange={v => onChange({ orderBy: v })} />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Direction</label>
        <select className="select select-sm" value={step.direction} onChange={e => onChange({ direction: e.target.value })}>
          <option value="desc">Top (descending)</option>
          <option value="asc">Bottom (ascending)</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Per group (optional)</label>
        <PipelineFieldPicker cols={cols} tableGroups={tableGroups}
          mode="multi" value={step.groupBy || []} placeholder="Select columns..."
          onChange={groupBy => onChange({ groupBy })} />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leave empty for global top/bottom N</div>
      </div>
    </div>
  );
}

function FilterEditor({ step, cols, onChange, tableGroups }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Column</label>
        <PipelineFieldPicker cols={cols} tableGroups={tableGroups}
          value={step.field} placeholder="— column —" onChange={v => onChange({ field: v })} />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Operator</label>
        <select className="select select-sm" value={step.operator} onChange={e => onChange({ operator: e.target.value })}>
          {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
      </div>
      {!['is null', 'is not null'].includes(step.operator) && (
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>Value</label>
          <input className="input input-sm" value={step.value} onChange={e => onChange({ value: e.target.value })} placeholder="comparison value" />
        </div>
      )}
    </div>
  );
}

function ComputeEditor({ step, cols, onChange, tableGroups }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>New column name</label>
        <input className="input input-sm" value={step.newColumn} onChange={e => onChange({ newColumn: e.target.value })} placeholder="e.g. ratio" />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Expression</label>
        <input className="input input-sm" value={step.expression} onChange={e => onChange({ expression: e.target.value })} placeholder="e.g. salary / population" />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          Use column names as variables. Available: {cols.map(c => c.name).join(', ')}
        </div>
      </div>
    </div>
  );
}

function FormulaEditor({ step, cols, onChange, tableGroups }) {
  const numCols = cols.filter(c => c.type === 'number');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Output column name</label>
        <input className="input input-sm" value={step.newColumn} onChange={e => onChange({ newColumn: e.target.value })} placeholder="e.g. coefficient_of_variation" />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Formula</label>
        <textarea
          className="input input-sm"
          rows={2}
          style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          value={step.expression}
          onChange={e => onChange({ expression: e.target.value })}
          placeholder="e.g. std_revenue / mean_revenue"
        />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          Reference any column by name. Use arithmetic operators (+, -, *, /, **) and Math functions (Math.sqrt, Math.log, Math.abs, etc.)
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          Available columns: {cols.map(c => c.name).join(', ') || '(none yet)'}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Description (optional)</label>
        <input className="input input-sm" value={step.description || ''} onChange={e => onChange({ description: e.target.value })} placeholder="What this formula computes" />
      </div>
      {numCols.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px', background: 'var(--bg-elevated)' }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Quick examples:</div>
          <div><code>col_a / col_b</code> — ratio</div>
          <div><code>Math.sqrt(col_a)</code> — square root</div>
          <div><code>(col_a - col_b) / col_b * 100</code> — percent change</div>
          <div><code>col_a &gt; 0 ? col_b / col_a : 0</code> — safe division</div>
        </div>
      )}
    </div>
  );
}

function SortEditor({ step, cols, onChange, tableGroups }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Sort by</label>
        <PipelineFieldPicker cols={cols} tableGroups={tableGroups}
          value={step.field} placeholder="— column —" onChange={v => onChange({ field: v })} />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Direction</label>
        <select className="select select-sm" value={step.direction} onChange={e => onChange({ direction: e.target.value })}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
    </div>
  );
}
