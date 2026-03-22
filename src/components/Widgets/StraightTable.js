import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getSequentialScale, contrastText, getColorArray } from '../../utils/colorUtils';
import { useApp } from '../../context/AppContext';

// ── CSV export ───────────────────────────────────────────────────────────────

function exportTableCSV(rows, columns, filename) {
  const esc = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map(c => esc(c.label)).join(','),
    ...rows.map(row => columns.map(c => esc(row[c.key])).join(',')),
  ];
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Conditional formatting evaluator ─────────────────────────────────────────

const OPS = {
  '>':  (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<':  (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => String(a) === String(b),
  '!=': (a, b) => String(a) !== String(b),
  'contains': (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
};

function evaluateRule(rule, cellValue) {
  const fn = OPS[rule.op];
  if (!fn) return false;
  const cmp = rule.op === 'contains' || rule.op === '==' || rule.op === '!='
    ? rule.value
    : parseFloat(rule.value);
  return fn(cellValue, cmp);
}

function buildFormattingMap(formatting, rows, columns) {
  if (!formatting?.length) return null;
  const map = {};
  for (const cf of formatting) {
    const colKey = columns.find(c => c.label === cf.column)?.key || cf.column;
    if (cf.mode === 'gradient') {
      const nums = rows.map(r => Number(r[colKey])).filter(v => !isNaN(v));
      if (nums.length === 0) continue;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const scale = getSequentialScale(cf.gradient || 'blues', min, max);
      map[colKey] = { type: 'gradient', scale };
    } else if (cf.mode === 'rules' && cf.rules?.length) {
      map[colKey] = { type: 'rules', rules: cf.rules };
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function getCellStyle(fmtMap, colKey, cellValue) {
  if (!fmtMap || !fmtMap[colKey]) return null;
  const fmt = fmtMap[colKey];

  if (fmt.type === 'gradient') {
    const num = Number(cellValue);
    if (isNaN(num)) return null;
    const bg = fmt.scale(num);
    return { backgroundColor: bg, color: contrastText(bg) };
  }

  if (fmt.type === 'rules') {
    for (const rule of fmt.rules) {
      if (evaluateRule(rule, cellValue)) {
        const style = {};
        if (rule.bg) style.backgroundColor = rule.bg;
        if (rule.text) style.color = rule.text;
        else if (rule.bg) style.color = contrastText(rule.bg);
        return Object.keys(style).length > 0 ? style : null;
      }
    }
  }
  return null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 29;
const HEADER_HEIGHT = 34;
const FOOTER_HEIGHT = 36;
const KEY_SEP = '|||';

// ── Inline mini-chart SVG components ─────────────────────────────────────────

function MiniBar({ slices, colors, width, height }) {
  if (!slices.length) return null;
  const maxVal = Math.max(...slices.map(s => Math.abs(s.value)), 1);
  const barW = (width - 2) / slices.length;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {slices.map((sl, i) => {
        const h = (Math.abs(sl.value) / maxVal) * (height - 2);
        return (
          <rect
            key={i}
            x={1 + i * barW}
            y={height - 1 - h}
            width={Math.max(1, barW - 1)}
            height={h}
            fill={colors[i % colors.length]}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

function MiniPie({ slices, colors, width, height }) {
  if (!slices.length) return null;
  const total = slices.reduce((s, sl) => s + Math.abs(sl.value), 0);
  if (total === 0) return null;
  const r = Math.min(width, height) / 2 - 1;
  const cx = width / 2, cy = height / 2;
  let cumAngle = -Math.PI / 2;
  const paths = slices.map((sl, i) => {
    const frac = Math.abs(sl.value) / total;
    const angle = frac * 2 * Math.PI;
    const a0 = cumAngle;
    const a1 = cumAngle + angle;
    cumAngle = a1;
    const large = angle > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    return (
      <path
        key={i}
        d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`}
        fill={colors[i % colors.length]}
        opacity={0.85}
      />
    );
  });
  return <svg width={width} height={height} style={{ display: 'block' }}>{paths}</svg>;
}

function MiniLine({ slices, colors, width, height }) {
  if (slices.length < 2) return null;
  const maxVal = Math.max(...slices.map(s => Math.abs(s.value)), 1);
  const pad = 2;
  const w = width - pad * 2, h = height - pad * 2;
  const step = w / (slices.length - 1);
  const points = slices.map((sl, i) => {
    const x = pad + i * step;
    const y = pad + h - (Math.abs(sl.value) / maxVal) * h;
    return `${x},${y}`;
  });
  // Area fill
  const areaPoints = [
    `${pad},${pad + h}`,
    ...points,
    `${pad + (slices.length - 1) * step},${pad + h}`,
  ].join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polygon points={areaPoints} fill={colors[0] || '#3b82f6'} opacity={0.15} />
      <polyline points={points.join(' ')} fill="none" stroke={colors[0] || '#3b82f6'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {slices.map((sl, i) => (
        <circle key={i} cx={pad + i * step} cy={pad + h - (Math.abs(sl.value) / maxVal) * h} r={1.5} fill={colors[i % colors.length]} />
      ))}
    </svg>
  );
}

function MiniChart({ type, slices, colors, width, height }) {
  if (type === 'pie') return <MiniPie slices={slices} colors={colors} width={width} height={height} />;
  if (type === 'line') return <MiniLine slices={slices} colors={colors} width={width} height={height} />;
  return <MiniBar slices={slices} colors={colors} width={width} height={height} />;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StraightTable({ widget, data, onCrossFilter }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ field: null, dir: 'asc' });
  const [pageSize, setPageSize] = useState(20);
  const containerRef = useRef(null);

  // Dynamically compute page size based on available height
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const available = el.clientHeight - HEADER_HEIGHT - FOOTER_HEIGHT;
    const fits = Math.max(1, Math.floor(available / ROW_HEIGHT));
    setPageSize(fits);
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // ── Resolve dimensions and measures ────────────────────────────────────────

  const dimensions = useMemo(() => {
    // Use dynamic straightTableDimensions array if available
    if (widget.straightTableDimensions?.length) {
      return widget.straightTableDimensions.filter(d => d);
    }
    // Backward compat: fall back to legacy fixed fields
    const dims = [];
    if (widget.xField) dims.push(widget.xField);
    if (widget.colorField) dims.push(widget.colorField);
    if (widget.groupField) dims.push(widget.groupField);
    return dims;
  }, [widget.straightTableDimensions, widget.xField, widget.colorField, widget.groupField]);

  const measures = useMemo(() => {
    const ms = [];
    // Primary measure from valueField
    if (widget.valueField) {
      ms.push({
        field: widget.valueField,
        aggregation: widget.aggregation || 'sum',
        representation: widget.primaryRepresentation || 'text',
        dimension: widget.primaryChartDimension || undefined,
        label: widget.primaryMeasureLabel || undefined,
      });
    }
    // Additional measures
    if (widget.straightTableMeasures?.length) {
      for (const m of widget.straightTableMeasures) {
        if (m.field) ms.push(m);
      }
    }
    return ms;
  }, [widget.valueField, widget.aggregation, widget.straightTableMeasures, widget.primaryRepresentation, widget.primaryChartDimension, widget.primaryMeasureLabel]);

  // ── Build column definitions ───────────────────────────────────────────────

  const columns = useMemo(() => {
    const cols = [];
    // Dimension columns
    for (const dim of dimensions) {
      cols.push({ key: dim, label: dim, type: 'dimension' });
    }
    // Measure columns — each may have a representation (text, bar, pie, line)
    // Use index-based keys to avoid collisions when same field+agg appears multiple times
    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      const aggLabel = m.aggregation || 'sum';
      const label = m.label || `${m.field} (${aggLabel})`;
      const key = `__m${mi}_${m.field}_${aggLabel}`;
      const repr = m.representation || 'text';
      const isChart = repr !== 'text';
      cols.push({
        key,
        label,
        type: isChart ? 'minichart' : 'measure',
        field: m.field,
        aggregation: aggLabel,
        chartType: isChart ? repr : null,
        chartDimension: isChart ? m.dimension : null,
        numberFormat: m.numberFormat || null,
      });
    }
    return cols;
  }, [dimensions, measures]);

  // ── Aggregate data ─────────────────────────────────────────────────────────

  const aggregatedRows = useMemo(() => {
    if (!data?.length || dimensions.length === 0 || measures.length === 0) return [];

    const groups = new Map();

    for (const row of data) {
      const keyParts = dimensions.map(d => String(row[d] ?? '(blank)'));
      const key = keyParts.join(KEY_SEP);

      if (!groups.has(key)) {
        groups.set(key, { keyParts, buckets: {} });
        for (let mi = 0; mi < measures.length; mi++) {
          const m = measures[mi];
          const mKey = `__m${mi}_${m.field}_${m.aggregation || 'sum'}`;
          groups.get(key).buckets[mKey] = [];
        }
      }

      const group = groups.get(key);
      for (let mi = 0; mi < measures.length; mi++) {
        const m = measures[mi];
        const mKey = `__m${mi}_${m.field}_${m.aggregation || 'sum'}`;
        const agg = m.aggregation || 'sum';
        const val = agg === 'count' ? 1 : (+row[m.field] || 0);
        group.buckets[mKey].push(val);
      }
    }

    return Array.from(groups.values()).map(({ keyParts, buckets }) => {
      const row = {};
      // Set dimension values
      dimensions.forEach((d, i) => {
        row[d] = keyParts[i];
      });
      // Set aggregated measure values
      for (let mi = 0; mi < measures.length; mi++) {
        const m = measures[mi];
        const mKey = `__m${mi}_${m.field}_${m.aggregation || 'sum'}`;
        const agg = m.aggregation || 'sum';
        row[mKey] = aggregate(buckets[mKey], agg, undefined, { distinct: m.distinct });
      }
      return row;
    });
  }, [data, dimensions, measures]);

  // ── Mini-chart data per column per row ──────────────────────────────────────

  const { state } = useApp();
  const chartCols = useMemo(() => columns.filter(c => c.type === 'minichart'), [columns]);

  // Build mini-chart slices for each chart column
  const mcDataMap = useMemo(() => {
    if (!chartCols.length || !data?.length) return null;
    const result = new Map(); // colKey → { slicesMap, dimVals }
    for (const col of chartCols) {
      const mcDim = col.chartDimension;
      const mcField = col.field;
      const mcAgg = col.aggregation || 'sum';
      if (!mcDim) continue;

      const rowMap = new Map();
      for (const row of data) {
        const keyParts = dimensions.map(d => String(row[d] ?? '(blank)'));
        const groupKey = keyParts.join(KEY_SEP);
        if (!rowMap.has(groupKey)) rowMap.set(groupKey, new Map());
        const dimVal = String(row[mcDim] ?? '(blank)');
        const subMap = rowMap.get(groupKey);
        if (!subMap.has(dimVal)) subMap.set(dimVal, []);
        subMap.get(dimVal).push(mcAgg === 'count' ? 1 : (+row[mcField] || 0));
      }

      const allDimVals = new Set();
      rowMap.forEach(sub => sub.forEach((_, k) => allDimVals.add(k)));
      const dimVals = [...allDimVals].sort();

      const slicesMap = new Map();
      rowMap.forEach((sub, groupKey) => {
        const slices = dimVals.map(dv => ({
          label: dv,
          value: sub.has(dv) ? aggregate(sub.get(dv), mcAgg, undefined, { distinct: widget.distinct }) : 0,
        }));
        slicesMap.set(groupKey, slices);
      });

      result.set(col.key, { slicesMap, dimVals });
    }
    return result.size > 0 ? result : null;
  }, [data, dimensions, chartCols, widget.distinct]);

  // Color arrays per chart column
  const mcColorsMap = useMemo(() => {
    if (!mcDataMap) return null;
    const scheme = widget.colorScheme ?? state.dashboard.theme?.colorScheme ?? 'vivid';
    const result = new Map();
    mcDataMap.forEach((info, colKey) => {
      result.set(colKey, getColorArray(scheme, info.dimVals.length));
    });
    return result;
  }, [mcDataMap, widget.colorScheme, state.dashboard.theme?.colorScheme]);

  // ── Totals row ─────────────────────────────────────────────────────────────

  const totalsRow = useMemo(() => {
    if (!widget.straightTableShowTotals || aggregatedRows.length === 0) return null;

    const row = {};
    // Dimension columns get 'Total' for the first, empty for the rest
    dimensions.forEach((d, i) => {
      row[d] = i === 0 ? 'Total' : '';
    });
    // Aggregate all values for each measure
    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      const mKey = `__m${mi}_${m.field}_${m.aggregation || 'sum'}`;
      const agg = m.aggregation || 'sum';
      const vals = aggregatedRows.map(r => r[mKey]).filter(v => typeof v === 'number');
      // For totals, re-aggregate: sum of sums, count of counts, etc.
      // For mean/median/std we re-aggregate over the already-aggregated values
      row[mKey] = aggregate(vals, agg === 'count' ? 'sum' : agg, undefined, { distinct: m.distinct });
    }
    return row;
  }, [widget.straightTableShowTotals, aggregatedRows, dimensions, measures]);

  // ── Conditional formatting ─────────────────────────────────────────────────

  const fmtMap = useMemo(
    () => buildFormattingMap(widget.conditionalFormatting, aggregatedRows, columns),
    [widget.conditionalFormatting, aggregatedRows, columns]
  );

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!data?.length || dimensions.length === 0 || measures.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#94a3b8', fontSize: 12,
      }}>
        {!data?.length
          ? 'No data'
          : dimensions.length === 0
            ? 'Select at least one dimension (X Field)'
            : 'Select a value field'}
      </div>
    );
  }

  // ── Sorting ────────────────────────────────────────────────────────────────

  let rows = [...aggregatedRows];

  if (sort.field) {
    rows.sort((a, b) => {
      const va = a[sort.field], vb = b[sort.field];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number')
        return sort.dir === 'asc' ? va - vb : vb - va;
      return sort.dir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }

  // ── Pagination ─────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(rows.length / pageSize);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const toggleSort = (field) => {
    setSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
    setPage(0);
  };

  // ── Build export data (all rows + optional totals) ─────────────────────────

  const handleExport = () => {
    const exportRows = totalsRow ? [...rows, totalsRow] : rows;
    const exportCols = columns.filter(c => c.type !== 'minichart');
    exportTableCSV(exportRows, exportCols, (widget.title || 'straight-table') + '.csv');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  style={{ cursor: c.type !== 'minichart' ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={c.type !== 'minichart' ? () => toggleSort(c.key) : undefined}
                >
                  {c.label}
                  {sort.field === c.key && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '\u2191' : '\u2193'}</span>}
                  {c.type !== 'minichart' && <span className="col-type">{c.type === 'dimension' ? 'dim' : 'num'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {columns.map(c => {
                  // Mini-chart cell
                  if (c.type === 'minichart' && c.chartDimension && mcDataMap?.get(c.key)) {
                    const colData = mcDataMap.get(c.key);
                    const colors = mcColorsMap?.get(c.key) || [];
                    const groupKey = dimensions.map(d => String(row[d] ?? '(blank)')).join(KEY_SEP);
                    const slices = colData.slicesMap.get(groupKey) || [];
                    return (
                      <td key={c.key} style={{ padding: '2px 4px', textAlign: 'center' }}>
                        <MiniChart type={c.chartType} slices={slices} colors={colors} width={80} height={22} />
                      </td>
                    );
                  }
                  const cellVal = row[c.key];
                  const fmtStyle = getCellStyle(fmtMap, c.key, cellVal);
                  const isDim = c.type === 'dimension';
                  const clickable = onCrossFilter && isDim;
                  const fmt = c.numberFormat || widget.numberFormat;
                  const displayVal = typeof cellVal === 'number' ? formatValue(cellVal, fmt) : cellVal;
                  return (
                    <td
                      key={c.key}
                      title={String(cellVal ?? '')}
                      onClick={clickable ? () => onCrossFilter({ field: c.key, value: cellVal }) : undefined}
                      style={{
                        ...(clickable ? { cursor: 'pointer' } : {}),
                        ...(fmtStyle || {}),
                        ...(!isDim ? { textAlign: 'right' } : {}),
                      }}
                    >
                      {cellVal === null || cellVal === undefined
                        ? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>null</span>
                        : String(displayVal)}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Totals row — only on the last page */}
            {totalsRow && safePage === totalPages - 1 && (
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                {columns.map(c => {
                  if (c.type === 'minichart') return <td key={c.key} />;
                  const cellVal = totalsRow[c.key];
                  const totFmt = c.numberFormat || widget.numberFormat;
                  const displayVal = typeof cellVal === 'number' ? formatValue(cellVal, totFmt) : cellVal;
                  return (
                    <td
                      key={c.key}
                      style={{
                        ...(c.type !== 'dimension' ? { textAlign: 'right' } : {}),
                      }}
                    >
                      {cellVal === null || cellVal === undefined ? '' : String(displayVal)}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderTop: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-muted)', flexShrink: 0,
      }}>
        <span>{rows.length.toLocaleString()} rows</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleExport}
            title="Export CSV"
          >Export CSV</button>
          {totalPages > 1 && (
            <>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={safePage === 0} onClick={() => setPage(0)}>&laquo;</button>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={safePage === 0} onClick={() => setPage(p => p - 1)}>&lsaquo;</button>
              <span>Page {safePage + 1} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={safePage === totalPages - 1} onClick={() => setPage(p => p + 1)}>&rsaquo;</button>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={safePage === totalPages - 1} onClick={() => setPage(totalPages - 1)}>&raquo;</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
