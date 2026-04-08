import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { getColumnInfo } from '../../utils/dataUtils';

// ── Relationship detection (associative: shared field names, no cardinality) ──
function detectRelationships(datasets) {
  const rels = [];
  if (datasets.length < 2) return rels;

  const dsInfo = datasets.map(ds => ({
    id: ds.id,
    name: ds.name,
    columns: getColumnInfo(ds.data),
  }));

  for (let i = 0; i < dsInfo.length; i++) {
    for (let j = i + 1; j < dsInfo.length; j++) {
      const a = dsInfo[i];
      const b = dsInfo[j];
      for (const colA of a.columns) {
        for (const colB of b.columns) {
          if (colA.name === colB.name) {
            rels.push({
              from: { datasetId: a.id, column: colA.name },
              to: { datasetId: b.id, column: colB.name },
              fieldName: colA.name,
            });
          }
        }
      }
    }
  }
  return rels;
}

// ── Get related dataset IDs for a given dataset ───────────────────────────────
function getRelatedIds(datasetId, relationships) {
  const related = new Set();
  for (const rel of relationships) {
    if (rel.from.datasetId === datasetId) related.add(rel.to.datasetId);
    if (rel.to.datasetId === datasetId) related.add(rel.from.datasetId);
  }
  return related;
}

// ── Auto-layout: most-connected table in center, others around it ─────────────
function autoLayout(datasets, relationships, width, height) {
  const positions = {};

  if (datasets.length === 1) {
    positions[datasets[0].id] = { x: width / 2 - 120, y: height / 2 - 60 };
    return positions;
  }

  // Find most-connected table for center placement
  const connCount = {};
  datasets.forEach(ds => { connCount[ds.id] = 0; });
  relationships.forEach(r => {
    connCount[r.from.datasetId] = (connCount[r.from.datasetId] || 0) + 1;
    connCount[r.to.datasetId] = (connCount[r.to.datasetId] || 0) + 1;
  });
  const sorted = Object.entries(connCount).sort((a, b) => b[1] - a[1]);
  const centerId = sorted[0]?.[1] > 0 ? sorted[0][0] : null;

  if (centerId) {
    const others = datasets.filter(ds => ds.id !== centerId);
    const cx = width / 2 - 120;
    const cy = height / 2 - 60;
    positions[centerId] = { x: cx, y: cy };
    const radius = Math.min(width, height) * 0.32;
    others.forEach((ds, i) => {
      const angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
      positions[ds.id] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      };
    });
  } else {
    const cols = Math.ceil(Math.sqrt(datasets.length));
    const gapX = 300;
    const gapY = 200;
    const startX = (width - (cols - 1) * gapX) / 2 - 120;
    const startY = 40;
    datasets.forEach((ds, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions[ds.id] = { x: startX + col * gapX, y: startY + row * gapY };
    });
  }
  return positions;
}

// ── Table Card dimensions ─────────────────────────────────────────────────────
const CARD_W = 240;
const HEADER_H = 36;
const ROW_H = 24;

function cardHeight(colCount) {
  return HEADER_H + Math.min(colCount, 15) * ROW_H + 8;
}

