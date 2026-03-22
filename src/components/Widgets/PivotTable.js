import { useState, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { aggregate, formatValue, AGGREGATIONS } from '../../utils/dataUtils';

// ── CSV helpers ─────────────────────────────────────────────────────────────────
function downloadCSV(lines, filename) {
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

function esc(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Separator constants ─────────────────────────────────────────────────────────
const PATH_SEP = '|||';
const KEY_SEP = ':::';
const TOTAL_KEY = '__TOTAL__';

// MIME type for pivot dim drag-and-drop (internal only)
const DIM_MIME = 'application/pivot-dim';

export default function PivotTable({ widget, data, onCrossFilter }) {
  const { dispatch } = useApp();
  const [expanded, setExpanded] = useState(new Set());
  const [dragOver, setDragOver] = useState(null); // { axis, idx } — where the drop indicator is

  const pivotRows = useMemo(() => widget.pivotRows || [], [widget.pivotRows]);
  const pivotCols = useMemo(() => widget.pivotCols || [], [widget.pivotCols]);
  const valueField = widget.valueField;
  const aggFn = widget.aggregation || 'sum';

  // Track drag source so we can show visual feedback
  const dragSourceRef = useRef(null);

  // All columns from data
  const allColumns = useMemo(() => {
    if (!data?.length) return [];
    return Object.keys(data[0]);
  }, [data]);

  // Columns not already used in rows or cols
  const availableColumns = useMemo(() => {
    const used = new Set([...pivotRows, ...pivotCols]);
    return allColumns.filter(c => !used.has(c));
  }, [allColumns, pivotRows, pivotCols]);

  // ── Dispatch helpers ────────────────────────────────────────────────────────
  const updateWidget = useCallback((updates) => {
    dispatch({ type: 'UPDATE_WIDGET', payload: { id: widget.id, updates } });
  }, [dispatch, widget.id]);

  const removeDim = useCallback((axis, idx) => {
    if (axis === 'rows') {
      updateWidget({ pivotRows: pivotRows.filter((_, i) => i !== idx) });
    } else {
      updateWidget({ pivotCols: pivotCols.filter((_, i) => i !== idx) });
    }
  }, [pivotRows, pivotCols, updateWidget]);

  const addDim = useCallback((axis, col) => {
    if (!col) return;
    if (axis === 'rows') {
      updateWidget({ pivotRows: [...pivotRows, col] });
    } else {
      updateWidget({ pivotCols: [...pivotCols, col] });
    }
  }, [pivotRows, pivotCols, updateWidget]);

  // ── Drag-and-drop handlers for dimension chips ─────────────────────────────
  const handleDragStart = useCallback((e, axis, idx, dim) => {
    dragSourceRef.current = { axis, idx, dim };
    e.dataTransfer.setData(DIM_MIME, JSON.stringify({ axis, idx, dim }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOverChip = useCallback((e, axis, idx) => {
    if (!e.dataTransfer.types.includes(DIM_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ axis, idx });
  }, []);

  const handleDragOverZone = useCallback((e, axis) => {
    if (!e.dataTransfer.types.includes(DIM_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dims = axis === 'rows' ? pivotRows : pivotCols;
    setDragOver({ axis, idx: dims.length });
  }, [pivotRows, pivotCols]);

  const handleDragLeave = useCallback((e) => {
    // Only clear if actually leaving the zone
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(null);
    }
  }, []);

  const handleDrop = useCallback((e, targetAxis, targetIdx) => {
    e.preventDefault();
    setDragOver(null);
    const src = dragSourceRef.current;
    if (!src) return;
    dragSourceRef.current = null;

    const srcAxis = src.axis;
    const srcIdx = src.idx;
    const dim = src.dim;

    // Build new arrays
    let newRows = [...pivotRows];
    let newCols = [...pivotCols];

    // Remove from source
    if (srcAxis === 'rows') {
      newRows = newRows.filter((_, i) => i !== srcIdx);
    } else {
      newCols = newCols.filter((_, i) => i !== srcIdx);
    }

    // Adjust target index if removing from the same axis shifted things
    let adjIdx = targetIdx;
    if (srcAxis === targetAxis && srcIdx < targetIdx) {
      adjIdx--;
    }

    // Insert into target
    if (targetAxis === 'rows') {
      newRows.splice(adjIdx, 0, dim);
    } else {
      newCols.splice(adjIdx, 0, dim);
    }

    updateWidget({ pivotRows: newRows, pivotCols: newCols });
  }, [pivotRows, pivotCols, updateWidget]);

  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null;
    setDragOver(null);
  }, []);

  // ── Unique column paths (sorted) ──────────────────────────────────────────
  const colPaths = useMemo(() => {
    if (!data?.length || pivotCols.length === 0) return [];
    const set = new Map();
    for (const row of data) {
      const path = pivotCols.map(f => String(row[f] ?? '(blank)'));
      const key = path.join(PATH_SEP);
      if (!set.has(key)) set.set(key, path);
    }
    return Array.from(set.values()).sort((a, b) => {
      for (let i = 0; i < a.length; i++) {
        const cmp = a[i].localeCompare(b[i]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }, [data, pivotCols]);

  // ── Value map ─────────────────────────────────────────────────────────────
  const valueMap = useMemo(() => {
    if (!data?.length || !valueField) return new Map();
    const buckets = new Map();

    const getOrCreate = (key) => {
      if (!buckets.has(key)) buckets.set(key, []);
      return buckets.get(key);
    };

    for (const row of data) {
      const val = aggFn === 'count' ? 1 : (+row[valueField] || 0);
      const rowPath = pivotRows.map(f => String(row[f] ?? '(blank)'));
      const colPath = pivotCols.map(f => String(row[f] ?? '(blank)'));
      const rowKey = rowPath.join(PATH_SEP);
      const colKey = colPath.join(PATH_SEP);

      // Full intersection
      getOrCreate(rowKey + KEY_SEP + colKey).push(val);

      // Row total
      getOrCreate(rowKey + KEY_SEP + TOTAL_KEY).push(val);

      // Column total
      getOrCreate(TOTAL_KEY + KEY_SEP + colKey).push(val);

      // Grand total
      getOrCreate(TOTAL_KEY + KEY_SEP + TOTAL_KEY).push(val);

      // Partial row paths (subtotals) x column paths
      for (let depth = 0; depth < rowPath.length - 1; depth++) {
        const partialRowKey = rowPath.slice(0, depth + 1).join(PATH_SEP);
        getOrCreate(partialRowKey + KEY_SEP + colKey).push(val);
        getOrCreate(partialRowKey + KEY_SEP + TOTAL_KEY).push(val);
      }
    }

    // Aggregate all buckets
    const result = new Map();
    for (const [key, vals] of buckets) {
      result.set(key, aggregate(vals, aggFn));
    }
    return result;
  }, [data, valueField, pivotRows, pivotCols, aggFn]);

  const getValue = useCallback((rowKey, colKey) => {
    return valueMap.get(rowKey + KEY_SEP + colKey);
  }, [valueMap]);

  // ── Row tree ──────────────────────────────────────────────────────────────
  const rowTree = useMemo(() => {
    if (!data?.length || pivotRows.length === 0) return new Map();
    const tree = new Map();
    for (const row of data) {
      let node = tree;
      for (let i = 0; i < pivotRows.length; i++) {
        const key = String(row[pivotRows[i]] ?? '(blank)');
        if (!node.has(key)) node.set(key, i < pivotRows.length - 1 ? new Map() : null);
        node = node.get(key);
        if (node === null) break;
      }
    }
    // Sort each level
    const sortMap = (map) => {
      if (!map || !(map instanceof Map)) return map;
      const sorted = new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
      for (const [k, v] of sorted) {
        if (v instanceof Map) sorted.set(k, sortMap(v));
      }
      return sorted;
    };
    return sortMap(tree);
  }, [data, pivotRows]);

  // ── Collect all non-leaf row keys for expand all ─────────────────────────
  const allNonLeafKeys = useMemo(() => {
    const keys = new Set();
    const walk = (map, path) => {
      if (!map || !(map instanceof Map)) return;
      for (const [k, v] of map) {
        const newPath = [...path, k];
        if (v instanceof Map) {
          keys.add(newPath.join(PATH_SEP));
          walk(v, newPath);
        }
      }
    };
    walk(rowTree, []);
    return keys;
  }, [rowTree]);

  const expandAll = useCallback(() => setExpanded(new Set(allNonLeafKeys)), [allNonLeafKeys]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const toggleExpand = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Build flat row list for rendering ─────────────────────────────────────
  const flatRows = useMemo(() => {
    const rows = [];
    if (pivotRows.length === 0) {
      // No row dims: single "All" row
      rows.push({ path: [], label: 'All', depth: 0, isLeaf: true, rowKey: TOTAL_KEY });
      return rows;
    }
    const walk = (map, path, depth) => {
      if (!map || !(map instanceof Map)) return;
      for (const [k, v] of map) {
        const newPath = [...path, k];
        const pathKey = newPath.join(PATH_SEP);
        const isLeaf = !(v instanceof Map);
        rows.push({ path: newPath, label: k, depth, isLeaf, rowKey: pathKey });
        if (!isLeaf && expanded.has(pathKey)) {
          walk(v, newPath, depth + 1);
        }
      }
    };
    walk(rowTree, [], 0);
    return rows;
  }, [rowTree, pivotRows, expanded]);

  // ── Column header rows ────────────────────────────────────────────────────
  const colHeaderRows = useMemo(() => {
    if (colPaths.length === 0) return [];
    const levels = pivotCols.length;
    const headerRows = [];
    for (let lvl = 0; lvl < levels; lvl++) {
      const cells = [];
      let i = 0;
      while (i < colPaths.length) {
        const val = colPaths[i][lvl];
        let span = 1;
        while (i + span < colPaths.length) {
          const next = colPaths[i + span];
          let parentMatch = true;
          for (let p = 0; p < lvl; p++) {
            if (colPaths[i][p] !== next[p]) { parentMatch = false; break; }
          }
          if (parentMatch && next[lvl] === val) span++;
          else break;
        }
        cells.push({ label: val, span });
        i += span;
      }
      headerRows.push(cells);
    }
    return headerRows;
  }, [colPaths, pivotCols]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const lines = [];
    // Header rows
    if (colHeaderRows.length > 0) {
      for (let lvl = 0; lvl < colHeaderRows.length; lvl++) {
        const parts = [esc('')];
        for (const cell of colHeaderRows[lvl]) {
          parts.push(esc(cell.label));
          for (let s = 1; s < cell.span; s++) parts.push('');
        }
        parts.push(esc('Total'));
        lines.push(parts.join(','));
      }
    } else {
      lines.push([esc(''), esc('Value'), esc('Total')].join(','));
    }

    // Data rows
    for (const row of flatRows) {
      const indent = '  '.repeat(row.depth);
      const parts = [esc(indent + row.label)];
      if (colPaths.length > 0) {
        for (const cp of colPaths) {
          const colKey = cp.join(PATH_SEP);
          const v = getValue(row.rowKey, colKey);
          parts.push(esc(v != null ? formatValue(v, widget.numberFormat) : ''));
        }
      } else {
        const v = getValue(row.rowKey, TOTAL_KEY);
        parts.push(esc(v != null ? formatValue(v, widget.numberFormat) : ''));
      }
      const rowTotal = getValue(row.rowKey, TOTAL_KEY);
      parts.push(esc(rowTotal != null ? formatValue(rowTotal, widget.numberFormat) : ''));
      lines.push(parts.join(','));
    }

    // Grand total row
    {
      const parts = [esc('Grand Total')];
      if (colPaths.length > 0) {
        for (const cp of colPaths) {
          const colKey = cp.join(PATH_SEP);
          const v = getValue(TOTAL_KEY, colKey);
          parts.push(esc(v != null ? formatValue(v, widget.numberFormat) : ''));
        }
      } else {
        const v = getValue(TOTAL_KEY, TOTAL_KEY);
        parts.push(esc(v != null ? formatValue(v, widget.numberFormat) : ''));
      }
      const gt = getValue(TOTAL_KEY, TOTAL_KEY);
      parts.push(esc(gt != null ? formatValue(gt, widget.numberFormat) : ''));
      lines.push(parts.join(','));
    }

    downloadCSV(lines, (widget.title || 'pivot') + '.csv');
  }, [colPaths, colHeaderRows, flatRows, getValue, widget.title, widget.numberFormat]);

  // ── Dimension chip renderer ────────────────────────────────────────────────
  const renderChip = (axis, dim, idx) => {
    const isDropTarget = dragOver && dragOver.axis === axis && dragOver.idx === idx;
    return (
      <span key={dim} style={{ display: 'inline-flex', alignItems: 'center' }}>
        {isDropTarget && <span className="pivot-drop-indicator" />}
        <span
          className="pivot-dim-chip"
          draggable
          onDragStart={e => handleDragStart(e, axis, idx, dim)}
          onDragEnd={handleDragEnd}
          onDragOver={e => handleDragOverChip(e, axis, idx)}
        >
          <span className="pivot-dim-grip">⠿</span>
          <span>{dim}</span>
          <button
            className="pivot-dim-btn"
            onClick={() => removeDim(axis, idx)}
            title="Remove"
          >&times;</button>
        </span>
      </span>
    );
  };

  // ── Dimension Controls ────────────────────────────────────────────────────
  const DimensionControls = (
    <div className="pivot-dim-controls">
      {['rows', 'cols'].map(axis => {
        const dims = axis === 'rows' ? pivotRows : pivotCols;
        const isEndTarget = dragOver && dragOver.axis === axis && dragOver.idx === dims.length;
        return (
          <div
            key={axis}
            className="pivot-dim-axis"
            onDragOver={e => handleDragOverZone(e, axis)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, axis, dims.length)}
          >
            <span className="pivot-dim-label">{axis === 'rows' ? 'Rows:' : 'Cols:'}</span>
            <div className="pivot-dim-chips">
              {dims.map((dim, idx) => (
                <span
                  key={dim}
                  onDrop={e => { e.stopPropagation(); handleDrop(e, axis, idx); }}
                  onDragOver={e => handleDragOverChip(e, axis, idx)}
                >
                  {renderChip(axis, dim, idx)}
                </span>
              ))}
              {isEndTarget && <span className="pivot-drop-indicator" />}
              {availableColumns.length > 0 && (
                <select
                  className="pivot-dim-add"
                  value=""
                  onChange={e => addDim(axis, e.target.value)}
                >
                  <option value="">+ Add</option>
                  {availableColumns.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!valueField || (pivotRows.length === 0 && pivotCols.length === 0)) {
    return (
      <div className="pivot-container">
        {DimensionControls}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>
          {!valueField
            ? 'Select a value field and at least one row or column dimension.'
            : 'Add at least one row or column dimension.'}
        </div>
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="pivot-container">
        {DimensionControls}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>
          No data available.
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const aggLabel = AGGREGATIONS[aggFn] || aggFn;
  const showExpandControls = pivotRows.length > 1;

  return (
    <div className="pivot-container">
      {DimensionControls}

      {/* Pivot grid */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="pivot-table">
          <thead>
            {colHeaderRows.length > 0 ? (
              colHeaderRows.map((cells, lvl) => (
                <tr key={lvl}>
                  {lvl === 0 && (
                    <th
                      className="pivot-corner"
                      rowSpan={colHeaderRows.length}
                    />
                  )}
                  {cells.map((cell, ci) => (
                    <th
                      key={ci}
                      className="pivot-col-header"
                      colSpan={cell.span}
                    >
                      {cell.label}
                    </th>
                  ))}
                  {lvl === 0 && (
                    <th
                      className="pivot-col-header pivot-total-cell"
                      rowSpan={colHeaderRows.length}
                    >
                      Total
                    </th>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <th className="pivot-corner" />
                <th className="pivot-col-header">Value</th>
                <th className="pivot-col-header pivot-total-cell">Total</th>
              </tr>
            )}
          </thead>
          <tbody>
            {flatRows.map((row, ri) => {
              const isSubtotal = !row.isLeaf && pivotRows.length > 1;
              const rowClassName = isSubtotal ? 'pivot-subtotal-row' : '';
              return (
                <tr key={ri} className={rowClassName}>
                  <td
                    className="pivot-row-header"
                    style={{ paddingLeft: 8 + row.depth * 18 }}
                  >
                    {!row.isLeaf ? (
                      <button
                        className="pivot-toggle"
                        onClick={() => toggleExpand(row.rowKey)}
                      >
                        {expanded.has(row.rowKey) ? '\u25BC' : '\u25B6'}
                      </button>
                    ) : (
                      pivotRows.length > 1 && <span style={{ display: 'inline-block', width: 18 }} />
                    )}
                    <span
                      onClick={onCrossFilter && row.isLeaf ? () => onCrossFilter({ field: pivotRows[row.depth], value: row.label }) : undefined}
                      style={onCrossFilter && row.isLeaf ? { cursor: 'pointer' } : undefined}
                    >{row.label}</span>
                  </td>
                  {colPaths.length > 0 ? (
                    colPaths.map((cp, ci) => {
                      const colKey = cp.join(PATH_SEP);
                      const v = getValue(row.rowKey, colKey);
                      return (
                        <td key={ci} className={isSubtotal ? 'pivot-cell pivot-total-cell' : 'pivot-cell'}>
                          {v != null ? formatValue(v, widget.numberFormat) : ''}
                        </td>
                      );
                    })
                  ) : (
                    <td className={isSubtotal ? 'pivot-cell pivot-total-cell' : 'pivot-cell'}>
                      {(() => {
                        const v = getValue(row.rowKey, TOTAL_KEY);
                        return v != null ? formatValue(v, widget.numberFormat) : '';
                      })()}
                    </td>
                  )}
                  {/* Row total */}
                  <td className="pivot-cell pivot-total-cell">
                    {(() => {
                      const v = getValue(row.rowKey, TOTAL_KEY);
                      return v != null ? formatValue(v, widget.numberFormat) : '';
                    })()}
                  </td>
                </tr>
              );
            })}

            {/* Grand total row */}
            <tr className="pivot-grand-total-row">
              <td className="pivot-row-header pivot-total-cell">Grand Total</td>
              {colPaths.length > 0 ? (
                colPaths.map((cp, ci) => {
                  const colKey = cp.join(PATH_SEP);
                  const v = getValue(TOTAL_KEY, colKey);
                  return (
                    <td key={ci} className="pivot-cell pivot-total-cell">
                      {v != null ? formatValue(v, widget.numberFormat) : ''}
                    </td>
                  );
                })
              ) : (
                <td className="pivot-cell pivot-total-cell">
                  {(() => {
                    const v = getValue(TOTAL_KEY, TOTAL_KEY);
                    return v != null ? formatValue(v, widget.numberFormat) : '';
                  })()}
                </td>
              )}
              <td className="pivot-cell pivot-total-cell">
                {(() => {
                  const v = getValue(TOTAL_KEY, TOTAL_KEY);
                  return v != null ? formatValue(v, widget.numberFormat) : '';
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer — consistent with DataTable */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderTop: '1px solid var(--border)',
        fontSize: 12, color: 'var(--text-muted)', flexShrink: 0,
      }}>
        <span>{aggLabel} of {valueField}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {showExpandControls && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={expandAll}>Expand All</button>
              <button className="btn btn-ghost btn-sm" onClick={collapseAll}>Collapse All</button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleExport}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}
