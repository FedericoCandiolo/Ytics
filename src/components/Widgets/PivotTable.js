import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { aggregate, formatValue, AGGREGATIONS } from '../../utils/dataUtils';

// ── CSV helpers ─────────────────────────────────────────────────────────────────
function downloadCSV(lines, filename) {
  const bom = '﻿';
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
  const { state, dispatch } = useApp();
  const [expanded, setExpanded] = useState(new Set());
  const [expandedCols, setExpandedCols] = useState(new Set());
  const hideBlanks = !!widget.pivotHideBlanks;
  const hideZeros = !!widget.pivotHideZeros;
  const [dragOver, setDragOver] = useState(null);
  const [fieldSearch, setFieldSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  const pivotRows = useMemo(() => widget.pivotRows || [], [widget.pivotRows]);
  const pivotCols = useMemo(() => widget.pivotCols || [], [widget.pivotCols]);
  const valueField = widget.valueField;
  const aggFn = widget.aggregation || 'sum';

  const dragSourceRef = useRef(null);

  // All columns from ALL datasets (not just the current widget's data)
  const allColumns = useMemo(() => {
    const cols = new Set();
    if (data?.length) Object.keys(data[0]).forEach(c => cols.add(c));
    if (state.colStore?.tables) {
      for (const table of Object.values(state.colStore.tables)) {
        if (table.columns) Object.keys(table.columns).forEach(c => cols.add(c));
      }
    }
    return [...cols].sort((a, b) => a.localeCompare(b));
  }, [data, state.colStore]);

  const availableColumns = useMemo(() => {
    const used = new Set([...pivotRows, ...pivotCols]);
    return allColumns.filter(c => !used.has(c));
  }, [allColumns, pivotRows, pivotCols]);

  const filteredColumns = useMemo(() => {
    if (!fieldSearch.trim()) return availableColumns;
    const q = fieldSearch.toLowerCase();
    return availableColumns.filter(c => c.toLowerCase().includes(q));
  }, [availableColumns, fieldSearch]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setFieldSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

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

    let newRows = [...pivotRows];
    let newCols = [...pivotCols];

    if (srcAxis === 'rows') newRows = newRows.filter((_, i) => i !== srcIdx);
    else newCols = newCols.filter((_, i) => i !== srcIdx);

    let adjIdx = targetIdx;
    if (srcAxis === targetAxis && srcIdx < targetIdx) adjIdx--;

    if (targetAxis === 'rows') newRows.splice(adjIdx, 0, dim);
    else newCols.splice(adjIdx, 0, dim);

    updateWidget({ pivotRows: newRows, pivotCols: newCols });
  }, [pivotRows, pivotCols, updateWidget]);

  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null;
    setDragOver(null);
  }, []);

  // ── Full column paths (used for valueMap bucketing) ───────────────────────
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

  // ── Column tree (mirrors rowTree for expand/collapse) ─────────────────────
  const colTree = useMemo(() => {
    if (!data?.length || pivotCols.length === 0) return new Map();
    const tree = new Map();
    for (const row of data) {
      let node = tree;
      for (let i = 0; i < pivotCols.length; i++) {
        const key = String(row[pivotCols[i]] ?? '(blank)');
        if (!node.has(key)) node.set(key, i < pivotCols.length - 1 ? new Map() : null);
        node = node.get(key);
        if (node === null) break;
      }
    }
    const sortMap = (map) => {
      if (!map || !(map instanceof Map)) return map;
      const sorted = new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
      for (const [k, v] of sorted) {
        if (v instanceof Map) sorted.set(k, sortMap(v));
      }
      return sorted;
    };
    return sortMap(tree);
  }, [data, pivotCols]);

  // ── All non-leaf column keys (for Expand All) ─────────────────────────────
  const allNonLeafColKeys = useMemo(() => {
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
    walk(colTree, []);
    return keys;
  }, [colTree]);

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

      // Partial row paths × full col + total
      for (let rdepth = 0; rdepth < rowPath.length - 1; rdepth++) {
        const partialRowKey = rowPath.slice(0, rdepth + 1).join(PATH_SEP);
        getOrCreate(partialRowKey + KEY_SEP + colKey).push(val);
        getOrCreate(partialRowKey + KEY_SEP + TOTAL_KEY).push(val);
      }

      // Partial col paths × full row + total (enables collapsed col subtotals)
      for (let cdepth = 0; cdepth < colPath.length - 1; cdepth++) {
        const partialColKey = colPath.slice(0, cdepth + 1).join(PATH_SEP);
        getOrCreate(rowKey + KEY_SEP + partialColKey).push(val);
        getOrCreate(TOTAL_KEY + KEY_SEP + partialColKey).push(val);
        // Also partial row × partial col
        for (let rdepth = 0; rdepth < rowPath.length - 1; rdepth++) {
          const partialRowKey = rowPath.slice(0, rdepth + 1).join(PATH_SEP);
          getOrCreate(partialRowKey + KEY_SEP + partialColKey).push(val);
        }
      }
    }

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

  const expandAll = useCallback(() => {
    setExpanded(new Set(allNonLeafKeys));
    setExpandedCols(new Set(allNonLeafColKeys));
  }, [allNonLeafKeys, allNonLeafColKeys]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    setExpandedCols(new Set());
  }, []);

  const toggleExpand = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleExpandCol = useCallback((key) => {
    setExpandedCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Flat row list for rendering ───────────────────────────────────────────
  const flatRows = useMemo(() => {
    const rows = [];
    if (pivotRows.length === 0) {
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

  // ── Visible column paths (collapsed groups show as subtotal columns) ───────
  const visibleColPaths = useMemo(() => {
    if (pivotCols.length === 0) return [];
    const visible = [];
    const walk = (map, path) => {
      if (!map || !(map instanceof Map)) return;
      for (const [k, v] of map) {
        const newPath = [...path, k];
        const pathKey = newPath.join(PATH_SEP);
        const isLeaf = !(v instanceof Map);
        if (isLeaf || !expandedCols.has(pathKey)) {
          // Show as a single column (leaf or collapsed group = subtotal)
          visible.push(newPath);
        } else {
          // Expanded: recurse into children (no subtotal column for this group)
          walk(v, newPath);
        }
      }
    };
    walk(colTree, []);
    return visible;
  }, [colTree, pivotCols, expandedCols]);

  // ── Filter: hide blank / zero dimensions ─────────────────────────────────
  const filteredFlatRows = useMemo(() => {
    let rows = flatRows;
    if (hideBlanks) rows = rows.filter(r => !r.path.some(v => v === '(blank)' || v === ''));
    if (hideZeros) rows = rows.filter(r => {
      const v = getValue(r.rowKey, TOTAL_KEY);
      return v != null && v !== 0;
    });
    return rows;
  }, [flatRows, hideBlanks, hideZeros, getValue]);

  const filteredVisibleColPaths = useMemo(() => {
    let paths = visibleColPaths;
    if (hideBlanks) paths = paths.filter(p => !p.some(v => v === '(blank)' || v === ''));
    if (hideZeros) paths = paths.filter(p => {
      const v = getValue(TOTAL_KEY, p.join(PATH_SEP));
      return v != null && v !== 0;
    });
    return paths;
  }, [visibleColPaths, hideBlanks, hideZeros, getValue]);

  // ── Column header rows (supports mixed-depth paths + expand toggles) ───────
  const colHeaderRows = useMemo(() => {
    if (filteredVisibleColPaths.length === 0) return [];
    const levels = pivotCols.length;
    const headerRows = [];

    for (let lvl = 0; lvl < levels; lvl++) {
      const cells = [];
      let i = 0;
      while (i < filteredVisibleColPaths.length) {
        const path = filteredVisibleColPaths[i];
        const pathDepth = path.length - 1; // 0-indexed

        if (pathDepth < lvl) {
          // This partial path spans via rowSpan from a higher level — skip here
          i++;
          continue;
        }

        const val = path[lvl];
        let span = 1;
        while (i + span < filteredVisibleColPaths.length) {
          const next = filteredVisibleColPaths[i + span];
          if (next.length - 1 < lvl) break;
          let parentMatch = true;
          for (let p = 0; p < lvl; p++) {
            if (path[p] !== next[p]) { parentMatch = false; break; }
          }
          if (parentMatch && next[lvl] === val) span++;
          else break;
        }

        // A partial path at its leaf level (pathDepth === lvl) needs rowSpan to cover remaining levels
        const isLeafCell = pathDepth === lvl;
        const rowSpan = isLeafCell && lvl < levels - 1 ? levels - lvl : 1;
        // Toggle: only shown for non-last levels
        const showToggle = lvl < levels - 1;
        // isExpanded: true when this group's children are visible (path goes deeper than lvl)
        const isExpanded = pathDepth > lvl;
        const partialKey = path.slice(0, lvl + 1).join(PATH_SEP);

        cells.push({ label: val, span, rowSpan, showToggle, isExpanded, partialKey });
        i += span;
      }
      headerRows.push(cells);
    }
    return headerRows;
  }, [filteredVisibleColPaths, pivotCols]);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const lines = [];
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

    for (const row of filteredFlatRows) {
      const indent = '  '.repeat(row.depth);
      const parts = [esc(indent + row.label)];
      if (filteredVisibleColPaths.length > 0) {
        for (const cp of filteredVisibleColPaths) {
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

    {
      const parts = [esc('Grand Total')];
      if (filteredVisibleColPaths.length > 0) {
        for (const cp of filteredVisibleColPaths) {
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
  }, [colHeaderRows, filteredFlatRows, filteredVisibleColPaths, getValue, widget.title, widget.numberFormat]);

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

  // ── Field search popover ──────────────────────────────────────────────────
  const FieldPicker = (
    <div ref={searchRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="pivot-dim-add"
        onClick={() => { setSearchOpen(o => !o); setFieldSearch(''); }}
        title="Add field to rows or columns"
      >+ Field</button>
      {searchOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 2,
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.12)',
          width: 240,
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              className="input input-sm"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="Search fields…"
              value={fieldSearch}
              onChange={e => setFieldSearch(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filteredColumns.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No fields</div>
            )}
            {filteredColumns.map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', gap: 4 }}>
                <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                <button
                  style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', flexShrink: 0 }}
                  onClick={() => { addDim('rows', c); setFieldSearch(''); }}
                  title="Add to Rows"
                >Row</button>
                <button
                  style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', flexShrink: 0 }}
                  onClick={() => { addDim('cols', c); setFieldSearch(''); }}
                  title="Add to Columns"
                >Col</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ── Dimension Controls ────────────────────────────────────────────────────
  const DimensionControls = (
    <div className="pivot-dim-controls" style={{ flexWrap: 'wrap', gap: 4 }}>
      <div className="pivot-dim-axis" style={{ flexShrink: 0 }}>
        {FieldPicker}
      </div>
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
  const showExpandControls = pivotRows.length > 1 || pivotCols.length > 1;

  return (
    <div className="pivot-container">
      {DimensionControls}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="pivot-table">
          <thead>
            {colHeaderRows.length > 0 ? (
              colHeaderRows.map((cells, lvl) => (
                <tr key={lvl}>
                  {lvl === 0 && (
                    <th className="pivot-corner" rowSpan={colHeaderRows.length} />
                  )}
                  {cells.map((cell, ci) => (
                    <th
                      key={ci}
                      className="pivot-col-header"
                      colSpan={cell.span}
                      rowSpan={cell.rowSpan}
                    >
                      {cell.showToggle && (
                        <button
                          className="pivot-toggle"
                          onClick={() => toggleExpandCol(cell.partialKey)}
                          title={cell.isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {cell.isExpanded ? '▼' : '▶'}
                        </button>
                      )}
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
            {filteredFlatRows.map((row, ri) => {
              const isSubtotal = !row.isLeaf && pivotRows.length > 1;
              return (
                <tr key={ri} className={isSubtotal ? 'pivot-subtotal-row' : ''}>
                  <td
                    className="pivot-row-header"
                    style={{ paddingLeft: 8 + row.depth * 18 }}
                  >
                    {!row.isLeaf ? (
                      <button
                        className="pivot-toggle"
                        onClick={() => toggleExpand(row.rowKey)}
                      >
                        {expanded.has(row.rowKey) ? '▼' : '▶'}
                      </button>
                    ) : (
                      pivotRows.length > 1 && <span style={{ display: 'inline-block', width: 18 }} />
                    )}
                    <span
                      onClick={onCrossFilter && row.isLeaf ? () => onCrossFilter({ field: pivotRows[row.depth], value: row.label }) : undefined}
                      style={onCrossFilter && row.isLeaf ? { cursor: 'pointer' } : undefined}
                    >{row.label}</span>
                  </td>
                  {filteredVisibleColPaths.length > 0 ? (
                    filteredVisibleColPaths.map((cp, ci) => {
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
                  <td className="pivot-cell pivot-total-cell">
                    {(() => {
                      const v = getValue(row.rowKey, TOTAL_KEY);
                      return v != null ? formatValue(v, widget.numberFormat) : '';
                    })()}
                  </td>
                </tr>
              );
            })}

            <tr className="pivot-grand-total-row">
              <td className="pivot-row-header pivot-total-cell">Grand Total</td>
              {filteredVisibleColPaths.length > 0 ? (
                filteredVisibleColPaths.map((cp, ci) => {
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