// ── Connection lines (SVG paths) ──────────────────────────────────────────────
function RelationshipLine({ rel, positions, datasets, highlighted }) {
  const fromPos = positions[rel.from.datasetId];
  const toPos = positions[rel.to.datasetId];
  if (!fromPos || !toPos) return null;

  const fromDs = datasets.find(d => d.id === rel.from.datasetId);
  const toDs = datasets.find(d => d.id === rel.to.datasetId);
  if (!fromDs || !toDs) return null;

  const fromCols = getColumnInfo(fromDs.data);
  const toCols = getColumnInfo(toDs.data);
  const fromIdx = fromCols.findIndex(c => c.name === rel.from.column);
  const toIdx = toCols.findIndex(c => c.name === rel.to.column);

  const fromY = fromPos.y + HEADER_H + (fromIdx >= 0 ? fromIdx : 0) * ROW_H + ROW_H / 2;
  const toY = toPos.y + HEADER_H + (toIdx >= 0 ? toIdx : 0) * ROW_H + ROW_H / 2;

  let fromX, toX;
  if (fromPos.x + CARD_W < toPos.x) {
    fromX = fromPos.x + CARD_W;
    toX = toPos.x;
  } else if (toPos.x + CARD_W < fromPos.x) {
    fromX = fromPos.x;
    toX = toPos.x + CARD_W;
  } else {
    fromX = fromPos.x + CARD_W / 2 > toPos.x + CARD_W / 2
      ? fromPos.x : fromPos.x + CARD_W;
    toX = fromPos.x + CARD_W / 2 > toPos.x + CARD_W / 2
      ? toPos.x + CARD_W : toPos.x;
  }

  const midX = (fromX + toX) / 2;
  const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
  const labelX = midX;
  const labelY = (fromY + toY) / 2 - 8;

  const lineColor = highlighted ? '#3b82f6' : '#94a3b8';
  const lineOpacity = highlighted ? 0.8 : 0.3;

  return (
    <g>
      <path d={path} fill="none" stroke={lineColor} strokeWidth={highlighted ? 2.5 : 1.5} opacity={lineOpacity} />
      <circle cx={fromX} cy={fromY} r={4} fill={lineColor} opacity={lineOpacity} />
      <circle cx={toX} cy={toY} r={4} fill={lineColor} opacity={lineOpacity} />
      <rect x={labelX - 40} y={labelY - 8} width={80} height={16}
        rx={4} fill="var(--card)" stroke={highlighted ? '#3b82f6' : 'var(--border)'} strokeWidth={1} />
      <text x={labelX} y={labelY + 3} textAnchor="middle"
        fontSize={10} fontWeight={600} fill={highlighted ? '#3b82f6' : 'var(--text-muted)'}>
        {rel.fieldName || rel.from.column}
      </text>
    </g>
  );
}

// ── Draggable Table Card ──────────────────────────────────────────────────────
// role: 'selected' | 'related' | 'default'
function TableCard({ dataset, position, role, onDragStart, onPreview }) {
  const cols = getColumnInfo(dataset.data);
  const displayCols = cols.slice(0, 15);
  const moreCount = cols.length - 15;

  const typeIcon = (type) => {
    switch (type) {
      case 'number': return '#';
      case 'date': return '📅';
      default: return 'Aa';
    }
  };

  // Color scheme based on role
  let headerFill, headerText, strokeColor, strokeWidth, rowCountColor;
  if (role === 'selected') {
    headerFill = '#2563eb';       // dark blue
    headerText = '#fff';
    strokeColor = '#2563eb';
    strokeWidth = 2.5;
    rowCountColor = 'rgba(255,255,255,.7)';
  } else if (role === 'related') {
    headerFill = '#93c5fd';       // light blue
    headerText = '#1e3a5f';
    strokeColor = '#60a5fa';
    strokeWidth = 1.5;
    rowCountColor = '#1e3a5f99';
  } else {
    headerFill = 'var(--bg)';
    headerText = 'var(--text)';
    strokeColor = 'var(--border)';
    strokeWidth = 1;
    rowCountColor = 'var(--text-muted)';
  }

  return (
    <g transform={`translate(${position.x}, ${position.y})`}>
      {/* Card shadow */}
      <rect x={2} y={2} width={CARD_W} height={cardHeight(cols.length)}
        rx={8} fill="rgba(0,0,0,0.08)" />
      {/* Card body */}
      <rect width={CARD_W} height={cardHeight(cols.length)}
        rx={8} fill="var(--card)" stroke={strokeColor}
        strokeWidth={strokeWidth} />
      {/* Header */}
      <rect width={CARD_W} height={HEADER_H} rx={8} fill={headerFill} />
      <rect y={HEADER_H - 8} width={CARD_W} height={8} fill={headerFill} />
      {/* Drag handle + click area */}
      <rect width={CARD_W} height={HEADER_H} rx={8} fill="transparent"
        style={{ cursor: 'grab' }}
        onMouseDown={(e) => {
          // Track click vs drag
          e._dmClickTarget = dataset.id;
          onDragStart(e, dataset.id);
        }} />
      <text x={12} y={HEADER_H / 2 + 1} dominantBaseline="middle"
        fontSize={13} fontWeight={700} fill={headerText}
        style={{ pointerEvents: 'none' }}>
        {dataset.name}
      </text>
      <text x={CARD_W - 30} y={HEADER_H / 2 + 1} dominantBaseline="middle"
        textAnchor="end" fontSize={10} fill={rowCountColor}
        style={{ pointerEvents: 'none' }}>
        {dataset.data.length.toLocaleString()} rows
      </text>
      {/* Preview button */}
      <g className="dm-card-preview-btn" style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onPreview(dataset.id); }}>
        <rect x={CARD_W - 28} y={6} width={22} height={22} rx={4}
          fill="rgba(255,255,255,.15)" />
        <text x={CARD_W - 17} y={HEADER_H / 2 + 1} dominantBaseline="middle"
          textAnchor="middle" fontSize={13} fill={headerText}
          style={{ pointerEvents: 'none' }}>
          ⊞
        </text>
      </g>

      {/* Column rows */}
      {displayCols.map((col, i) => (
        <g key={col.name} transform={`translate(0, ${HEADER_H + i * ROW_H})`}>
          {i % 2 === 0 && (
            <rect x={1} width={CARD_W - 2} height={ROW_H} fill="rgba(0,0,0,.015)" />
          )}
          <text x={12} y={ROW_H / 2 + 1} dominantBaseline="middle"
            fontSize={10} fill="var(--text-muted)" fontFamily="monospace">
            {typeIcon(col.type)}
          </text>
          <text x={30} y={ROW_H / 2 + 1} dominantBaseline="middle"
            fontSize={11.5} fill="var(--text)">
            {col.name.length > 25 ? col.name.slice(0, 24) + '…' : col.name}
          </text>
          <text x={CARD_W - 12} y={ROW_H / 2 + 1} dominantBaseline="middle"
            textAnchor="end" fontSize={10} fill="var(--text-light)">
            {col.type}
          </text>
        </g>
      ))}
      {moreCount > 0 && (
        <text x={CARD_W / 2} y={HEADER_H + displayCols.length * ROW_H + 4}
          dominantBaseline="hanging" textAnchor="middle"
          fontSize={10} fill="var(--text-muted)" fontStyle="italic">
          +{moreCount} more columns
        </text>
      )}
    </g>
  );
}

