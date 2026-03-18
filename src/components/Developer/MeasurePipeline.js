import { useState, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import { getColumnInfo, AGGREGATIONS, executeMeasurePipeline, detectColumnTypes } from '../../utils/dataUtils';

const STEP_TYPES = [
  { type: 'groupBy', label: 'Group & Aggregate', icon: '⊞', desc: 'Group rows and compute aggregated values' },
  { type: 'topN',    label: 'Top / Bottom N',    icon: '⊤', desc: 'Keep top or bottom N rows (per group)' },
  { type: 'filter',  label: 'Filter',            icon: '⊘', desc: 'Filter rows by condition' },
  { type: 'compute', label: 'Compute Column',    icon: 'ƒ', desc: 'Create a new column from expression' },
  { type: 'sort',    label: 'Sort',              icon: '↕', desc: 'Sort rows by a column' },
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

export default function MeasurePipeline({ measures, dataset, onUpdate }) {
  const [expanded, setExpanded] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const rawData = useMemo(() => dataset?.data ?? [], [dataset]);
  const rawCols = useMemo(() => getColumnInfo(rawData), [rawData]);

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
                {step.type === 'groupBy' && <GroupByEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} />}
                {step.type === 'topN' && <TopNEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} />}
                {step.type === 'filter' && <FilterEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} />}
                {step.type === 'compute' && <ComputeEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} />}
                {step.type === 'sort' && <SortEditor step={step} cols={cols} onChange={u => updateStep(step.id, u)} />}
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

// ── Step editors ────────────────────────────────────────────────────────────────

function GroupByEditor({ step, cols, onChange }) {
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
        <select
          className="select select-sm"
          multiple
          value={step.fields}
          onChange={e => onChange({ fields: [...e.target.selectedOptions].map(o => o.value) })}
          style={{ height: Math.max(60, Math.min(120, cols.length * 22)) }}
        >
          {cols.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Hold Ctrl/Cmd to select multiple</div>
      </div>

      <label className="form-label" style={{ fontSize: 11 }}>Aggregations</label>
      {step.aggregations.map((agg, i) => {
        const autoName = aggOutputName(agg);
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select className="select select-sm" value={agg.fn} onChange={e => updateAgg(i, { fn: e.target.value })} style={{ width: 80 }}>
                {Object.entries(AGGREGATIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>of</span>
              <select className="select select-sm" value={agg.field} onChange={e => updateAgg(i, { field: e.target.value })} style={{ flex: 1 }}>
                <option value="">— field —</option>
                {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              {step.aggregations.length > 1 && (
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAgg(i)}>✕</button>
              )}
            </div>
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

      {/* Hint about multi-level */}
      <div style={{ marginTop: 10, padding: '6px 8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 10, color: '#166534', lineHeight: 1.5 }}>
        <strong>Multi-level:</strong> Add another Group &amp; Aggregate step after this one to compute
        averages-of-averages (e.g., avg per country of avg per state). Each step sees the output columns of the previous step.
      </div>
    </div>
  );
}

function TopNEditor({ step, cols, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>N (rows to keep)</label>
        <input className="input input-sm" type="number" min={1} value={step.n} onChange={e => onChange({ n: parseInt(e.target.value) || 1 })} />
      </div>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Order by</label>
        <select className="select select-sm" value={step.orderBy} onChange={e => onChange({ orderBy: e.target.value })}>
          <option value="">— column —</option>
          {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
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
        <select
          className="select select-sm"
          multiple
          value={step.groupBy || []}
          onChange={e => onChange({ groupBy: [...e.target.selectedOptions].map(o => o.value) })}
          style={{ height: Math.max(44, Math.min(80, cols.length * 22)) }}
        >
          {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Leave empty for global top/bottom N</div>
      </div>
    </div>
  );
}

function FilterEditor({ step, cols, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Column</label>
        <select className="select select-sm" value={step.field} onChange={e => onChange({ field: e.target.value })}>
          <option value="">— column —</option>
          {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
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

function ComputeEditor({ step, cols, onChange }) {
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

function SortEditor({ step, cols, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="form-group">
        <label className="form-label" style={{ fontSize: 11 }}>Sort by</label>
        <select className="select select-sm" value={step.field} onChange={e => onChange({ field: e.target.value })}>
          <option value="">— column —</option>
          {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
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
