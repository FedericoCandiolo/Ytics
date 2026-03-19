import { useState, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import { useApp } from '../../context/AppContext';
import { getColumnInfo, COLOR_SCHEMES, AGGREGATIONS, executeMeasurePipeline, detectColumnTypes } from '../../utils/dataUtils';
import { getSwatchColors, getGradientSwatches, GRADIENT_SCHEMES, getColorArray } from '../../utils/colorUtils';
import { TYPE_ICONS } from '../Widgets/WidgetContainer';
import MeasurePipeline from './MeasurePipeline';

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

// Which field key holds the "value to aggregate" for each chart type
const AGG_VALUE_KEY = {
  bar: 'yField', line: 'yField',
  treemap: 'valueField', heatmap: 'valueField', bump: 'valueField', stream: 'valueField',
  radar: 'valueField', waffle: 'valueField', sankey: 'valueField', boxplot: 'yField',
  pivot: 'valueField',
};

// Charts that support the measure pipeline
const PIPELINE_TYPES = ['bar', 'line', 'scatter', 'pie', 'treemap', 'heatmap', 'bump', 'stream', 'boxplot', 'radar', 'waffle', 'sankey', 'table', 'pivot'];

// Which field provides the "color dimension" for each chart type
const COLOR_DIMENSION_FIELD = {
  bar: w => w.groupField || w.xField,
  line: w => w.colorField,
  scatter: w => w.colorField,
  pie: w => w.labelField,
  treemap: w => w.labelField,
  heatmap: w => w.xField,
  bump: w => w.colorField,
  stream: w => w.colorField,
  violin: w => w.xField,
  boxplot: w => w.xField,
  radar: w => w.colorField || w.axisField,
  waffle: w => w.labelField,
  sankey: w => w.sourceField,
  geo: w => w.geoField,
};

// ── Fields tab content ────────────────────────────────────────────────────────
function FieldsTab({ widget, dataset, columns, onUpdate }) {
  const fieldMap = {
    bar: [
      { key: 'xField',    label: 'X Axis (category)',       filter: null },
      { key: 'yField',    label: 'Value field',             filter: null },
      { key: 'groupField',label: 'Group by (optional)',      filter: null, optional: true },
    ],
    line: [
      { key: 'xField',    label: 'X Axis',                  filter: null },
      { key: 'yField',    label: 'Value field',             filter: null },
      { key: 'colorField',label: 'Series (optional)',        filter: null, optional: true },
    ],
    scatter: [
      { key: 'xField',    label: 'X Axis (numeric)',        filter: ['number'] },
      { key: 'yField',    label: 'Y Axis (numeric)',        filter: ['number'] },
      { key: 'colorField',label: 'Color by (optional)',     filter: null, optional: true },
      { key: 'sizeField', label: 'Size by (optional)',      filter: ['number'], optional: true },
    ],
    pie: [
      { key: 'labelField',label: 'Label (category)',        filter: null },
      { key: 'valueField',label: 'Value (numeric)',         filter: ['number'] },
    ],
    histogram: [
      { key: 'xField',    label: 'Field (numeric)',         filter: ['number'] },
    ],
    table: [],
    treemap: [
      { key: 'labelField',label: 'Label (category)',        filter: null },
      { key: 'valueField',label: 'Value field',            filter: null },
      { key: 'groupField',label: 'Group by (optional)',     filter: null, optional: true },
    ],
    heatmap: [
      { key: 'xField',    label: 'X Axis (category)',       filter: null },
      { key: 'yField',    label: 'Y Axis (category)',       filter: null },
      { key: 'valueField',label: 'Value field',            filter: null },
    ],
    bump: [
      { key: 'xField',    label: 'X Axis (time/category)', filter: null },
      { key: 'colorField',label: 'Series (category)',       filter: null },
      { key: 'valueField',label: 'Value field',            filter: null },
    ],
    stream: [
      { key: 'xField',    label: 'X Axis (time/category)', filter: null },
      { key: 'colorField',label: 'Series (category)',       filter: null },
      { key: 'valueField',label: 'Value field',            filter: null },
    ],
    violin: [
      { key: 'xField',    label: 'Category (X)',            filter: null },
      { key: 'yField',    label: 'Value (Y, numeric)',      filter: ['number'] },
    ],
    carousel: [],
    boxplot: [
      { key: 'xField',    label: 'Category (X)',            filter: null },
      { key: 'yField',    label: 'Value (Y, numeric)',      filter: ['number'] },
    ],
    radar: [
      { key: 'axisField',  label: 'Axis (category)',        filter: null },
      { key: 'valueField', label: 'Value (numeric)',        filter: ['number'] },
      { key: 'colorField', label: 'Series (optional)',      filter: null, optional: true },
    ],
    waffle: [
      { key: 'labelField', label: 'Label (category)',       filter: null },
      { key: 'valueField', label: 'Value (numeric)',        filter: ['number'] },
    ],
    sankey: [
      { key: 'sourceField', label: 'Source (category)',     filter: null },
      { key: 'targetField', label: 'Target (category)',     filter: null },
      { key: 'valueField',  label: 'Value (numeric)',       filter: ['number'] },
    ],
    geo: [
      { key: 'geoField',    label: 'Geography (country name)', filter: null },
      { key: 'valueField',  label: 'Value (numeric)',          filter: ['number'] },
    ],
    pivot: [
      { key: 'valueField',  label: 'Value (numeric)',          filter: ['number'] },
    ],
  };

  const cols = columns;
  const fields = fieldMap[widget.type] || [];

  const valueFieldKey = AGG_VALUE_KEY[widget.type];
  const valueFieldName = valueFieldKey ? widget[valueFieldKey] : null;
  const valueCol = valueFieldName ? cols.find(c => c.name === valueFieldName) : null;
  const isNumericValue = !valueFieldName || !valueCol || valueCol.type === 'number';
  const availableAggs = isNumericValue
    ? Object.entries(AGGREGATIONS)
    : [['count', AGGREGATIONS.count]];

  const handleFieldChange = (fieldKey, value) => {
    const updates = { [fieldKey]: value };
    if (fieldKey === valueFieldKey) {
      const col = value ? cols.find(c => c.name === value) : null;
      const nowNumeric = !col || col.type === 'number';
      if (!nowNumeric && widget.aggregation !== 'count') {
        updates.aggregation = 'count';
      } else if (nowNumeric && widget.aggregation === 'count' && !value) {
        updates.aggregation = 'sum';
      }
    }
    onUpdate(updates);
  };

  const showAgg = ['bar', 'line', 'treemap', 'heatmap', 'bump', 'stream', 'radar', 'waffle', 'sankey', 'pivot'].includes(widget.type);

  return (
    <div>
      {fields.map(f => (
        <FieldSelect
          key={f.key}
          label={f.label}
          value={widget[f.key]}
          columns={cols}
          typeFilter={f.filter}
          optional={f.optional}
          onChange={v => handleFieldChange(f.key, v)}
        />
      ))}

      {showAgg && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">
            Aggregation
            {!isNumericValue && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>
                (non-numeric field → count only)
              </span>
            )}
          </label>
          <select
            className="select select-sm"
            value={widget.aggregation || 'sum'}
            onChange={e => onUpdate({ aggregation: e.target.value })}
          >
            {availableAggs.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Aesthetics tab content ────────────────────────────────────────────────────
function AestheticsTab({ widget, onUpdate }) {
  const useDefaultBg = widget.backgroundColor === null || widget.backgroundColor === undefined;
  const useDefaultRadius = widget.cardRadius === null || widget.cardRadius === undefined;

  return (
    <div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Title</label>
        <input className="input input-sm" value={widget.title || ''} onChange={e => onUpdate({ title: e.target.value })} placeholder="Chart title" />
      </div>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Color scheme</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            className={`color-scheme-option ${widget.colorScheme == null ? 'color-scheme-option--active' : ''}`}
            onClick={() => onUpdate({ colorScheme: null })}
          >
            <div className="color-swatches" style={{ opacity: 0.4 }}>
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className="color-swatch" style={{ background: `hsl(${i*40},40%,60%)` }} />
              ))}
            </div>
            <span style={{ fontSize: 12, fontStyle: 'italic' }}>Use theme default</span>
          </div>
          {Object.entries(COLOR_SCHEMES).map(([key, label]) => (
            <div
              key={key}
              className={`color-scheme-option ${widget.colorScheme === key ? 'color-scheme-option--active' : ''}`}
              onClick={() => onUpdate({ colorScheme: key })}
            >
              <div className="color-swatches">
                {getSwatchColors(key).slice(0, 8).map((c, i) => (
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

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Background color</label>
        <label className="checkbox-row" style={{ marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={useDefaultBg}
            onChange={e => onUpdate({ backgroundColor: e.target.checked ? null : '#ffffff' })}
          />
          <span style={{ fontSize: 12 }}>Use default (from theme)</span>
        </label>
        {!useDefaultBg && (
          <div className="flex gap-2 items-center">
            <input type="color" value={widget.backgroundColor || '#ffffff'}
              onChange={e => onUpdate({ backgroundColor: e.target.value })}
              style={{ width: 32, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: 2 }}
            />
            <input className="input input-sm" value={widget.backgroundColor || '#ffffff'}
              onChange={e => onUpdate({ backgroundColor: e.target.value })} style={{ flex: 1 }} />
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Corner radius</label>
        <label className="checkbox-row" style={{ marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={useDefaultRadius}
            onChange={e => onUpdate({ cardRadius: e.target.checked ? null : 8 })}
          />
          <span style={{ fontSize: 12 }}>Inherit from theme</span>
        </label>
        {!useDefaultRadius && (
          <div>
            <span className="form-label">{widget.cardRadius ?? 8}px</span>
            <input type="range" min={0} max={20} step={1}
              value={widget.cardRadius ?? 8}
              onChange={e => onUpdate({ cardRadius: parseInt(e.target.value) })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Colors tab ────────────────────────────────────────────────────────────────

const COND_OPS = [
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
  { value: 'contains', label: 'contains' },
];

function ConditionalFormattingSection({ widget, columns, onUpdate }) {
  const formatting = widget.conditionalFormatting || [];

  const addRule = () => {
    const numCol = columns.find(c => c.type === 'number');
    onUpdate({
      conditionalFormatting: [...formatting, {
        id: uuid(),
        column: numCol?.name || columns[0]?.name || '',
        mode: 'gradient',
        gradient: 'blues',
        rules: [],
      }],
    });
  };

  const updateCf = (idx, updates) => {
    onUpdate({
      conditionalFormatting: formatting.map((cf, i) => i === idx ? { ...cf, ...updates } : cf),
    });
  };

  const removeCf = (idx) => {
    onUpdate({ conditionalFormatting: formatting.filter((_, i) => i !== idx) });
  };

  const addSubRule = (cfIdx) => {
    const cf = formatting[cfIdx];
    const rules = [...(cf.rules || []), { id: uuid(), op: '>', value: '', bg: '#22c55e', text: '' }];
    updateCf(cfIdx, { rules });
  };

  const updateSubRule = (cfIdx, rIdx, updates) => {
    const cf = formatting[cfIdx];
    const rules = cf.rules.map((r, i) => i === rIdx ? { ...r, ...updates } : r);
    updateCf(cfIdx, { rules });
  };

  const removeSubRule = (cfIdx, rIdx) => {
    const cf = formatting[cfIdx];
    updateCf(cfIdx, { rules: cf.rules.filter((_, i) => i !== rIdx) });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="form-label" style={{ marginBottom: 8 }}>Conditional Formatting</div>
      {formatting.map((cf, cfIdx) => (
        <div key={cf.id} className="cf-rule-card">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <select className="select select-sm" style={{ flex: 1 }} value={cf.column}
              onChange={e => updateCf(cfIdx, { column: e.target.value })}>
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeCf(cfIdx)} title="Remove">✕</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <label className="checkbox-row" style={{ fontSize: 12 }}>
              <input type="radio" name={`cfmode-${cf.id}`} checked={cf.mode === 'gradient'}
                onChange={() => updateCf(cfIdx, { mode: 'gradient' })} />
              Gradient
            </label>
            <label className="checkbox-row" style={{ fontSize: 12 }}>
              <input type="radio" name={`cfmode-${cf.id}`} checked={cf.mode === 'rules'}
                onChange={() => updateCf(cfIdx, { mode: 'rules' })} />
              Rules
            </label>
          </div>

          {cf.mode === 'gradient' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(GRADIENT_SCHEMES).map(([key, label]) => (
                <div key={key}
                  className={`color-scheme-option ${cf.gradient === key ? 'color-scheme-option--active' : ''}`}
                  onClick={() => updateCf(cfIdx, { gradient: key })}
                  style={{ padding: '3px 6px' }}
                >
                  <div className="color-swatches">
                    {getGradientSwatches(key, 8).map((c, i) => (
                      <div key={i} className="color-swatch" style={{ background: c }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 11 }}>{label}</span>
                </div>
              ))}
            </div>
          )}

          {cf.mode === 'rules' && (
            <div>
              {(cf.rules || []).map((rule, rIdx) => (
                <div key={rule.id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
                  <select className="select select-sm" style={{ width: 70 }} value={rule.op}
                    onChange={e => updateSubRule(cfIdx, rIdx, { op: e.target.value })}>
                    {COND_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input className="input input-sm" style={{ width: 60 }} value={rule.value}
                    onChange={e => updateSubRule(cfIdx, rIdx, { value: e.target.value })}
                    placeholder="value" />
                  <input type="color" value={rule.bg || '#22c55e'}
                    onChange={e => updateSubRule(cfIdx, rIdx, { bg: e.target.value })}
                    title="Background" style={{ width: 24, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1 }} />
                  <input type="color" value={rule.text || '#ffffff'}
                    onChange={e => updateSubRule(cfIdx, rIdx, { text: e.target.value })}
                    title="Text color" style={{ width: 24, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1 }} />
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeSubRule(cfIdx, rIdx)}>✕</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => addSubRule(cfIdx)}>+ Rule</button>
            </div>
          )}
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={addRule}>
        + Add formatting
      </button>
    </div>
  );
}

function GradientColorSection({ widget, onUpdate }) {
  const isGradient = widget.colorMode === 'gradient';

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="form-label" style={{ marginBottom: 8 }}>Color mode</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <label className="checkbox-row" style={{ fontSize: 12 }}>
          <input type="radio" name="colorMode" checked={!isGradient}
            onChange={() => onUpdate({ colorMode: 'categorical' })} />
          Categorical
        </label>
        <label className="checkbox-row" style={{ fontSize: 12 }}>
          <input type="radio" name="colorMode" checked={isGradient}
            onChange={() => onUpdate({ colorMode: 'gradient', colorGradient: widget.colorGradient || 'blues' })} />
          Gradient
        </label>
      </div>

      {isGradient && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(GRADIENT_SCHEMES).map(([key, label]) => (
            <div key={key}
              className={`color-scheme-option ${widget.colorGradient === key ? 'color-scheme-option--active' : ''}`}
              onClick={() => onUpdate({ colorGradient: key })}
              style={{ padding: '3px 6px' }}
            >
              <div className="color-swatches">
                {getGradientSwatches(key, 8).map((c, i) => (
                  <div key={i} className="color-swatch" style={{ background: c }} />
                ))}
              </div>
              <span style={{ fontSize: 11 }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DimensionColorsSection({ widget, dataset, dispatch, dimensionColors }) {
  const [search, setSearch] = useState('');

  const dimFieldFn = COLOR_DIMENSION_FIELD[widget.type];
  const dimField = dimFieldFn ? dimFieldFn(widget) : null;

  const uniqueVals = useMemo(() => {
    if (!dimField || !dataset?.data?.length) return [];
    return [...new Set(dataset.data.map(r => String(r[dimField] ?? '')))].sort();
  }, [dimField, dataset]);

  const filtered = search
    ? uniqueVals.filter(v => v.toLowerCase().includes(search.toLowerCase()))
    : uniqueVals;

  const paletteArr = getColorArray(widget.colorScheme || 'vivid');

  if (!dimField || uniqueVals.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
        Select a category/series field to assign dimension colors.
      </div>
    );
  }

  const setColor = (val, colorDef) => {
    dispatch({ type: 'SET_DIMENSION_COLOR', payload: { value: val, colorDef } });
  };

  const removeColor = (val) => {
    dispatch({ type: 'REMOVE_DIMENSION_COLOR', payload: val });
  };

  return (
    <div>
      <div className="form-label" style={{ marginBottom: 4 }}>
        Dimension colors <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({dimField})</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        Applied across all charts in this dashboard.
      </div>

      {uniqueVals.length > 10 && (
        <input className="input input-sm" placeholder="Search values..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8, width: '100%' }} />
      )}

      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {filtered.map((val, i) => {
          const override = dimensionColors[val];
          const defaultColor = paletteArr[i % paletteArr.length];
          const displayColor = override
            ? (override.type === 'custom' ? override.color : paletteArr[override.index % paletteArr.length])
            : defaultColor;
          const isCustom = override?.type === 'custom';

          return (
            <div key={val} className="dim-color-row">
              <input
                type="color"
                value={displayColor}
                onChange={e => setColor(val, { type: 'custom', color: e.target.value })}
                style={{ width: 22, height: 20, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1, flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {val || '(blank)'}
              </span>
              {isCustom && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>custom</span>
              )}
              {override && (
                <button className="btn btn-ghost btn-icon btn-sm" style={{ fontSize: 10, padding: 2 }}
                  onClick={() => removeColor(val)} title="Reset to palette">↺</button>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        Palette-based colors change with the scheme. Custom colors stay fixed.
      </div>
    </div>
  );
}

function ColorsTab({ widget, dataset, columns, onUpdate, dispatch, dimensionColors }) {
  const isTable = widget.type === 'table' || widget.type === 'pivot';
  const isChart = !isTable && widget.type !== 'carousel';

  return (
    <div>
      {/* Conditional formatting for tables */}
      {isTable && (
        <ConditionalFormattingSection widget={widget} columns={columns} onUpdate={onUpdate} />
      )}

      {/* Gradient color mode for charts */}
      {isChart && (
        <GradientColorSection widget={widget} onUpdate={onUpdate} />
      )}

      {/* Dimension color pinning for charts */}
      {isChart && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }} />
          <DimensionColorsSection
            widget={widget} dataset={dataset}
            dispatch={dispatch} dimensionColors={dimensionColors}
          />
        </>
      )}
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
      {widget.groupField && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Bar mode</label>
          <select className="select select-sm" value={widget.barMode || 'stacked'} onChange={e => onUpdate({ barMode: e.target.value })}>
            <option value="stacked">Stacked</option>
            <option value="grouped">Grouped (side by side)</option>
          </select>
        </div>
      )}
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
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showArea} onChange={e => onUpdate({ showArea: e.target.checked })} />
        Fill area under line
      </label>
      {widget.showArea && widget.colorField && (
        <div className="form-group" style={{ marginTop: 8 }}>
          <label className="form-label">Area stack mode</label>
          <select className="select select-sm" value={widget.stackMode || 'none'} onChange={e => onUpdate({ stackMode: e.target.value })}>
            <option value="none">Overlapping (no stack)</option>
            <option value="stacked">Stacked</option>
            <option value="percent">Stacked 100%</option>
          </select>
        </div>
      )}
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

  if (widget.type === 'treemap') return (
    <div>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showLabels} onChange={e => onUpdate({ showLabels: e.target.checked })} />
        Show labels
      </label>
    </div>
  );

  if (widget.type === 'geo') return (
    <div>
      <div className="form-group">
        <label className="form-label">Map projection</label>
        <select className="select select-sm" value={widget.mapProjection || 'naturalEarth'} onChange={e => onUpdate({ mapProjection: e.target.value })}>
          <option value="naturalEarth">Natural Earth</option>
          <option value="mercator">Mercator</option>
          <option value="equalEarth">Equal Earth</option>
          <option value="orthographic">Orthographic (globe)</option>
        </select>
      </div>
    </div>
  );

  return <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>No options for this chart type.</div>;
}

// ── Carousel tab ──────────────────────────────────────────────────────────────
const SLIDE_TYPES = [
  { type: 'bar', label: 'Bar Chart', icon: '📊' },
  { type: 'line', label: 'Line Chart', icon: '📈' },
  { type: 'scatter', label: 'Scatter', icon: '⬤' },
  { type: 'pie', label: 'Pie / Donut', icon: '🥧' },
  { type: 'histogram', label: 'Histogram', icon: '▬' },
  { type: 'treemap', label: 'Treemap', icon: '⬛' },
  { type: 'heatmap', label: 'Heat Map', icon: '🌡' },
  { type: 'violin', label: 'Violin Plot', icon: '🎻' },
  { type: 'boxplot', label: 'Box Plot', icon: '📦' },
  { type: 'radar', label: 'Radar', icon: '🕸' },
  { type: 'waffle', label: 'Waffle', icon: '🧇' },
];

const SLIDE_FIELD_MAP = {
  bar: [
    { key: 'xField', label: 'X Axis', filter: null },
    { key: 'yField', label: 'Value field', filter: null },
  ],
  line: [
    { key: 'xField', label: 'X Axis', filter: null },
    { key: 'yField', label: 'Value field', filter: null },
    { key: 'colorField', label: 'Series (optional)', filter: null, optional: true },
  ],
  scatter: [
    { key: 'xField', label: 'X (numeric)', filter: ['number'] },
    { key: 'yField', label: 'Y (numeric)', filter: ['number'] },
  ],
  pie: [
    { key: 'labelField', label: 'Label', filter: null },
    { key: 'valueField', label: 'Value (numeric)', filter: ['number'] },
  ],
  histogram: [
    { key: 'xField', label: 'Field (numeric)', filter: ['number'] },
  ],
  treemap: [
    { key: 'labelField', label: 'Label', filter: null },
    { key: 'valueField', label: 'Value', filter: null },
  ],
  heatmap: [
    { key: 'xField', label: 'X Axis', filter: null },
    { key: 'yField', label: 'Y Axis', filter: null },
    { key: 'valueField', label: 'Value', filter: null },
  ],
  violin: [
    { key: 'xField', label: 'Category', filter: null },
    { key: 'yField', label: 'Value (numeric)', filter: ['number'] },
  ],
  boxplot: [
    { key: 'xField', label: 'Category', filter: null },
    { key: 'yField', label: 'Value (numeric)', filter: ['number'] },
  ],
  radar: [
    { key: 'axisField', label: 'Axis', filter: null },
    { key: 'valueField', label: 'Value', filter: ['number'] },
    { key: 'colorField', label: 'Series (optional)', filter: null, optional: true },
  ],
  waffle: [
    { key: 'labelField', label: 'Label', filter: null },
    { key: 'valueField', label: 'Value', filter: ['number'] },
  ],
};

function CarouselTab({ widget, dataset, onUpdate }) {
  const [selIdx, setSelIdx] = useState(0);
  const cols = dataset ? getColumnInfo(dataset.data) : [];
  const slides = widget.slides || [];

  const addSlide = () => {
    const s = {
      id: uuid(), type: 'bar', title: `Chart ${slides.length + 1}`,
      xField: null, yField: null, colorField: null, labelField: null, valueField: null,
      axisField: null,
      colorScheme: widget.colorScheme || 'vivid', aggregation: 'sum', showGrid: true,
      orientation: 'vertical',
    };
    onUpdate({ slides: [...slides, s] });
    setSelIdx(slides.length);
  };

  const updateSlide = (i, updates) => {
    onUpdate({ slides: slides.map((s, j) => j === i ? { ...s, ...updates } : s) });
  };

  const removeSlide = (i) => {
    const next = slides.filter((_, j) => j !== i);
    onUpdate({ slides: next });
    setSelIdx(Math.max(0, Math.min(selIdx, next.length - 1)));
  };

  const slide = slides[selIdx];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        {slides.map((s, i) => (
          <div
            key={s.id || i}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
              marginBottom: 4, borderRadius: 'var(--radius)', cursor: 'pointer',
              background: i === selIdx ? '#eff6ff' : 'var(--bg)',
              border: `1px solid ${i === selIdx ? '#bfdbfe' : 'transparent'}`,
            }}
            onClick={() => setSelIdx(i)}
          >
            <span>{SLIDE_TYPES.find(t => t.type === s.type)?.icon || '📊'}</span>
            <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.title || `Slide ${i + 1}`}
            </span>
            {slides.length > 1 && (
              <button className="btn btn-ghost btn-icon btn-sm"
                onClick={e => { e.stopPropagation(); removeSlide(i); }}>✕</button>
            )}
          </div>
        ))}
        <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 4 }} onClick={addSlide}>
          + Add slide
        </button>
      </div>

      {slide && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Title</label>
            <input className="input input-sm" value={slide.title || ''}
              onChange={e => updateSlide(selIdx, { title: e.target.value })} />
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Chart type</label>
            <select className="select select-sm" value={slide.type || 'bar'}
              onChange={e => updateSlide(selIdx, { type: e.target.value })}>
              {SLIDE_TYPES.map(t => (
                <option key={t.type} value={t.type}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>
          {(SLIDE_FIELD_MAP[slide.type] || []).map(f => (
            <FieldSelect
              key={f.key}
              label={f.label}
              value={slide[f.key]}
              columns={cols}
              typeFilter={f.filter}
              optional={f.optional}
              onChange={v => updateSlide(selIdx, { [f.key]: v })}
            />
          ))}
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Aggregation</label>
            <select className="select select-sm" value={slide.aggregation || 'sum'}
              onChange={e => updateSlide(selIdx, { aggregation: e.target.value })}>
              {Object.entries(AGGREGATIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8 }}>
        <label className="checkbox-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={!!widget.autoPlay} onChange={e => onUpdate({ autoPlay: e.target.checked })} />
          Auto-advance slides
        </label>
        {widget.autoPlay && (
          <div className="form-group">
            <label className="form-label">Interval — {(widget.autoPlayInterval || 5000) / 1000}s</label>
            <input type="range" min={1000} max={15000} step={500}
              value={widget.autoPlayInterval || 5000}
              onChange={e => onUpdate({ autoPlayInterval: parseInt(e.target.value) })} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Widget Editor ─────────────────────────────────────────────────────────────
export default function WidgetEditor({ widgetId }) {
  const { state, dispatch } = useApp();
  const [tab, setTab] = useState('fields');

  const widget = state.dashboard.pages.flatMap(p => p.widgets).find(w => w.id === widgetId);
  const dataset = state.datasets.find(d => d.id === widget?.datasetId);

  // Compute effective columns (raw or pipeline output)
  const columns = useMemo(() => {
    if (!dataset?.data?.length) return [];
    if (widget?.measures?.length > 0) {
      try {
        const output = executeMeasurePipeline(dataset.data.slice(0, 100), widget.measures);
        if (output.length > 0) {
          const types = detectColumnTypes(output);
          return Object.keys(types).map(name => ({ name, type: types[name] }));
        }
      } catch { /* fallback */ }
    }
    return getColumnInfo(dataset.data);
  }, [dataset, widget?.measures]);

  if (!widget) return null;

  const onUpdate = (updates) => dispatch({ type: 'UPDATE_WIDGET', payload: { id: widgetId, updates } });

  const hasPipeline = PIPELINE_TYPES.includes(widget.type);

  const tabs = widget.type === 'carousel'
    ? ['slides', 'aesthetics']
    : hasPipeline
      ? ['fields', 'measures', 'colors', 'aesthetics', 'options']
      : ['fields', 'colors', 'aesthetics', 'options'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 20 }}>
          {TYPE_ICONS[widget.type] || '📊'}
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
        {tabs.map(t => (
          <button key={t} className={`editor-tab ${tab === t ? 'editor-tab--active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="editor-body">
        {tab === 'slides'     && <CarouselTab widget={widget} dataset={dataset} onUpdate={onUpdate} />}
        {tab === 'fields'     && <FieldsTab widget={widget} dataset={dataset} columns={columns} onUpdate={onUpdate} />}
        {tab === 'measures'   && <MeasurePipeline measures={widget.measures || []} dataset={dataset} onUpdate={m => onUpdate({ measures: m })} />}
        {tab === 'colors'     && <ColorsTab widget={widget} dataset={dataset} columns={columns} onUpdate={onUpdate} dispatch={dispatch} dimensionColors={state.dashboard.dimensionColors || {}} />}
        {tab === 'aesthetics' && <AestheticsTab widget={widget} onUpdate={onUpdate} />}
        {tab === 'options'    && <OptionsTab widget={widget} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}