// ── Data Preview Popup (centered overlay) ────────────────────────────────────
function TablePreviewPopup({ dataset, onClose }) {
  const rows = dataset.data.slice(0, 10);
  const cols = Object.keys(rows[0] || {});
  if (cols.length === 0) return null;

  return (
    <div className="dm-preview-overlay" onClick={onClose}>
      <div className="dm-preview-popup" onClick={e => e.stopPropagation()}>
        <div className="dm-preview-header">
          <span>{dataset.name} — first {rows.length} rows</span>
          <button className="btn btn-icon dm-preview-close" onClick={onClose}>&times;</button>
        </div>
        <div className="dm-preview-table-wrap">
          <table className="dm-preview-table">
            <thead>
              <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map(c => (
                    <td key={c}>{row[c] == null ? '' : String(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dm-preview-footer">
          {dataset.data.length.toLocaleString()} total rows · {cols.length} columns
        </div>
      </div>
    </div>
  );
}

// ── Main DataModel component ──────────────────────────────────────────────────
export default function DataModel({ positions: extPositions, onPositionsChange }) {
  const { state, dispatch } = useApp();
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [intPositions, setIntPositions] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [previewId, setPreviewId] = useState(null);

  const positions = extPositions ?? intPositions;
  const setPositions = useCallback((val) => {
    const next = typeof val === 'function' ? val(extPositions ?? intPositions) : val;
    if (onPositionsChange) onPositionsChange(next);
    else setIntPositions(next);
  }, [extPositions, intPositions, onPositionsChange]);

  const datasets = state.datasets;
  const selectedId = state.activeDatasetId;
  const relationships = useMemo(() => detectRelationships(datasets), [datasets]);
  const relatedIds = useMemo(
    () => selectedId ? getRelatedIds(selectedId, relationships) : new Set(),
    [selectedId, relationships]
  );

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-layout only when no positions exist yet, or when datasets change
  const datasetIdsKey = datasets.map(d => d.id).sort().join(',');
  useEffect(() => {
    if (datasets.length === 0) return;
    if (extPositions && Object.keys(extPositions).length > 0) {
      const missing = datasets.some(d => !extPositions[d.id]);
      if (!missing) return;
    }
    const layout = autoLayout(datasets, relationships, size.w, size.h);
    if (onPositionsChange) onPositionsChange(layout);
    else setIntPositions(layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetIdsKey, size.w, size.h]);

  // ── Drag handlers (with click detection) ────────────────────────────────
  const dragStartRef = useRef(null);

  const handleDragStart = useCallback((e, dsId) => {
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, id: dsId };
    setDragState({
      id: dsId,
      startX: e.clientX,
      startY: e.clientY,
      origPos: positions?.[dsId] || { x: 0, y: 0 },
    });
  }, [positions]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      setPositions(prev => ({
        ...prev,
        [dragState.id]: {
          x: dragState.origPos.x + dx,
          y: dragState.origPos.y + dy,
        },
      }));
    };
    const onUp = (e) => {
      // Detect click (no significant movement)
      if (dragStartRef.current) {
        const dx = Math.abs(e.clientX - dragStartRef.current.x);
        const dy = Math.abs(e.clientY - dragStartRef.current.y);
        if (dx < 4 && dy < 4) {
          // This was a click — select the dataset
          dispatch({ type: 'SET_ACTIVE_DATASET', payload: dragStartRef.current.id });
        }
        dragStartRef.current = null;
      }
      setDragState(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragState, dispatch, setPositions]);

  if (datasets.length === 0) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">🔗</div>
        <h3>No datasets loaded</h3>
        <p>Load CSV files to see the data model and relationships.</p>
      </div>
    );
  }

  // Compute SVG viewBox to encompass all cards
  const allPos = positions ? Object.values(positions) : [];
  const minX = allPos.length ? Math.min(...allPos.map(p => p.x)) - 40 : 0;
  const minY = allPos.length ? Math.min(...allPos.map(p => p.y)) - 40 : 0;
  const maxX = allPos.length ? Math.max(...allPos.map(p => p.x + CARD_W)) + 40 : size.w;
  const maxY = allPos.length ? Math.max(...allPos.map(p => p.y + cardHeight(15))) + 40 : size.h;
  const vbW = Math.max(maxX - minX, size.w);
  const vbH = Math.max(maxY - minY, size.h);

  return (
    <div ref={containerRef} className="dm-container">
      {/* Legend bar */}
      <div className="dm-legend">
        <span className="dm-legend-item">
          <span className="dm-legend-dot" style={{ background: '#2563eb' }} />
          Selected
        </span>
        <span className="dm-legend-item">
          <span className="dm-legend-dot" style={{ background: '#93c5fd' }} />
          Related
        </span>
        <span className="dm-legend-item">
          <span className="dm-legend-dot" style={{ background: 'var(--border-strong)' }} />
          Other
        </span>
        <span className="dm-legend-sep">|</span>
        <span className="dm-legend-item">
          {relationships.length} shared field{relationships.length !== 1 ? 's' : ''}
        </span>
      </div>

      <svg width="100%" height="100%" viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
        style={{ flex: 1 }}>
        {/* Grid dots pattern */}
        <defs>
          <pattern id="dm-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="var(--border)" opacity="0.4" />
          </pattern>
        </defs>
        <rect x={minX} y={minY} width={vbW} height={vbH} fill="url(#dm-grid)" />

        {/* Relationship lines (render behind cards) */}
        {positions && relationships.map((rel, i) => {
          const highlighted = selectedId &&
            (rel.from.datasetId === selectedId || rel.to.datasetId === selectedId);
          return (
            <RelationshipLine key={i} rel={rel} positions={positions}
              datasets={datasets} highlighted={highlighted} />
          );
        })}

        {/* Table cards */}
        {positions && datasets.map(ds => {
          let role = 'default';
          if (ds.id === selectedId) role = 'selected';
          else if (relatedIds.has(ds.id)) role = 'related';
          return (
            <TableCard
              key={ds.id}
              dataset={ds}
              position={positions[ds.id] || { x: 0, y: 0 }}
              role={role}
              onDragStart={handleDragStart}
              onPreview={(id) => setPreviewId(prev => prev === id ? null : id)}
            />
          );
        })}
      </svg>

      {/* Data preview popup */}
      {previewId && (() => {
        const ds = datasets.find(d => d.id === previewId);
        if (!ds) return null;
        return (
          <TablePreviewPopup
            dataset={ds}
            onClose={() => setPreviewId(null)}
          />
        );
      })()}
    </div>
  );
}
