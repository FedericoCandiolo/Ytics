import { useState, useMemo } from 'react';
import { getColumnInfo } from '../../utils/dataUtils';
import { getSequentialScale, contrastText } from '../../utils/colorUtils';

function exportTableCSV(data, cols, filename) {
  const esc = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    cols.map(c => esc(c.name)).join(','),
    ...data.map(row => cols.map(c => esc(row[c.name])).join(',')),
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

// ── Conditional formatting evaluator ──────────────────────────────────────────

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

function buildFormattingMap(formatting, data) {
  if (!formatting?.length) return null;
  const map = {};
  for (const cf of formatting) {
    if (cf.mode === 'gradient') {
      const nums = data.map(r => Number(r[cf.column])).filter(v => !isNaN(v));
      if (nums.length === 0) continue;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const scale = getSequentialScale(cf.gradient || 'blues', min, max);
      map[cf.column] = { type: 'gradient', scale };
    } else if (cf.mode === 'rules' && cf.rules?.length) {
      map[cf.column] = { type: 'rules', rules: cf.rules };
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function getCellStyle(fmtMap, colName, cellValue) {
  if (!fmtMap || !fmtMap[colName]) return null;
  const fmt = fmtMap[colName];

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function DataTable({ widget, data, onCrossFilter }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ field: null, dir: 'asc' });
  const PAGE_SIZE = 20;

  const fmtMap = useMemo(
    () => buildFormattingMap(widget.conditionalFormatting, data),
    [widget.conditionalFormatting, data]
  );

  if (!data?.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#94a3b8', fontSize: 12,
      }}>
        No data
      </div>
    );
  }

  const cols = getColumnInfo(data);
  let rows = [...data];

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

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (field) => {
    setSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
    setPage(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.name} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(c.name)}>
                  {c.name}
                  {sort.field === c.name && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                  <span className="col-type">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {cols.map(c => {
                  const cellVal = row[c.name];
                  const fmtStyle = getCellStyle(fmtMap, c.name, cellVal);
                  const clickable = onCrossFilter && c.type !== 'number';
                  return (
                    <td
                      key={c.name}
                      title={String(cellVal ?? '')}
                      onClick={clickable ? () => onCrossFilter({ field: c.name, value: cellVal }) : undefined}
                      style={{
                        ...(clickable ? { cursor: 'pointer' } : {}),
                        ...(fmtStyle || {}),
                      }}
                    >
                      {cellVal === null || cellVal === undefined
                        ? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>null</span>
                        : String(cellVal)}
                    </td>
                  );
                })}
              </tr>
            ))}
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
            onClick={() => exportTableCSV(rows, cols, (widget.title || 'table') + '.csv')}
            title="Export CSV"
          >Export CSV</button>
          {totalPages > 1 && (
            <>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
              <span>Page {page + 1} / {totalPages}</span>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
              <button className="btn btn-ghost btn-sm btn-icon" disabled={page === totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
