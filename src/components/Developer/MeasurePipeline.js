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

export default function MeasurePipeline({ measures, dataset, onUpdate }) {
  const [expanded, setExpanded] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const rawData = useMemo(() => dataset?.data ?? [], [dataset]);
  const rawCols = useMemo(() => getColumnInfo(rawData), [rawData]);

  // Compute columns available at each step (input columns for that step)
  const stepColumns = useMemo(() => {
    const result = [rawCols]; // step 0 input = raw columns
    let data = rawData.slice(0, 200); // sample for performance
    for (let i = 0; i < measures.length; i++) {
      try {
        data = executeMeasurePipeline(data, [measures[i]]);
        const types = detectColumnTypes(data);
        result.push(Object.keys(types).map(name => ({ name, type: types[name] })));
      } catch {
        result.push(result[result.length - 1]); // fallback to previous
      }
    }
    return result;
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

  // Columns available at a given step index (input to that step)
  const colsAt = (stepIdx) => stepColumns[Math.min(stepIdx, stepColumns.length - 1)] || rawCols;

  return (
    <div className="measure-pipeline">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="form-label" style={{ marginBottom: 0 }}>Measure Pipeline</div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{measures.length} step{measures.length !== 1 ? 's' : ''}</span>
      </div>

      {measures.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0', lineHeight: 1.5 }}>
          No pipeline steps. Charts use raw data with built-in aggregation.
          Add steps for multi-level calculations like "average salary of the most populated city per country".
        </div>
      )}

      {/* Steps */}
      {measures.map((step, idx) => {
        const stepType = STEP_TYPES.find(t => t.type === step.type);
        const isOpen = expanded === step.id;
        const cols = colsAt(idx);

        return (
          <div key={step.id} className="pipeline-step" style={{ marginBottom: 6 }}>
            <div
              className="pipeline-step-header"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                background: isOpen ? '#eff6ff' : 'var(--bg-elevated)', border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
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
          </div>
        );
      })}

      {/* Add step buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
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
      {step.aggregations.map((agg, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
          <select className="select select-sm" value={agg.fn} onChange={e => updateAgg(i, { fn: e.target.value })} style={{ width: 80 }}>
            {Object.entries(AGGREGATIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="select select-sm" value={agg.field} onChange={e => updateAgg(i, { field: e.target.value })} style={{ flex: 1 }}>
            <option value="">— field —</option>
            {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input
            className="input input-sm" placeholder="as..."
            value={agg.as} onChange={e => updateAgg(i, { as: e.target.value })}
            style={{ width: 80 }}
          />
          {step.aggregations.length > 1 && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeAgg(i)}>✕</button>
          )}
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={addAgg}>+ Add aggregation</button>
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
