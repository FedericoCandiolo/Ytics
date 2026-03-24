import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useApp } from '../../context/AppContext';
import { COLOR_SCHEMES, AGGREGATIONS_BASIC, AGGREGATIONS_ADVANCED, AGGREGATIONS_PARAM, NUMBER_FORMATS, executeMeasurePipeline, detectColumnTypes } from '../../utils/dataUtils';
import { getSwatchColors, getGradientSwatches, GRADIENT_SCHEMES, getColorArray, resolveGradient } from '../../utils/colorUtils';
import { TYPE_ICONS } from '../Widgets/WidgetContainer';
import MeasurePipeline from './MeasurePipeline';
import { getAllFields, getFieldsByTable, resolveWidgetData } from '../../utils/associativeEngine';

// ── Searchable field picker ─────────────────────────────────────────────────
// Replaces native <select> with a searchable dropdown.
// mode='single': click to pick one value. mode='multi': checkboxes.
function SearchableFieldPicker({ tableGroups, customFields, typeFilter, value, onChange,
                                  mode = 'single', placeholder = '— none —', showType = true,
                                  extraGroups, style }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const q = search.toLowerCase();

  const filtered = useMemo(() => {
    const groups = [];
    // Custom fields first
    const customs = (typeFilter && customFields)
      ? customFields.filter(c => typeFilter.includes(c.type))
      : (customFields || []);
    const matchedCustom = q ? customs.filter(c => c.name.toLowerCase().includes(q)) : customs;
    if (matchedCustom.length > 0) groups.push({ label: 'Custom', key: '__custom', fields: matchedCustom });

    // Extra groups (hierarchies, cyclics)
    if (extraGroups) {
      for (const eg of extraGroups) {
        const matchedEg = q ? eg.items.filter(it => it.label.toLowerCase().includes(q)) : eg.items;
        if (matchedEg.length > 0) groups.push({ label: eg.label, key: eg.key, items: matchedEg, isExtra: true });
      }
    }

    // Table groups
    const tGroups = typeFilter
      ? tableGroups.map(g => ({ ...g, fields: g.fields.filter(c => typeFilter.includes(c.type)) })).filter(g => g.fields.length > 0)
      : tableGroups;
    for (const g of tGroups) {
      const matchedFields = q ? g.fields.filter(c => c.name.toLowerCase().includes(q)) : g.fields;
      if (matchedFields.length > 0) groups.push({ label: g.tableName, key: g.tableId, fields: matchedFields });
    }
    return groups;
  }, [tableGroups, customFields, typeFilter, q, extraGroups]);

  const totalCount = filtered.reduce((n, g) => n + (g.isExtra ? g.items.length : g.fields.length), 0);
  const singleGroup = filtered.length === 1 && !filtered[0].isExtra && !(customFields?.length > 0);

  const handlePick = useCallback((val) => {
    if (mode === 'single') {
      onChange(val || null);
      setOpen(false);
      setSearch('');
    }
  }, [mode, onChange]);

  const isChecked = useCallback((name) => {
    if (!Array.isArray(value)) return false;
    return value.includes(name);
  }, [value]);

  const handleToggle = useCallback((name) => {
    if (!Array.isArray(value)) {
      onChange([name]);
    } else if (value.includes(name)) {
      onChange(value.filter(n => n !== name));
    } else {
      onChange([...value, name]);
    }
  }, [value, onChange]);

  // Display text for single mode
  const displayText = mode === 'single'
    ? (value || placeholder)
    : (Array.isArray(value) && value.length > 0 ? `${value.length} selected` : placeholder);

  const itemStyle = {
    padding: '4px 10px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
    borderRadius: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <div
        className="select select-sm"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none',
          color: (mode === 'single' && !value) ? 'var(--text-muted)' : undefined }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{displayText}</span>
        <span style={{ fontSize: 9, marginLeft: 4, flexShrink: 0 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg, #fff)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)', marginTop: 2, maxHeight: 300, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 6px 4px', borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              className="input input-sm"
              style={{ width: '100%' }}
              placeholder="Search fields..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {mode === 'single' && (
              <div style={{ ...itemStyle, color: 'var(--text-muted)' }} onClick={() => handlePick('')}>
                {placeholder}
              </div>
            )}
            {totalCount === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>No fields match</div>
            )}
            {filtered.map(group => (
              <div key={group.key}>
                {!singleGroup && (
                  <div style={{ padding: '4px 10px 2px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {group.label}
                  </div>
                )}
                {group.isExtra
                  ? group.items.map(it => (
                      <div key={it.value} style={{ ...itemStyle, background: value === it.value ? 'var(--accent-bg, #eff6ff)' : undefined }}
                        onClick={() => handlePick(it.value)}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
                        onMouseLeave={e => e.currentTarget.style.background = value === it.value ? 'var(--accent-bg, #eff6ff)' : ''}>
                        {it.label}
                      </div>
                    ))
                  : group.fields.map(c => {
                      if (mode === 'multi') {
                        return (
                          <label key={c.name} style={{ ...itemStyle, cursor: 'pointer' }}>
                            <input type="checkbox" checked={isChecked(c.name)} onChange={() => handleToggle(c.name)} style={{ marginRight: 2 }} />
                            <span style={{ flex: 1 }}>{c.name}</span>
                            {showType && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({c.type})</span>}
                          </label>
                        );
                      }
                      return (
                        <div key={c.name} style={{ ...itemStyle, background: value === c.name ? 'var(--accent-bg, #eff6ff)' : undefined }}
                          onClick={() => handlePick(c.name)}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)'}
                          onMouseLeave={e => e.currentTarget.style.background = value === c.name ? 'var(--accent-bg, #eff6ff)' : ''}>
                          <span style={{ flex: 1 }}>{c.name}</span>
                          {showType && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({c.type})</span>}
                        </div>
                      );
                    })
                }
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field selector ────────────────────────────────────────────────────────────
function FieldSelect({ label, value, columns, typeFilter, onChange, optional, customFields }) {
  const { state } = useApp();
  const hierarchies = state.dashboard.hierarchicDimensions || [];
  const cyclics = state.dashboard.cyclicDimensions || [];
  const showDims = !typeFilter || !typeFilter.length || typeFilter.includes(null);
  const tableGroups = useMemo(() => getFieldsByTable(state.colStore), [state.colStore]);

  const extraGroups = useMemo(() => {
    if (!showDims) return null;
    const groups = [];
    if (hierarchies.length > 0) {
      groups.push({
        label: 'Hierarchic dimensions', key: '__hier',
        items: hierarchies.map(h => ({ value: `__hier__${h.id}`, label: `\u2195 ${h.name || h.levels?.join(' \u203A ')}` })),
      });
    }
    if (cyclics.length > 0) {
      groups.push({
        label: 'Cyclic dimensions', key: '__cyclic',
        items: cyclics.map(c => ({ value: `__cyclic__${c.id}`, label: `\u21BB ${c.name || c.fields?.join(' / ')}` })),
      });
    }
    return groups.length > 0 ? groups : null;
  }, [showDims, hierarchies, cyclics]);

  return (
    <div className="form-group editor-section" style={{ marginBottom: 10 }}>
      <label className="form-label">
        {label} {!optional && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      <SearchableFieldPicker
        tableGroups={tableGroups}
        customFields={customFields}
        typeFilter={typeFilter}
        value={value || ''}
        onChange={onChange}
        extraGroups={extraGroups}
        showType
      />
    </div>
  );
}

// ── Aggregation selector (basic / advanced / parameterized) ───────────────────
function ModifierTags({ distinct, total, onDistinctChange, onTotalChange }) {
  const [open, setOpen] = useState(false);
  const hasModifiers = distinct || total;
  const tagStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: 10, padding: '1px 6px', borderRadius: 10,
    background: 'var(--accent, #3b82f6)', color: '#fff',
    cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: '18px',
  };
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
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

function AggregationSelect({ value, onChange, advancedStats, className, style, numericOnly }) {
  // Parse current value: could be "sum", "fractile:0.33", "concat:,"
  const isParam = value && value.includes(':');
  const baseVal = isParam ? value.split(':')[0] : (value || 'sum');
  const paramVal = isParam ? value.split(':').slice(1).join(':') : '';
  const paramDef = AGGREGATIONS_PARAM[baseVal];

  // Non-numeric fields only get count
  if (numericOnly === false) {
    return (
      <select className={className || 'select select-sm'} style={style} value="count" disabled>
        <option value="count">Count</option>
      </select>
    );
  }

  const handleBase = (newBase) => {
    const pd = AGGREGATIONS_PARAM[newBase];
    if (pd) {
      onChange(`${newBase}:${pd.default}`);
    } else {
      onChange(newBase);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <select className={className || 'select select-sm'} style={{ flex: 1, ...(style || {}) }}
        value={baseVal} onChange={e => handleBase(e.target.value)}>
        <optgroup label="Basic">
          {Object.entries(AGGREGATIONS_BASIC).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </optgroup>
        {advancedStats && (
          <optgroup label="Advanced">
            {Object.entries(AGGREGATIONS_ADVANCED)
              .filter(([v]) => v !== 'concat') // concat shown as parameterized
              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </optgroup>
        )}
        {advancedStats && (
          <optgroup label="Parameterized">
            {Object.entries(AGGREGATIONS_PARAM).map(([v, def]) => (
              <option key={v} value={v}>{def.label}</option>
            ))}
          </optgroup>
        )}
      </select>
      {advancedStats && paramDef && (
        paramDef.paramType === 'number' ? (
          <input type="number" className="input input-sm" style={{ width: 56 }}
            min={paramDef.min} max={paramDef.max} step={paramDef.step}
            value={paramVal || paramDef.default}
            onChange={e => onChange(`${baseVal}:${e.target.value}`)}
            title={paramDef.paramLabel}
          />
        ) : (
          <input type="text" className="input input-sm" style={{ width: 40 }}
            value={paramVal ?? paramDef.default}
            onChange={e => onChange(`${baseVal}:${e.target.value}`)}
            title={paramDef.paramLabel}
            placeholder={paramDef.paramLabel}
          />
        )
      )}
    </div>
  );
}

// Which field key holds the "value to aggregate" for each chart type
const AGG_VALUE_KEY = {
  bar: 'yField', line: 'yField', histogram: 'xField',
  treemap: 'valueField', heatmap: 'valueField', bump: 'valueField', stream: 'valueField',
  radar: 'valueField', waffle: 'valueField', sankey: 'valueField', boxplot: 'yField',
  pivot: 'valueField',
  waterfall: 'valueField', wordcloud: 'valueField', funnel: 'valueField',
  kpi: 'valueField', bubble: 'valueField', combo: 'yField',
  straighttable: 'valueField', mekko: 'yField',
};

// Charts that support the measure pipeline
const PIPELINE_TYPES = ['bar', 'line', 'scatter', 'pie', 'histogram', 'treemap', 'heatmap', 'bump', 'stream', 'boxplot', 'radar', 'waffle', 'sankey', 'table', 'pivot', 'waterfall', 'funnel', 'kpi', 'bubble', 'combo', 'straighttable', 'mekko', 'wordcloud', 'text', 'image', 'embed'];

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
  waterfall: w => w.xField,
  wordcloud: w => w.xField,
  funnel: w => w.xField,
  bubble: w => w.colorField,
  combo: w => w.xField,
  mekko: w => w.colorField,
};

// ── Fields tab content ────────────────────────────────────────────────────────
function FieldsTab({ widget, dataset, columns, onUpdate, tableGroups, customFields }) {
  const { state } = useApp();
  const fieldMap = {
    bar: [
      { key: 'xField',    label: 'Dimension (X axis)',       filter: null },
      { key: 'yField',    label: 'Measure',                  filter: null },
      { key: '_barMode' },
    ],
    line: [
      { key: 'xField',    label: 'Dimension (X axis)',       filter: null },
      { key: 'yField',    label: 'Measure',                  filter: null },
      { key: '_lineMode' },
    ],
    scatter: [
      { key: 'xField',    label: 'X Axis (numeric)',         filter: ['number'] },
      { key: 'yField',    label: 'Y Axis (numeric)',         filter: ['number'] },
      { key: 'colorField',label: 'Color / Series (optional)', filter: null, optional: true },
      { key: 'sizeField', label: 'Size (numeric, optional)',  filter: ['number'], optional: true },
      { key: 'labelField',label: 'Point label (optional)',    filter: null, optional: true },
      { key: '_scatterOverlayFields', label: 'Mini chart fields', multi: true },
    ],
    pie: [
      { key: 'labelField',label: 'Dimension (label)',         filter: null },
      { key: 'valueField',label: 'Measure',                   filter: ['number'] },
    ],
    histogram: [
      { key: 'xField',    label: 'Measure (numeric)',         filter: ['number'] },
      { key: 'colorField',label: 'Group by (optional)',        filter: null, optional: true },
    ],
    table: [],
    treemap: [
      { key: 'labelField',label: 'Dimension (label)',         filter: null },
      { key: 'valueField',label: 'Measure',                   filter: null },
      { key: 'groupField',label: 'Group by (optional)',        filter: null, optional: true },
    ],
    heatmap: [
      { key: 'xField',    label: 'Dimension (X axis)',        filter: null },
      { key: 'yField',    label: 'Dimension (Y axis)',        filter: null },
      { key: 'valueField',label: 'Measure',                   filter: null },
    ],
    bump: [
      { key: 'xField',    label: 'Dimension (X axis)',        filter: null },
      { key: 'colorField',label: 'Color / Series',            filter: null },
      { key: 'valueField',label: 'Measure',                   filter: null },
    ],
    stream: [
      { key: 'xField',    label: 'Dimension (X axis)',        filter: null },
      { key: 'colorField',label: 'Color / Series',            filter: null },
      { key: 'valueField',label: 'Measure',                   filter: null },
    ],
    violin: [
      { key: 'xField',    label: 'Dimension (X axis)',        filter: null },
      { key: 'yField',    label: 'Measure (numeric)',          filter: ['number'] },
      { key: 'colorField',label: 'Sub-group (optional)',       filter: null, optional: true },
      { key: 'labelField',label: 'Point label (optional)',     filter: null, optional: true },
      { key: 'jitterField',label: 'Point X-position (optional)', filter: ['number'], optional: true },
    ],
    carousel: [],
    boxplot: [
      { key: 'xField',    label: 'Dimension (X axis)',        filter: null },
      { key: 'yField',    label: 'Measure (numeric)',          filter: ['number'] },
      { key: 'colorField',label: 'Sub-group (optional)',       filter: null, optional: true },
      { key: 'labelField',label: 'Point label (optional)',     filter: null, optional: true },
      { key: 'jitterField',label: 'Point X-position (optional)', filter: ['number'], optional: true },
    ],
    radar: [
      { key: 'axisField',  label: 'Dimension (axis)',         filter: null },
      { key: 'valueField', label: 'Measure',                  filter: ['number'] },
      { key: 'colorField', label: 'Color / Series (optional)', filter: null, optional: true },
    ],
    waffle: [
      { key: 'labelField', label: 'Dimension (label)',        filter: null },
      { key: 'valueField', label: 'Measure',                  filter: ['number'] },
    ],
    sankey: [
      { key: 'sourceField', label: 'Source dimension',        filter: null },
      { key: 'targetField', label: 'Target dimension',        filter: null },
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
      { key: '_sankeyFields', label: 'Intermediate dimensions', multi: true },
    ],
    geo: [
      { key: 'geoField',    label: 'Geography dimension',     filter: null },
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
      { key: 'overlayBreakdownField', label: 'Overlay breakdown dim.', filter: null, optional: true },
      { key: '_geoOverlayFields', label: 'Overlay chart fields', multi: true },
      { key: 'overlaySizeField', label: 'Overlay size field (opt.)', filter: ['number'], optional: true },
      { key: 'pointLatField', label: 'Point latitude',        filter: ['number'], optional: true },
      { key: 'pointLngField', label: 'Point longitude',       filter: ['number'], optional: true },
      { key: 'pointLabelField', label: 'Point label (opt.)',  filter: null, optional: true },
      { key: 'pointSizeField', label: 'Point size (opt.)',    filter: ['number'], optional: true },
      { key: 'pointColorField', label: 'Point color (opt.)',  filter: null, optional: true },
      { key: '_pointOverlayFields', label: 'Point chart fields', multi: true },
    ],
    pivot: [
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
    ],
    waterfall: [
      { key: 'xField',      label: 'Dimension (X axis)',      filter: null },
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
    ],
    wordcloud: [
      { key: 'xField',      label: 'Dimension (word field)',  filter: null },
      { key: 'valueField',  label: 'Measure (optional)',      filter: ['number'], optional: true },
    ],
    funnel: [
      { key: 'xField',      label: 'Dimension (stage)',       filter: null },
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
    ],
    kpi: [
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
      { key: 'yField',      label: 'Target / compare (optional)', filter: ['number'], optional: true },
      { key: 'labelField',  label: 'Label (optional)',         filter: null, optional: true },
    ],
    bubble: [
      { key: 'xField',      label: 'Dimension (label)',       filter: null },
      { key: 'valueField',  label: 'Measure (size)',          filter: ['number'] },
      { key: 'colorField',  label: 'Color / Series (optional)', filter: null, optional: true },
    ],
    combo: [
      { key: 'xField',      label: 'Dimension (X axis)',      filter: null },
      { key: 'yField',      label: 'Primary measure',         filter: ['number'] },
      { key: 'y2Field',     label: 'Secondary measure',       filter: ['number'] },
      { key: 'colorField',  label: 'Color / Series (optional)', filter: null, optional: true },
    ],
    straighttable: [
      { key: '_straightTableDimensions', label: 'Dimensions', multi: true },
      { key: 'valueField',  label: 'Measure',                 filter: ['number'] },
      { key: '_primaryRepr', label: 'Primary measure display' },
      { key: '_straightTableMeasures', label: 'Additional measures', multi: true },
    ],
    mekko: [
      { key: 'xField',      label: 'Dimension (X axis)',      filter: null },
      { key: 'yField',      label: 'Measure',                 filter: ['number'] },
      { key: 'colorField',  label: 'Segments (color)',        filter: null },
    ],
    text: [],
    image: [],
    embed: [],
  };

  const cols = columns;
  const fields = fieldMap[widget.type] || [];

  const valueFieldKey = AGG_VALUE_KEY[widget.type];
  const valueFieldName = valueFieldKey ? widget[valueFieldKey] : null;
  const valueCol = valueFieldName ? cols.find(c => c.name === valueFieldName) : null;
  const isNumericValue = !valueFieldName || !valueCol || valueCol.type === 'number';

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

  const showAgg = ['bar', 'line', 'histogram', 'treemap', 'heatmap', 'bump', 'stream', 'radar', 'waffle', 'sankey', 'pivot', 'waterfall', 'wordcloud', 'funnel', 'kpi', 'bubble', 'combo', 'straighttable', 'mekko', 'geo'].includes(widget.type);

  return (
    <div>
      {fields.map(f => {
        // Special: Bar chart mode toggle (multi-dimension vs multi-measure)
        if (f.key === '_barMode') {
          const seriesMode = widget.seriesMode || (widget.barChartMeasures?.some(m => m.field) ? 'measures' : 'dimensions');
          return (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Series mode</label>
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 'var(--radius, 6)', padding: 2 }}>
                  {[{ v: 'dimensions', l: 'Multi dimension' }, { v: 'measures', l: 'Multi measure' }].map(opt => (
                    <button key={opt.v} className="btn btn-sm" style={{
                      flex: 1, fontSize: 11, fontWeight: seriesMode === opt.v ? 600 : 400, padding: '4px 6px',
                      background: seriesMode === opt.v ? 'var(--bg, #fff)' : 'transparent',
                      boxShadow: seriesMode === opt.v ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                      border: seriesMode === opt.v ? '1px solid var(--border)' : '1px solid transparent',
                    }} onClick={() => onUpdate({ seriesMode: opt.v })}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              {seriesMode === 'dimensions' ? (
                <FieldSelect label="Color / Series" value={widget.groupField} columns={cols}
                  typeFilter={null} optional onChange={v => onUpdate({ groupField: v })} customFields={customFields} />
              ) : (
                /* Render bar multi-measure list inline */
                (() => {
                  const current = widget.barChartMeasures || [];
                  return (
                    <div className="form-group editor-section" style={{ marginBottom: 10 }}>
                      <label className="form-label">Additional measures</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {current.map((m, i) => (
                          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '6px 6px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <SearchableFieldPicker style={{ flex: 1 }}
                                tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                                value={m.field || ''} onChange={v => {
                                  const next = [...current]; next[i] = { ...next[i], field: v || '' };
                                  onUpdate({ barChartMeasures: next });
                                }} />
                              <AggregationSelect value={m.aggregation || 'sum'} onChange={v => {
                                const next = [...current]; next[i] = { ...next[i], aggregation: v };
                                onUpdate({ barChartMeasures: next });
                              }} advancedStats={state.dashboard.advancedStats} style={{ width: 80 }} />
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                                onUpdate({ barChartMeasures: current.filter((_, j) => j !== i) });
                              }}>{'\u2715'}</button>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input className="input input-sm" style={{ flex: 1 }}
                                placeholder={`Label: ${m.field || 'Measure'} (${m.aggregation || 'sum'})`}
                                value={m.label || ''} onChange={e => {
                                  const next = [...current]; next[i] = { ...next[i], label: e.target.value };
                                  onUpdate({ barChartMeasures: next });
                                }} />
                              <select className="select select-sm" style={{ fontSize: 10, width: 'auto' }}
                                value={m.numberFormat || 'auto'} onChange={e => {
                                  const next = [...current]; next[i] = { ...next[i], numberFormat: e.target.value };
                                  onUpdate({ barChartMeasures: next });
                                }} title="Number format">
                                {Object.entries(NUMBER_FORMATS).map(([k, label]) => (
                                  <option key={k} value={k}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          onUpdate({ barChartMeasures: [...current, { field: '', aggregation: 'sum' }] });
                        }}>+ Add measure</button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          );
        }
        // Special: Line chart mode toggle (multi-dimension vs multi-measure)
        if (f.key === '_lineMode') {
          const seriesMode = widget.seriesMode || (widget.lineChartMeasures?.some(m => m.field) ? 'measures' : 'dimensions');
          return (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Series mode</label>
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)', borderRadius: 'var(--radius, 6)', padding: 2 }}>
                  {[{ v: 'dimensions', l: 'Multi dimension' }, { v: 'measures', l: 'Multi measure' }].map(opt => (
                    <button key={opt.v} className="btn btn-sm" style={{
                      flex: 1, fontSize: 11, fontWeight: seriesMode === opt.v ? 600 : 400, padding: '4px 6px',
                      background: seriesMode === opt.v ? 'var(--bg, #fff)' : 'transparent',
                      boxShadow: seriesMode === opt.v ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                      border: seriesMode === opt.v ? '1px solid var(--border)' : '1px solid transparent',
                    }} onClick={() => onUpdate({ seriesMode: opt.v })}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              {seriesMode === 'dimensions' ? (
                <FieldSelect label="Color / Series" value={widget.colorField} columns={cols}
                  typeFilter={null} optional onChange={v => onUpdate({ colorField: v })} customFields={customFields} />
              ) : (
                /* Render line multi-measure list inline */
                (() => {
                  const current = widget.lineChartMeasures || [];
                  return (
                    <div className="form-group editor-section" style={{ marginBottom: 10 }}>
                      <label className="form-label">Additional measures</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {current.map((m, i) => (
                          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '6px 6px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <SearchableFieldPicker style={{ flex: 1 }}
                                tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                                value={m.field || ''} onChange={v => {
                                  const next = [...current]; next[i] = { ...next[i], field: v || '' };
                                  onUpdate({ lineChartMeasures: next });
                                }} />
                              <AggregationSelect value={m.aggregation || 'sum'} onChange={v => {
                                const next = [...current]; next[i] = { ...next[i], aggregation: v };
                                onUpdate({ lineChartMeasures: next });
                              }} advancedStats={state.dashboard.advancedStats} style={{ width: 80 }} />
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                                onUpdate({ lineChartMeasures: current.filter((_, j) => j !== i) });
                              }}>{'\u2715'}</button>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input className="input input-sm" style={{ flex: 1 }}
                                placeholder={`Label: ${m.field || 'Measure'} (${m.aggregation || 'sum'})`}
                                value={m.label || ''} onChange={e => {
                                  const next = [...current]; next[i] = { ...next[i], label: e.target.value };
                                  onUpdate({ lineChartMeasures: next });
                                }} />
                              <select className="select select-sm" style={{ fontSize: 10, width: 'auto' }}
                                value={m.numberFormat || 'auto'} onChange={e => {
                                  const next = [...current]; next[i] = { ...next[i], numberFormat: e.target.value };
                                  onUpdate({ lineChartMeasures: next });
                                }} title="Number format">
                                {Object.entries(NUMBER_FORMATS).map(([k, label]) => (
                                  <option key={k} value={k}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          onUpdate({ lineChartMeasures: [...current, { field: '', aggregation: 'sum' }] });
                        }}>+ Add measure</button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          );
        }
        // Special: dynamic dimensions list for Straight Table
        if (f.key === '_straightTableDimensions') {
          const currentDims = widget.straightTableDimensions || [];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {currentDims.map((fld, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <SearchableFieldPicker style={{ flex: 1 }}
                      tableGroups={tableGroups} customFields={customFields}
                      value={fld || ''} onChange={v => {
                        const next = [...currentDims];
                        next[i] = v || '';
                        onUpdate({ straightTableDimensions: next });
                      }} />
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => {
                      const next = [...currentDims];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      onUpdate({ straightTableDimensions: next });
                    }} title="Move up">{'\u2191'}</button>
                    <button className="btn btn-ghost btn-icon btn-sm" disabled={i === currentDims.length - 1} onClick={() => {
                      const next = [...currentDims];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      onUpdate({ straightTableDimensions: next });
                    }} title="Move down">{'\u2193'}</button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                      onUpdate({ straightTableDimensions: currentDims.filter((_, j) => j !== i) });
                    }}>{'\u2715'}</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ straightTableDimensions: [...currentDims, ''] });
                }}>+ Add dimension</button>
              </div>
            </div>
          );
        }
        // Special: primary measure representation for Straight Table
        if (f.key === '_primaryRepr') {
          const REPR_OPTIONS = [
            { value: 'text', label: 'Text' },
            { value: 'bar', label: 'Mini bar chart' },
            { value: 'pie', label: 'Mini pie chart' },
            { value: 'line', label: 'Mini line chart' },
          ];
          const repr = widget.primaryRepresentation || 'text';
          const isChart = repr !== 'text';
          return (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <input className="input input-sm" style={{ width: '100%', marginBottom: 4 }}
                placeholder={`${widget.valueField || 'Measure'} (${widget.aggregation || 'sum'})`}
                value={widget.primaryMeasureLabel || ''}
                onChange={e => onUpdate({ primaryMeasureLabel: e.target.value })}
              />
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select className="select select-sm" style={{ flex: 1 }} value={repr}
                  onChange={e => {
                    const updates = { primaryRepresentation: e.target.value };
                    if (e.target.value === 'text') updates.primaryChartDimension = undefined;
                    onUpdate(updates);
                  }}>
                  {REPR_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {isChart && (
                  <SearchableFieldPicker style={{ flex: 1 }}
                    tableGroups={tableGroups} customFields={customFields}
                    value={widget.primaryChartDimension || ''} placeholder="Breakdown dim…"
                    onChange={v => onUpdate({ primaryChartDimension: v || undefined })} />
                )}
              </div>
            </div>
          );
        }
        // Special: multi-select for Straight Table additional measures
        if (f.key === '_straightTableMeasures') {
          const current = widget.straightTableMeasures || [];
          const numCols = cols.filter(c => c.type === 'number');
          const allCols = cols;
          const REPR_OPTIONS = [
            { value: 'text', label: 'Text' },
            { value: 'bar', label: 'Mini bar chart' },
            { value: 'pie', label: 'Mini pie chart' },
            { value: 'line', label: 'Mini line chart' },
          ];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {current.map((m, i) => (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '6px 6px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {/* Row 1: field, aggregation, reorder & delete */}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <SearchableFieldPicker style={{ flex: 1 }}
                        tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                        value={m.field || ''} onChange={v => {
                          const next = [...current];
                          next[i] = { ...next[i], field: v || '' };
                          onUpdate({ straightTableMeasures: next });
                        }} />
                      <AggregationSelect
                        value={m.aggregation || 'sum'}
                        onChange={v => {
                          const next = [...current];
                          next[i] = { ...next[i], aggregation: v };
                          onUpdate({ straightTableMeasures: next });
                        }}
                        advancedStats={state.dashboard.advancedStats}
                        style={{ width: 80 }}
                      />
                      <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => {
                        const next = [...current];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        onUpdate({ straightTableMeasures: next });
                      }} title="Move up">{'\u2191'}</button>
                      <button className="btn btn-ghost btn-icon btn-sm" disabled={i === current.length - 1} onClick={() => {
                        const next = [...current];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        onUpdate({ straightTableMeasures: next });
                      }} title="Move down">{'\u2193'}</button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                        onUpdate({ straightTableMeasures: current.filter((_, j) => j !== i) });
                      }}>{'\u2715'}</button>
                    </div>
                    {/* Row 2: modifiers + number format */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <ModifierTags
                        distinct={m.distinct} total={m.total}
                        onDistinctChange={v => {
                          const next = [...current];
                          next[i] = { ...next[i], distinct: v };
                          onUpdate({ straightTableMeasures: next });
                        }}
                        onTotalChange={v => {
                          const next = [...current];
                          next[i] = { ...next[i], total: v };
                          onUpdate({ straightTableMeasures: next });
                        }}
                      />
                      <select className="select select-sm" style={{ fontSize: 10, width: 'auto', marginLeft: 'auto' }}
                        value={m.numberFormat || 'auto'}
                        onChange={e => {
                          const next = [...current];
                          next[i] = { ...next[i], numberFormat: e.target.value };
                          onUpdate({ straightTableMeasures: next });
                        }}
                        title="Number format for this measure">
                        {Object.entries(NUMBER_FORMATS).map(([k, label]) => (
                          <option key={k} value={k}>{label}</option>
                        ))}
                      </select>
                    </div>
                    {/* Row 3: custom label */}
                    <input className="input input-sm" style={{ width: '100%' }}
                      placeholder={`Label: ${m.field || 'Measure'} (${m.aggregation || 'sum'})`}
                      value={m.label || ''}
                      onChange={e => {
                        const next = [...current];
                        next[i] = { ...next[i], label: e.target.value };
                        onUpdate({ straightTableMeasures: next });
                      }}
                    />
                    {/* Row 4: representation + breakdown dimension */}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <select className="select select-sm" style={{ flex: 1 }} value={m.representation || 'text'}
                        onChange={e => {
                          const next = [...current];
                          next[i] = { ...next[i], representation: e.target.value };
                          if (e.target.value === 'text') next[i] = { ...next[i], dimension: undefined };
                          onUpdate({ straightTableMeasures: next });
                        }}>
                        {REPR_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      {(m.representation && m.representation !== 'text') && (
                        <SearchableFieldPicker style={{ flex: 1 }}
                          tableGroups={tableGroups} customFields={customFields}
                          value={m.dimension || ''} placeholder="Breakdown dim…"
                          onChange={v => {
                            const next = [...current];
                            next[i] = { ...next[i], dimension: v || undefined };
                            onUpdate({ straightTableMeasures: next });
                          }} />
                      )}
                    </div>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ straightTableMeasures: [...current, { field: '', aggregation: 'sum', representation: 'text' }] });
                }}>+ Add measure</button>
              </div>
            </div>
          );
        }
        // Special: multi-select for Scatter mini chart fields
        if (f.key === '_scatterOverlayFields') {
          const current = widget.scatterOverlayFields || [];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {current.map((fld, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <SearchableFieldPicker style={{ flex: 1 }}
                      tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                      value={fld || ''} onChange={v => {
                        const next = [...current]; next[i] = v || '';
                        onUpdate({ scatterOverlayFields: next });
                      }} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                      onUpdate({ scatterOverlayFields: current.filter((_, j) => j !== i) });
                    }}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ scatterOverlayFields: [...current, ''] });
                }}>+ Add field</button>
              </div>
            </div>
          );
        }
        // Special: multi-select for Geo overlay chart fields
        if (f.key === '_geoOverlayFields') {
          const current = widget.overlayFields || [];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {current.map((fld, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <SearchableFieldPicker style={{ flex: 1 }}
                      tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                      value={fld || ''} onChange={v => {
                        const next = [...current]; next[i] = v || '';
                        onUpdate({ overlayFields: next });
                      }} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                      onUpdate({ overlayFields: current.filter((_, j) => j !== i) });
                    }}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ overlayFields: [...current, ''] });
                }}>+ Add field</button>
              </div>
            </div>
          );
        }
        // Special: multi-select for Point layer chart fields
        if (f.key === '_pointOverlayFields') {
          const current = widget.pointOverlayFields || [];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {current.map((fld, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <SearchableFieldPicker style={{ flex: 1 }}
                      tableGroups={tableGroups} customFields={customFields} typeFilter={['number']}
                      value={fld || ''} onChange={v => {
                        const next = [...current]; next[i] = v || '';
                        onUpdate({ pointOverlayFields: next });
                      }} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                      onUpdate({ pointOverlayFields: current.filter((_, j) => j !== i) });
                    }}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ pointOverlayFields: [...current, ''] });
                }}>+ Add field</button>
              </div>
            </div>
          );
        }
        // Special: multi-select for Sankey intermediate dimensions
        if (f.key === '_sankeyFields') {
          const current = widget.sankeyFields || [];
          return (
            <div key={f.key} className="form-group editor-section" style={{ marginBottom: 10 }}>
              <label className="form-label">{f.label}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {current.map((fld, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <SearchableFieldPicker style={{ flex: 1 }}
                      tableGroups={tableGroups} customFields={customFields}
                      value={fld || ''} onChange={v => {
                        const next = [...current]; next[i] = v || '';
                        onUpdate({ sankeyFields: next });
                      }} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => {
                      onUpdate({ sankeyFields: current.filter((_, j) => j !== i) });
                    }}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  onUpdate({ sankeyFields: [...current, ''] });
                }}>+ Add dimension</button>
              </div>
            </div>
          );
        }
        return (
          <FieldSelect
            key={f.key}
            label={f.label}
            value={widget[f.key]}
            columns={cols}
            typeFilter={f.filter}
            optional={f.optional}
            onChange={v => handleFieldChange(f.key, v)}
            customFields={customFields}
          />
        );
      })}

      {/* Visible columns for DataTable — shown in Fields tab */}
      {widget.type === 'table' && cols.length > 0 && (() => {
        const allNames = cols.map(c => c.name);
        const visible = widget.visibleColumns;
        const allChecked = !Array.isArray(visible) || visible.length === allNames.length;
        const currentVisible = Array.isArray(visible) ? visible : allNames;
        return (
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Visible columns</label>
            <label className="checkbox-row" style={{ marginBottom: 6, fontWeight: 600 }}>
              <input type="checkbox" checked={allChecked} onChange={() => onUpdate({ visibleColumns: allChecked ? [] : null })} />
              All columns
            </label>
            <SearchableFieldPicker
              tableGroups={tableGroups} customFields={customFields}
              mode="multi" showType
              value={currentVisible}
              onChange={next => {
                if (!next || next.length === 0) return;
                if (next.length === allNames.length) { onUpdate({ visibleColumns: null }); return; }
                onUpdate({ visibleColumns: next });
              }}
            />
          </div>
        );
      })()}

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
          <AggregationSelect
            value={widget.aggregation || 'sum'}
            onChange={v => onUpdate({ aggregation: v })}
            advancedStats={state.dashboard.advancedStats}
            numericOnly={isNumericValue}
          />
          <ModifierTags
            distinct={widget.distinct} total={widget.total}
            onDistinctChange={v => onUpdate({ distinct: v })}
            onTotalChange={v => onUpdate({ total: v })}
          />
        </div>
      )}

      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">{widget.type === 'combo' ? 'Primary number format' : 'Number format'}</label>
        <select className="select select-sm" value={widget.numberFormat || 'auto'}
          onChange={e => onUpdate({ numberFormat: e.target.value })}>
          {Object.entries(NUMBER_FORMATS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </div>
      {widget.type === 'combo' && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Secondary number format</label>
          <select className="select select-sm" value={widget.y2NumberFormat || 'auto'}
            onChange={e => onUpdate({ y2NumberFormat: e.target.value })}>
            {Object.entries(NUMBER_FORMATS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
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

function GradientColorSection({ widget, columns, onUpdate }) {
  const isGradient = widget.colorMode === 'gradient';
  const effectiveGradient = resolveGradient(widget.colorScheme, widget.colorGradient);
  const hasCustomGradient = !!widget.colorGradient;
  const numericCols = columns.filter(c => c.type === 'number');

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
            onChange={() => onUpdate({ colorMode: 'gradient' })} />
          Gradient
        </label>
      </div>

      {isGradient && (
        <div>
          {/* Override toggle */}
          <label className="checkbox-row" style={{ fontSize: 12, marginBottom: 8 }}>
            <input type="checkbox" checked={hasCustomGradient}
              onChange={e => onUpdate({ colorGradient: e.target.checked ? effectiveGradient : null })} />
            Override gradient
          </label>

          {hasCustomGradient && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
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

          <label className="checkbox-row" style={{ fontSize: 12, marginTop: 8 }}>
            <input type="checkbox" checked={!!widget.invertGradient}
              onChange={e => onUpdate({ invertGradient: e.target.checked || undefined })} />
            Invert gradient
          </label>

          {/* Gradient measure field */}
          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">Color by field</label>
            <select className="select select-sm"
              value={widget.colorGradientField || ''}
              onChange={e => onUpdate({ colorGradientField: e.target.value || null })}>
              <option value="">Same as value field (default)</option>
              {numericCols.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Choose a different numeric field to drive the color gradient.
            </div>
          </div>
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
        <GradientColorSection widget={widget} columns={columns} onUpdate={onUpdate} />
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

// ── Shared option helpers ─────────────────────────────────────────────────────
function SortOptions({ widget, onUpdate }) {
  return (
    <>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Sort by</label>
        <select className="select select-sm" value={widget.sortBy || 'original'} onChange={e => onUpdate({ sortBy: e.target.value })}>
          <option value="original">Original order</option>
          <option value="value">Value</option>
          <option value="label">Label</option>
          <option value="custom">Custom order</option>
        </select>
      </div>
      {widget.sortBy !== 'custom' && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Sort order</label>
          <select className="select select-sm" value={widget.sortOrder || 'desc'} onChange={e => onUpdate({ sortOrder: e.target.value })}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      )}
      {widget.sortBy === 'custom' && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Custom order (comma-separated)</label>
          <input className="input input-sm"
            defaultValue={(widget.customSortOrder || []).join(', ')}
            onBlur={e => onUpdate({ customSortOrder: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            placeholder="e.g. Yes, No, Maybe" />
        </div>
      )}
    </>
  );
}

function ParetoOptions({ widget, onUpdate }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.paretoEnabled} onChange={e => onUpdate({ paretoEnabled: e.target.checked })} />
        Group tail into "Others"
      </label>
      {widget.paretoEnabled && (
        <>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Grouping method</label>
            <select className="select select-sm" value={widget.paretoMethod || 'topN'} onChange={e => onUpdate({ paretoMethod: e.target.value })}>
              <option value="topN">Top N</option>
              <option value="threshold">Cumulative % threshold</option>
              <option value="pareto">Pareto equilibrium</option>
            </select>
          </div>
          {widget.paretoMethod === 'topN' && (
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Top N — {widget.paretoTopN ?? 10}</label>
              <input type="range" min={2} max={50} value={widget.paretoTopN ?? 10}
                onChange={e => onUpdate({ paretoTopN: parseInt(e.target.value) })} />
            </div>
          )}
          {widget.paretoMethod === 'threshold' && (
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Threshold — {widget.paretoThreshold ?? 80}%</label>
              <input type="range" min={50} max={99} value={widget.paretoThreshold ?? 80}
                onChange={e => onUpdate({ paretoThreshold: parseInt(e.target.value) })} />
            </div>
          )}
          {widget.paretoMethod === 'pareto' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Items where (cumulative count ratio / cumulative value ratio) &lt; 1 are grouped as Others.
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Others label</label>
            <input className="input input-sm" value={widget.othersLabel || 'Others'}
              onChange={e => onUpdate({ othersLabel: e.target.value })} />
          </div>
        </>
      )}
    </div>
  );
}

function ReferenceLineOption({ widget, onUpdate }) {
  const ref = widget.referenceLine || {};
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Reference line value</label>
        <input type="number" className="input input-sm" value={ref.value ?? ''}
          onChange={e => onUpdate({ referenceLine: { ...ref, value: e.target.value ? parseFloat(e.target.value) : null } })}
          placeholder="e.g. 100" />
      </div>
      {ref.value != null && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Reference line label</label>
          <input className="input input-sm" value={ref.label || ''}
            onChange={e => onUpdate({ referenceLine: { ...ref, label: e.target.value } })}
            placeholder="e.g. Target" />
        </div>
      )}
    </div>
  );
}

// ── Template editor with field insertion ──────────────────────────────────────
const TEMPLATE_AGGS = ['sum', 'count', 'mean', 'min', 'max', 'median', 'std', 'p25', 'p75', 'p90', 'p95'];

function TemplateEditor({ value, onChange, columns, multiline, placeholder }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [search, setSearch] = useState('');
  const [selAgg, setSelAgg] = useState('sum');
  const textRef = useRef(null);

  const handleOpen = () => { setDraft(value || ''); setSearch(''); setOpen(true); };
  const handleSave = () => { onChange(draft); setOpen(false); };
  const handleCancel = () => setOpen(false);

  const insertField = (fieldName, agg) => {
    const ta = textRef.current;
    const token = agg ? `{{${agg}:${fieldName}}}` : `{{${fieldName}}}`;
    if (ta) {
      const start = ta.selectionStart ?? draft.length;
      const end = ta.selectionEnd ?? draft.length;
      const next = draft.slice(0, start) + token + draft.slice(end);
      setDraft(next);
      // Restore cursor after the inserted token
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setDraft(d => d + token);
    }
  };

  const filteredCols = columns.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );
  const numericCols = filteredCols.filter(c => c.type === 'number');
  const otherCols = filteredCols.filter(c => c.type !== 'number');

  return (
    <>
      {/* Inline field with ... button */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {multiline ? (
          <textarea
            className="input"
            style={{ flex: 1, minHeight: 80, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <input
            className="input"
            style={{ flex: 1, fontSize: 12 }}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
          />
        )}
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 8px', fontSize: 14, flexShrink: 0, marginTop: 1 }}
          onClick={handleOpen}
          title="Open editor with field picker"
        >...</button>
      </div>

      {/* Modal overlay */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={e => { if (e.target === e.currentTarget) handleCancel(); }}>
          <div style={{
            background: 'var(--card-bg, #fff)', borderRadius: 10,
            width: Math.min(720, window.innerWidth - 40),
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Template Editor</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={handleCancel}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>Apply</button>
              </div>
            </div>

            {/* Body */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 300 }}>
              {/* Editor area */}
              <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column' }}>
                <textarea
                  ref={textRef}
                  className="input"
                  style={{
                    flex: 1, width: '100%', fontFamily: 'monospace', fontSize: 13,
                    resize: 'none', lineHeight: 1.5, minHeight: 200,
                  }}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder={placeholder}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  Click a field on the right to insert it at cursor position.
                </div>
              </div>

              {/* Field picker sidebar */}
              <div style={{
                width: 220, borderLeft: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                  <input
                    className="input"
                    style={{ width: '100%', fontSize: 12 }}
                    placeholder="Search fields..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>

                {/* Aggregation selector for numeric fields */}
                <div style={{
                  padding: '6px 10px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                }}>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Agg:</span>
                  <select
                    className="select select-sm"
                    style={{ flex: 1, fontSize: 11 }}
                    value={selAgg}
                    onChange={e => setSelAgg(e.target.value)}
                  >
                    {TEMPLATE_AGGS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                {/* Field list */}
                <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
                  {numericCols.length > 0 && (
                    <div style={{ padding: '4px 10px 2px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Numeric
                    </div>
                  )}
                  {numericCols.map(c => (
                    <button
                      key={c.name}
                      className="btn btn-ghost"
                      style={{
                        width: '100%', textAlign: 'left', padding: '5px 10px',
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                        borderRadius: 0,
                      }}
                      onClick={() => insertField(c.name, selAgg)}
                      title={`Insert {{${selAgg}:${c.name}}}`}
                    >
                      <span style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3,
                        background: 'var(--accent)', color: '#fff', flexShrink: 0,
                      }}>#</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </button>
                  ))}
                  {otherCols.length > 0 && (
                    <div style={{ padding: '8px 10px 2px', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Text / Date
                    </div>
                  )}
                  {otherCols.map(c => (
                    <button
                      key={c.name}
                      className="btn btn-ghost"
                      style={{
                        width: '100%', textAlign: 'left', padding: '5px 10px',
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                        borderRadius: 0,
                      }}
                      onClick={() => insertField(c.name, null)}
                      title={`Insert {{${c.name}}}`}
                    >
                      <span style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3,
                        background: c.type === 'date' ? '#8b5cf6' : '#64748b', color: '#fff', flexShrink: 0,
                      }}>{c.type === 'date' ? 'D' : 'A'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </button>
                  ))}
                  {filteredCols.length === 0 && (
                    <div style={{ padding: '12px 10px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                      {columns.length === 0 ? 'No dataset selected' : 'No matching fields'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Options tab (type-specific) ───────────────────────────────────────────────
function OptionsTab({ widget, columns, onUpdate, tableGroups, customFields }) {
  const { state } = useApp();
  if (widget.type === 'bar') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Orientation</label>
        <select className="select select-sm" value={widget.orientation || 'vertical'} onChange={e => onUpdate({ orientation: e.target.value })}>
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </div>
      {(widget.groupField || widget.barChartMeasures?.some(m => m.field)) && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Bar mode</label>
          <select className="select select-sm" value={widget.barMode || 'stacked'} onChange={e => onUpdate({ barMode: e.target.value })}>
            <option value="stacked">Stacked</option>
            <option value="grouped">Grouped (side by side)</option>
          </select>
        </div>
      )}
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.useLogScale} onChange={e => onUpdate({ useLogScale: e.target.checked })} />
        Logarithmic scale
      </label>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showGrid} onChange={e => onUpdate({ showGrid: e.target.checked })} />
        Show grid lines at every major tick
      </label>
      <ParetoOptions widget={widget} onUpdate={onUpdate} />
      <ReferenceLineOption widget={widget} onUpdate={onUpdate} />
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
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">X-axis spacing</label>
        <select className="select select-sm" value={widget.xAxisSpacing || 'equal'} onChange={e => onUpdate({ xAxisSpacing: e.target.value })}>
          <option value="equal">Equally spaced</option>
          <option value="linear">Proportional to value</option>
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
      <label className="checkbox-row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={!!widget.showTrendLine} onChange={e => onUpdate({ showTrendLine: e.target.checked })} />
        Show trend line (linear regression)
      </label>
    </div>
  );

  if (widget.type === 'scatter') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Point type</label>
        <select className="select select-sm" value={widget.scatterPointType || 'circle'} onChange={e => onUpdate({ scatterPointType: e.target.value })}>
          <option value="circle">Circles</option>
          <option value="pie">Mini pie charts</option>
          <option value="bar">Mini bar charts</option>
        </select>
        {(widget.scatterPointType === 'pie' || widget.scatterPointType === 'bar') && (
          <div style={{ marginTop: 6 }}>
            <label className="form-label">Chart source</label>
            <select className="select select-sm" value={widget.scatterOverlaySource || 'fields'} onChange={e => onUpdate({ scatterOverlaySource: e.target.value })}>
              <option value="fields">Multiple measure fields</option>
              <option value="dimension">Breakdown by dimension</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {widget.scatterOverlaySource === 'dimension'
                ? 'Set breakdown dimension in the Fields tab (uses Color/Series field)'
                : 'Add mini chart fields in the Fields tab'}
            </div>
          </div>
        )}
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Min dot size — {widget.dotSizeMin ?? 4}px</label>
        <input type="range" min={2} max={20} value={widget.dotSizeMin ?? 4}
          onChange={e => onUpdate({ dotSizeMin: parseInt(e.target.value) })} />
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Max dot size — {widget.dotSizeMax ?? 20}px</label>
        <input type="range" min={4} max={60} value={widget.dotSizeMax ?? 20}
          onChange={e => onUpdate({ dotSizeMax: parseInt(e.target.value) })} />
      </div>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showRegression} onChange={e => onUpdate({ showRegression: e.target.checked })} />
        Show regression line
      </label>
      {widget.showRegression && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Regression type</label>
          <select className="select select-sm" value={widget.regressionType || 'linear'} onChange={e => onUpdate({ regressionType: e.target.value })}>
            <option value="linear">Linear</option>
            <option value="polynomial">Polynomial (quadratic)</option>
          </select>
        </div>
      )}
    </div>
  );

  if (widget.type === 'pie') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Inner radius (0 = pie, &gt;0 = donut) — {widget.innerRadius ?? 0}%</label>
        <input type="range" min={0} max={80} value={widget.innerRadius ?? 0}
          onChange={e => onUpdate({ innerRadius: parseInt(e.target.value) })} />
      </div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showSliceValues} onChange={e => onUpdate({ showSliceValues: e.target.checked })} />
        Show values on slices
      </label>
      {widget.showSliceValues && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Slice label mode</label>
          <select className="select select-sm" value={widget.sliceValueMode || 'percent'} onChange={e => onUpdate({ sliceValueMode: e.target.value })}>
            <option value="percent">Percentage</option>
            <option value="value">Absolute value</option>
            <option value="both">Both</option>
          </select>
        </div>
      )}
      <ParetoOptions widget={widget} onUpdate={onUpdate} />
    </div>
  );

  if (widget.type === 'histogram') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Histogram type</label>
        <select className="select select-sm" value={widget.histType || 'equalWidth'} onChange={e => onUpdate({ histType: e.target.value })}>
          <option value="equalWidth">Equal width</option>
          <option value="equalHeight">Equal height (equal frequency)</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Bin count</label>
        <select className="select select-sm" value={widget.binCount || 'sturges'} onChange={e => onUpdate({ binCount: e.target.value })}>
          <option value="sturges">Auto (Sturges' rule)</option>
          <option value="manual">Manual</option>
        </select>
      </div>
      {widget.binCount === 'manual' && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Number of bins — {widget.bins ?? 20}</label>
          <input type="range" min={3} max={100} value={widget.bins ?? 20}
            onChange={e => onUpdate({ bins: parseInt(e.target.value) })} />
        </div>
      )}
    </div>
  );

  if (widget.type === 'treemap') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!widget.showLabels} onChange={e => onUpdate({ showLabels: e.target.checked })} />
        Show labels
      </label>
    </div>
  );

  if (widget.type === 'bump') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group">
        <label className="form-label">Top N series (0 = all)</label>
        <input type="number" className="input input-sm" min={0} value={widget.bumpTopN ?? 0}
          onChange={e => onUpdate({ bumpTopN: parseInt(e.target.value) || null })}
          placeholder="0 = show all" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Show only series that appear in the top N at any time step.
        </div>
      </div>
    </div>
  );

  if (widget.type === 'boxplot' || widget.type === 'violin') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">IQR multiplier — {widget.iqrMultiplier ?? 1.5}</label>
        <input type="range" min={0.5} max={3} step={0.1} value={widget.iqrMultiplier ?? 1.5}
          onChange={e => onUpdate({ iqrMultiplier: parseFloat(e.target.value) })} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Points beyond Q1/Q3 ± IQR×multiplier are outliers.
        </div>
      </div>
      <label className="checkbox-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={widget.showDataPoints !== false} onChange={e => onUpdate({ showDataPoints: e.target.checked })} />
        Show individual data points
      </label>
    </div>
  );

  if (widget.type === 'radar') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Line style</label>
        <select className="select select-sm" value={widget.radarCurve || 'straight'} onChange={e => onUpdate({ radarCurve: e.target.value })}>
          <option value="straight">Straight</option>
          <option value="curved">Curved (smooth)</option>
        </select>
      </div>
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
      <div className="form-group">
        <label className="form-label">Map scope</label>
        <select className="select select-sm" value={widget.mapScope || 'world'} onChange={e => onUpdate({ mapScope: e.target.value })}>
          <option value="world">World</option>
          <option value="north-america">North America</option>
          <option value="south-america">South America</option>
          <option value="europe">Europe</option>
          <option value="africa">Africa</option>
          <option value="asia">Asia</option>
          <option value="oceania">Oceania</option>
        </select>
        <input
          className="input input-sm"
          style={{ marginTop: 4 }}
          placeholder="Or type a country name..."
          value={!['world','north-america','south-america','europe','africa','asia','oceania'].includes(widget.mapScope || 'world') ? (widget.mapScope || '') : ''}
          onChange={e => onUpdate({ mapScope: e.target.value || 'world' })}
        />
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label className="form-label">Country overlay</label>
        <select className="select select-sm" value={widget.overlayType || ''} onChange={e => onUpdate({ overlayType: e.target.value || null })}>
          <option value="">None (choropleth only)</option>
          <option value="pie">Mini pie charts</option>
          <option value="bar">Mini bar charts</option>
        </select>
        {widget.overlayType && (
          <div style={{ marginTop: 6 }}>
            <label className="form-label">Overlay source</label>
            <select className="select select-sm" value={widget.overlaySource || 'fields'} onChange={e => onUpdate({ overlaySource: e.target.value })}>
              <option value="fields">Multiple measure fields</option>
              <option value="dimension">Breakdown by dimension</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {widget.overlaySource === 'dimension'
                ? 'Set breakdown dimension in the Fields tab'
                : 'Set overlay fields in the Fields tab'}
            </div>
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 12 }}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!widget.pointLayerEnabled} onChange={e => onUpdate({ pointLayerEnabled: e.target.checked })} />
          Enable point layer
        </label>
        {widget.pointLayerEnabled && (
          <div style={{ marginTop: 6 }}>
            <label className="form-label">Point type</label>
            <select className="select select-sm" value={widget.pointType || 'circle'} onChange={e => onUpdate({ pointType: e.target.value })}>
              <option value="circle">Colored circles</option>
              <option value="pie">Mini pie charts</option>
              <option value="bar">Mini bar charts</option>
            </select>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              Set lat, lng and other point fields in the Fields tab
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (widget.type === 'waterfall') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Mode</label>
        <select className="select select-sm" value={widget.waterfallMode || 'difference'} onChange={e => onUpdate({ waterfallMode: e.target.value })}>
          <option value="difference">Difference (running total)</option>
          <option value="absolute">Absolute values</option>
        </select>
      </div>
    </div>
  );

  if (widget.type === 'funnel') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Display mode</label>
        <select className="select select-sm" value={widget.funnelMode || 'absolute'} onChange={e => onUpdate({ funnelMode: e.target.value })}>
          <option value="absolute">Absolute values</option>
          <option value="cumulative">Cumulative (% of first stage)</option>
        </select>
      </div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
    </div>
  );

  if (widget.type === 'kpi') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Style</label>
        <select className="select select-sm" value={widget.kpiStyle || 'card'} onChange={e => onUpdate({ kpiStyle: e.target.value })}>
          <option value="card">Card</option>
          <option value="gauge">Gauge</option>
          <option value="satellite">Satellite (mini charts)</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Format</label>
        <select className="select select-sm" value={widget.kpiFormat || 'number'} onChange={e => onUpdate({ kpiFormat: e.target.value })}>
          <option value="number">Number</option>
          <option value="currency">Currency ($)</option>
          <option value="percent">Percent (%)</option>
        </select>
      </div>
      {widget.kpiStyle === 'gauge' && (
        <>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Gauge min — {widget.kpiGaugeMin ?? 0}</label>
            <input type="number" className="input input-sm" value={widget.kpiGaugeMin ?? 0}
              onChange={e => onUpdate({ kpiGaugeMin: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Gauge max — {widget.kpiGaugeMax ?? 100}</label>
            <input type="number" className="input input-sm" value={widget.kpiGaugeMax ?? 100}
              onChange={e => onUpdate({ kpiGaugeMax: parseFloat(e.target.value) || 100 })} />
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label className="form-label">Gauge segments (optional)</label>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
              Leave empty to use the color palette gradient
            </div>
            {(() => {
              // Auto-assign gradient colors to segments without customColor
              const autoColor = (segs) => {
                if (!segs.length) return segs;
                const effectiveScheme = widget.colorScheme ?? state.dashboard.theme?.colorScheme ?? 'vivid';
                const gk = resolveGradient(effectiveScheme, widget.colorGradient);
                const sw = getGradientSwatches(gk, segs.length);
                return segs.map((s, k) => s.customColor ? s : { ...s, color: sw[k] });
              };
              const segments = autoColor(widget.kpiGaugeSegments || []);
              return segments.map((seg, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                <input type="number" className="input input-sm" style={{ width: 60 }}
                  placeholder="From" value={seg.from ?? ''}
                  onChange={e => {
                    const segs = [...segments];
                    segs[i] = { ...segs[i], from: e.target.value === '' ? undefined : parseFloat(e.target.value) };
                    onUpdate({ kpiGaugeSegments: segs });
                  }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>to</span>
                <input type="number" className="input input-sm" style={{ width: 60 }}
                  placeholder="To" value={seg.to ?? ''}
                  onChange={e => {
                    const segs = [...segments];
                    segs[i] = { ...segs[i], to: e.target.value === '' ? undefined : parseFloat(e.target.value) };
                    onUpdate({ kpiGaugeSegments: segs });
                  }} />
                <input type="color" style={{ width: 28, height: 24, padding: 0, border: 'none', cursor: 'pointer' }}
                  value={seg.color || '#94a3b8'}
                  onChange={e => {
                    const segs = [...segments];
                    segs[i] = { ...segs[i], color: e.target.value, customColor: true };
                    onUpdate({ kpiGaugeSegments: segs });
                  }} />
                <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: 11 }}
                  onClick={() => {
                    const segs = segments.filter((_, j) => j !== i);
                    onUpdate({ kpiGaugeSegments: segs.length ? autoColor(segs) : undefined });
                  }}>×</button>
              </div>
              ));
            })()}
            <button className="btn btn-sm" style={{ fontSize: 11, marginTop: 2 }}
              onClick={() => {
                const segs = [...(widget.kpiGaugeSegments || [])];
                const lastTo = segs.length ? (segs[segs.length - 1].to ?? widget.kpiGaugeMax ?? 100) : (widget.kpiGaugeMin ?? 0);
                const max = widget.kpiGaugeMax ?? 100;
                const step = ((max - lastTo) || 10);
                segs.push({ from: lastTo, to: lastTo + step });
                const effectiveScheme = widget.colorScheme ?? state.dashboard.theme?.colorScheme ?? 'vivid';
                const gk = resolveGradient(effectiveScheme, widget.colorGradient);
                const sw = getGradientSwatches(gk, segs.length);
                const updated = segs.map((s, k) => s.customColor ? s : { ...s, color: sw[k] });
                onUpdate({ kpiGaugeSegments: updated });
              }}>+ Add segment</button>
          </div>
        </>
      )}
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Target value (optional)</label>
        <input type="number" className="input input-sm" value={widget.kpiTarget ?? ''}
          onChange={e => onUpdate({ kpiTarget: e.target.value ? parseFloat(e.target.value) : null })}
          placeholder="e.g. 1000" />
      </div>
    </div>
  );

  if (widget.type === 'wordcloud') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Text mode</label>
        <select className="select select-sm" value={widget.wordCloudMode || 'cell'} onChange={e => onUpdate({ wordCloudMode: e.target.value })}>
          <option value="cell">Each cell = one word</option>
          <option value="split">Split cell text into words</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Max words — {widget.wordCloudMaxWords ?? 100}</label>
        <input type="range" min={10} max={300} value={widget.wordCloudMaxWords ?? 100}
          onChange={e => onUpdate({ wordCloudMaxWords: parseInt(e.target.value) })} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={widget.wordCloudRotate !== false} onChange={e => onUpdate({ wordCloudRotate: e.target.checked })} />
        Allow rotated words
      </label>
    </div>
  );

  if (widget.type === 'combo') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Combo type</label>
        <select className="select select-sm" value={widget.comboType || 'barLine'} onChange={e => onUpdate({ comboType: e.target.value })}>
          <option value="barLine">Bar + Line</option>
          <option value="lineLine">Line + Line</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Secondary aggregation</label>
        <AggregationSelect
          value={widget.y2Aggregation || 'sum'}
          onChange={v => onUpdate({ y2Aggregation: v })}
          advancedStats={state.dashboard.advancedStats}
        />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={widget.dualAxis !== false} onChange={e => onUpdate({ dualAxis: e.target.checked })} />
        Dual Y-axis
      </label>
    </div>
  );

  if (widget.type === 'mekko') return (
    <div>
      <SortOptions widget={widget} onUpdate={onUpdate} />
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Value display</label>
        <select className="select select-sm" value={widget.mekkoValueMode || 'absolute'} onChange={e => onUpdate({ mekkoValueMode: e.target.value })}>
          <option value="absolute">Absolute</option>
          <option value="relative">Relative (%)</option>
          <option value="both">Both</option>
        </select>
      </div>
    </div>
  );

  if (widget.type === 'straighttable') {
    return (
      <div>
        <label className="checkbox-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={!!widget.straightTableShowTotals} onChange={e => onUpdate({ straightTableShowTotals: e.target.checked })} />
          Show totals row
        </label>
      </div>
    );
  }

  if (widget.type === 'heatmap') return (
    <div><SortOptions widget={widget} onUpdate={onUpdate} /></div>
  );

  if (widget.type === 'stream') return (
    <div><SortOptions widget={widget} onUpdate={onUpdate} /></div>
  );

  if (widget.type === 'waffle') return (
    <div><SortOptions widget={widget} onUpdate={onUpdate} /></div>
  );

  if (widget.type === 'line') return (
    <div><SortOptions widget={widget} onUpdate={onUpdate} /></div>
  );

  if (widget.type === 'bubble') return (
    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
      Circle sizes are proportional to the measure value via d3.pack().
    </div>
  );

  if (widget.type === 'table') {
    const allNames = columns.map(c => c.name);
    const visible = widget.visibleColumns; // null means all
    const allChecked = !Array.isArray(visible) || visible.length === allNames.length;

    const toggleColumn = (colName) => {
      let next;
      if (!Array.isArray(visible)) {
        // currently showing all — uncheck this one
        next = allNames.filter(n => n !== colName);
      } else if (visible.includes(colName)) {
        // uncheck — but don't allow unchecking the last one
        next = visible.filter(n => n !== colName);
        if (next.length === 0) return;
      } else {
        next = [...visible, colName];
      }
      // if all are checked, set to null
      if (next.length === allNames.length) next = null;
      onUpdate({ visibleColumns: next });
    };

    const toggleAll = () => {
      onUpdate({ visibleColumns: allChecked ? [] : null });
    };

    return (
      <div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">Visible columns</label>
          <label className="checkbox-row" style={{ marginBottom: 6, fontWeight: 600 }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            All columns
          </label>
          <div style={{ maxHeight: 240, overflowY: 'auto', paddingLeft: 4 }}>
            {allNames.map(name => {
              const checked = !Array.isArray(visible) || visible.includes(name);
              return (
                <label key={name} className="checkbox-row" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleColumn(name)} />
                  {name}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Text Content ─────────────────────────────────────────────
  if (widget.type === 'text') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Content mode</label>
        <select className="select select-sm" value={widget.contentMode || 'markdown'}
          onChange={e => onUpdate({ contentMode: e.target.value })}>
          <option value="plain">Plain text</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Content</label>
        <TemplateEditor
          value={widget.staticContent || ''}
          onChange={v => onUpdate({ staticContent: v })}
          columns={columns}
          multiline
          placeholder={'Write your content here...\n\nUse {{fieldName}} for dynamic measures.\nExample: Revenue is {{sum:revenue}}'}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Text align</label>
        <select className="select select-sm" value={widget.textAlign || 'left'}
          onChange={e => onUpdate({ textAlign: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Font size ({widget.textFontSize || 14}px)</label>
        <input type="range" min={10} max={48} step={1}
          value={widget.textFontSize || 14}
          onChange={e => onUpdate({ textFontSize: +e.target.value })}
          style={{ width: '100%' }} />
      </div>
    </div>
  );

  // ── Image ───────────────────────────────────────────────────
  if (widget.type === 'image') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Image URL</label>
        <TemplateEditor
          value={widget.imageUrl || ''}
          onChange={v => onUpdate({ imageUrl: v })}
          columns={columns}
          placeholder="https://example.com/image.png or {{url_field}}"
        />
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Fit mode</label>
        <select className="select select-sm" value={widget.imageFit || 'contain'}
          onChange={e => onUpdate({ imageFit: e.target.value })}>
          <option value="contain">Contain (fit inside)</option>
          <option value="cover">Cover (fill, may crop)</option>
          <option value="fill">Fill (stretch)</option>
        </select>
      </div>
    </div>
  );

  // ── Embed ───────────────────────────────────────────────────
  if (widget.type === 'embed') return (
    <div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label">Embed URL</label>
        <TemplateEditor
          value={widget.embedUrl || ''}
          onChange={v => onUpdate({ embedUrl: v })}
          columns={columns}
          placeholder="https://example.com/embed or {{url_field}}"
        />
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
    { key: 'labelField', label: 'Point label (optional)', filter: null, optional: true },
    { key: 'jitterField', label: 'Point X-position (optional)', filter: ['number'], optional: true },
  ],
  boxplot: [
    { key: 'xField', label: 'Category', filter: null },
    { key: 'yField', label: 'Value (numeric)', filter: ['number'] },
    { key: 'labelField', label: 'Point label (optional)', filter: null, optional: true },
    { key: 'jitterField', label: 'Point X-position (optional)', filter: ['number'], optional: true },
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
  const { state } = useApp();
  const [selIdx, setSelIdx] = useState(0);
  const cols = useMemo(() => getAllFields(state.colStore), [state.colStore]);
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
            <AggregationSelect
              value={slide.aggregation || 'sum'}
              onChange={v => updateSlide(selIdx, { aggregation: v })}
              advancedStats={state.dashboard.advancedStats}
            />
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

  // Unified field list from ALL tables (associative model)
  const allFields = useMemo(() => getAllFields(state.colStore), [state.colStore]);

  // Build a synthetic dataset for components that still expect dataset.data
  // Use the primary table's full data (all rows, all columns) so MeasurePipeline
  // and color pickers can see every field, not just the ones selected in the widget.
  const syntheticData = useMemo(() => {
    if (!widget || !state.datasets.length) return [];
    // First try resolveWidgetData (returns full table rows when fields match)
    const resolved = resolveWidgetData(widget, state.datasets, state.colStore, null);
    if (resolved.length > 0) return resolved;
    // Fallback: use first dataset's raw data
    return state.datasets[0]?.data ?? [];
  }, [widget, state.datasets, state.colStore]);

  const dataset = useMemo(() => {
    if (!syntheticData.length && !state.datasets.length) return null;
    return { data: syntheticData };
  }, [syntheticData, state.datasets]);

  // Table-grouped fields for all dropdowns
  const tableGroups = useMemo(() => getFieldsByTable(state.colStore), [state.colStore]);

  // Derived/custom columns from MeasurePipeline (columns NOT present in any table)
  const customFields = useMemo(() => {
    if (!widget?.measures?.length || !syntheticData.length) return [];
    try {
      const output = executeMeasurePipeline(syntheticData.slice(0, 100), widget.measures);
      if (output.length > 0) {
        const types = detectColumnTypes(output);
        const allFieldNames = new Set(allFields.map(f => f.name));
        return Object.keys(types)
          .filter(name => !allFieldNames.has(name))
          .map(name => ({ name, type: types[name] }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch { /* fallback */ }
    return [];
  }, [allFields, syntheticData, widget?.measures]);

  // Compute effective columns (all fields + custom derived ones)
  const columns = useMemo(() => {
    return [...customFields, ...allFields];
  }, [allFields, customFields]);

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

      <div className="editor-tabs">
        {tabs.map(t => (
          <button key={t} className={`editor-tab ${tab === t ? 'editor-tab--active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="editor-body">
        {tab === 'slides'     && <CarouselTab widget={widget} dataset={dataset} onUpdate={onUpdate} />}
        {tab === 'fields'     && <FieldsTab widget={widget} dataset={dataset} columns={columns} onUpdate={onUpdate} tableGroups={tableGroups} customFields={customFields} />}
        {tab === 'measures'   && <MeasurePipeline measures={widget.measures || []} dataset={dataset} onUpdate={m => onUpdate({ measures: m })} allColumns={allFields} tableGroups={tableGroups} />}
        {tab === 'colors'     && <ColorsTab widget={widget} dataset={dataset} columns={columns} onUpdate={onUpdate} dispatch={dispatch} dimensionColors={state.dashboard.dimensionColors || {}} />}
        {tab === 'aesthetics' && <AestheticsTab widget={widget} onUpdate={onUpdate} />}
        {tab === 'options'    && <OptionsTab widget={widget} columns={columns} onUpdate={onUpdate} tableGroups={tableGroups} customFields={customFields} />}
      </div>
    </div>
  );
}
