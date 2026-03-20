import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getSequentialScale, contrastText } from '../../utils/colorUtils';

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
      });
    }
    // Additional measures
    if (widget.straightTableMeasures?.length) {
      for (const m of widget.straightTableMeasures) {
        if (m.field) ms.push(m);
      }
    }
    return ms;
  }, [widget.valueField, widget.aggregation, widget.straightTableMeasures]);

  // ── Build column definitions ───────────────────────────────────────────────

  const columns = useMemo(() => {
    const cols = [];
    // Dimension columns
    for (const dim of dimensions) {
      cols.push({ key: dim, label: dim, type: 'dimension' });
    }
    // Measure columns
    for (const m of measures) {
      const aggLabel = m.aggregation || 'sum';
      const label = measures.length === 1 && m.field === widget.valueField
        ? `${m.field} (${aggLabel})`
        : `${m.field} (${aggLabel})`;
      const key = `${m.field}_${aggLabel}`;
      cols.push({ key, label, type: 'measure', field: m.field, aggregation: aggLabel });
    }
    return cols;
  }, [dimensions, measures, widget.valueField]);

  // ── Aggregate data ─────────────────────────────────────────────────────────

  const aggregatedRows = useMemo(() => {
    if (!data?.length || dimensions.length === 0 || measures.length === 0) return [];

    const groups = new Map();

    for (const row of data) {
      const keyParts = dimensions.map(d => String(row[d] ?? '(blank)'));
      const key = keyParts.join(KEY_SEP);

      if (!groups.has(key)) {
        groups.set(key, { keyParts, buckets: {} });
        for (const m of measures) {
          const mKey = `${m.field}_${m.aggregation || 'sum'}`;
          groups.get(key).buckets[mKey] = [];
        }
      }

      const group = groups.get(key);
      for (const m of measures) {
        const mKey = `${m.field}_${m.aggregation || 'sum'}`;
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
      for (const m of measures) {
        const mKey = `${m.field}_${m.aggregation || 'sum'}`;
        const agg = m.aggregation || 'sum';
        row[mKey] = aggregate(buckets[mKey], agg);
      }
      return row;
    });
  }, [data, dimensions, measures]);

  // ── Totals row ─────────────────────────────────────────────────────────────

  const totalsRow = useMemo(() => {
    if (!widget.straightTableShowTotals || aggregatedRows.length === 0) return null;

    const row = {};
    // Dimension columns get 'Total' for the first, empty for the rest
    dimensions.forEach((d, i) => {
      row[d] = i === 0 ? 'Total' : '';
    });
    // Aggregate all values for each measure
    for (const m of measures) {
      const mKey = `${m.field}_${m.aggregation || 'sum'}`;
      const agg = m.aggregation || 'sum';
      const vals = aggregatedRows.map(r => r[mKey]).filter(v => typeof v === 'number');
      // For totals, re-aggregate: sum of sums, count of counts, etc.
      // For mean/median/std we re-aggregate over the already-aggregated values
      row[mKey] = aggregate(vals, agg === 'count' ? 'sum' : agg);
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
    exportTableCSV(exportRows, columns, (widget.title || 'straight-table') + '.csv');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(c.key)}>
                  {c.label}
                  {sort.field === c.key && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '\u2191' : '\u2193'}</span>}
                  <span className="col-type">{c.type === 'dimension' ? 'dim' : 'num'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {columns.map(c => {
                  const cellVal = row[c.key];
                  const fmtStyle = getCellStyle(fmtMap, c.key, cellVal);
                  const isDim = c.type === 'dimension';
                  const clickable = onCrossFilter && isDim;
                  const displayVal = typeof cellVal === 'number' ? formatValue(cellVal) : cellVal;
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
                  const cellVal = totalsRow[c.key];
                  const displayVal = typeof cellVal === 'number' ? formatValue(cellVal) : cellVal;
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
