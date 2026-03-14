import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getColumnInfo, COLOR_SCHEMES, AGGREGATIONS } from '../../utils/dataUtils';
import * as d3 from 'd3';

const SCHEME_COLORS = {
  tableau10: d3.schemeTableau10,
  category10: d3.schemeCategory10,
  set2: d3.schemeSet2,
  set3: d3.schemeSet3,
  pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2,
  paired: d3.schemePaired,
  accent: d3.schemeAccent,
};

// ── Field selector ────────────────────────────────────────────────────────────
function FieldSelect({ label, value, columns, typeFilter, onChange, optional }) {
  const filtered = typeFilter
    ? columns.filter(c => typeFilter.includes(c.type))
    : columns;
  return (
    <div className="form-group editor-section" style={{ marginBottom: 10 }}>
      <label className="form-label">
        {label} {!optional && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      <select className="select select-sm" value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">— none —</option>
        {filtered.map(c => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.type})
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Fields tab content ────────────────────────────────────────────────────────
function FieldsTab({ widget, dataset, onUpdate }) {
  const cols = dataset ? getColumnInfo(dataset.data) : [];
  const numCols = cols.filter(c => c.type === 'number');

  const fieldMap = {
    bar: [
      { key: 'xField',   label: 'X Axis (category)',  filter: null },
      { key: 'yField',   label: 'Y Axis (numeric)',    filter: ['number'] },
      { key: 'groupField',label: 'Group by (optional)', filter: null, optional: true },
    ],
    line: [
      { key: 'xField',   label: 'X Axis',             filter: null },
      { key: 'yField',   label: 'Y Axis (numeric)',    filter: ['number'] },
      { key: 'colorField',label: 'Series (optional)',  filter: null, optional: true },
    ],
    scatter: [
      { key: 'xField',   label: 'X Axis (numeric)',   filter: ['number'] },
      { key: 'yField',   label: 'Y Axis (numeric)',   filter: ['number'] },
      { key: 'colorField',label: 'Color by (optional)',filter: null, optional: true },
      { key: 'sizeField', label: 'Size by (optional)', filter: ['number'], optional: true },
    ],
    pie: [
      { key: 'labelField',label: 'Label (category)',  filter: null },
      { key: 'valueField',label: 'Value (numeric)',   filter: ['number'] },
    ],
    histogram: [
      { key: 'xField',   label: 'Field (numeric)',    filter: ['number'] },
    ],
    table: [],
  };

  const fields = fieldMap[widget.type] || [];

  return (
    <div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Dataset</label>
        <select
          className="select select-sm"
          value={widget.datasetId || ''}
          onChange={e => onUpdate({ datasetId: e.target.value || null })}
        >
          <option value="">— none —</option>
          {/* rendered from parent via prop? no, use context */}
        </select>
      </div>

      {fields.map(f => (
        <FieldSelect
          key={f.key}
          label={f.label}
          value={widget[f.key]}
          columns={cols}
          typeFilter={f.filter}
          optional={f.optional}
          onChange={v => onUpdate({ [f.key]: v })}
        />
      ))}

      {numCols.length > 0 && ['bar', 'line'].includes(widget.type) && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Aggregation</label>
          <select className="select select-sm" value={widget.aggregation || 'sum'} onChange={e => onUpdate({ aggregation: e.target.value })}>
            {Object.entries(AGGREGATIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Aesthetics tab content ────────────────────────────────────────────────────
function AestheticsTab({ widget, onUpdate }) {
  return (
    <div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Title</label>
        <input className="input input-sm" value={widget.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Chart title" />
      </div>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Color scheme</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(COLOR_SCHEMES).map(([key, label]) => (
            <div
              key={key}
              className={`color-scheme-option ${widget.colorScheme === key ? 'color-scheme-option--active' : ''}`}
              onClick={() => onUpdate({ colorScheme: key })}
            >
              <div className="color-swatches">
                {(SCHEME_COLORS[key] || []).slice(0, 8).map((c, i) => (
                  <div key={i} className="color-swatch" style={{ background: c }} />
                ))}
              </div>
              <span style={{ fontSize: 12 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showGrid} onChange={e => onUpdate({ showGrid: e.target.checked })} />
        Show grid lines
      </label>
      <label className="checkbox-row" style={{ marginBottom: 12 }}>
        <input type="checkbox" checked={!!widget.showLegend} onChange={e => onUpdate({ showLegend: e.target.checked })} />
        Show legend
      </label>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Opacity — {Math.round((widget.opacity ?? 1) * 100)}%</label>
        <input type="range" min={0.2} max={1} step={0.05}
          value={widget.opacity ?? 1}
          onChange={e => onUpdate({ opacity: parseFloat(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Background color</label>
        <div className="flex gap-2 items-center">
          <input type="color" value={widget.backgroundColor || '#ffffff'}
            onChange={e => onUpdate({ backgroundColor: e.target.value })}
            style={{ width: 32, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: 2 }}
          />
          <input className="input input-sm" value={widget.backgroundColor || '#ffffff'}
            onChange={e => onUpdate({ backgroundColor: e.target.value })} style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );
}

// ── Options tab (type-specific) ───────────────────────────────────────────────
function OptionsTab({ widget, onUpdate }) {
  if (widget.type === 'bar') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Orientation</label>
        <select className="select select-sm" value={widget.orientation || 'vertical'} onChange={e => onUpdate({ orientation: e.target.value })}>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Sort by</label>
        <select className="select select-sm" value={widget.sortBy || 'value'} onChange={e => onUpdate({ sortBy: e.target.value })}>
          <option value="value">Value</option>
          <option value="label">Label</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Sort order</label>
        <select className="select select-sm" value={widget.sortOrder || 'desc'} onChange={e => onUpdate({ sortOrder: e.target.value })}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </div>
    </div>
  );

  if (widget.type === 'line') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Curve type</label>
        <select className="select select-sm" value={widget.lineType || 'linear'} onChange={e => onUpdate({ lineType: e.target.value })}>
          <option value="linear">Linear</option>
          <option value="monotone">Smooth (monotone)</option>
          <option value="step">Step</option>
          <option value="stepBefore">Step before</option>
          <option value="stepAfter">Step after</option>
          <option value="cardinal">Cardinal</option>
        </select>
      </div>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showPoints} onChange={e => onUpdate({ showPoints: e.target.checked })} />
        Show data points
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={!!widget.showArea} onChange={e => onUpdate({ showArea: e.target.checked })} />
        Fill area under line
      </label>
    </div>
  );

  if (widget.type === 'scatter') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Min dot size — {widget.dotSizeMin ?? 4}px</label>
        <input type="range" min={2} max={20} value={widget.dotSizeMin ?? 4}
          onChange={e => onUpdate({ dotSizeMin: parseInt(e.target.value) })} />
      </div>
      <div className="form-group">
        <label className="form-label">Max dot size — {widget.dotSizeMax ?? 20}px</label>
        <input type="range" min={4} max={60} value={widget.dotSizeMax ?? 20}
          onChange={e => onUpdate({ dotSizeMax: parseInt(e.target.value) })} />
      </div>
    </div>
  );

  if (widget.type === 'pie') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Inner radius (0 = pie, &gt;0 = donut) — {widget.innerRadius ?? 0}%</label>
        <input type="range" min={0} max={80} value={widget.innerRadius ?? 0}
          onChange={e => onUpdate({ innerRadius: parseInt(e.target.value) })} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={widget.sortByValue !== false} onChange={e => onUpdate({ sortByValue: e.target.checked })} />
        Sort slices by value
      </label>
    </div>
  );

  if (widget.type === 'histogram') return (
    <div>
      <div className="form-group">
        <label className="form-label">Number of bins — {widget.bins ?? 20}</label>
        <input type="range" min={5} max={100} value={widget.bins ?? 20}
          onChange={e => onUpdate({ bins: parseInt(e.target.value) })} />
      </div>
    </div>
  );

  return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>No options for this chart type.</div>;
}

// ── Widget Editor ─────────────────────────────────────────────────────────────
export default function WidgetEditor({ widgetId }) {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState('fields');

  const widget = state.dashboard.widgets.find(w => w.id === widgetId);
  const dataset = state.datasets.find(d => d.id === widget?.datasetId);

  if (!widget) return null;

  const onUpdate = (updates) => dispatch({ type: 'UPDATE_WIDGET', payload: { id: widgetId, updates } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>
          {{ bar: '📊', line: '📈', scatter: '⬤', pie: '🥧', histogram: '▬' }[widget.type] || '📊'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{widget.title || 'Untitled'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{widget.type} chart</div>
        </div>
        <button className="btn btn-ghost btn-icon btn-sm"
          onClick={() => dispatch({ type: 'SET_EDITING_WIDGET', payload: null })}
          title="Close editor">✕</button>
      </div>

      {/* Dataset selector always visible */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div className="form-label" style={{ marginBottom: 4 }}>Dataset</div>
        <select className="select select-sm" value={widget.datasetId || ''} onChange={e => onUpdate({ datasetId: e.target.value || null })}>
          <option value="">— select dataset —</option>
          {state.datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="editor-tabs">
        {['fields', 'aesthetics', 'options'].map(t => (
          <button key={t} className={`editor-tab ${tab === t ? 'editor-tab--active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="editor-body">
        {tab === 'fields'     && <FieldsTab widget={widget} dataset={dataset} onUpdate={onUpdate} />}
        {tab === 'aesthetics' && <AestheticsTab widget={widget} onUpdate={onUpdate} />}
        {tab === 'options'    && <OptionsTab widget={widget} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}
