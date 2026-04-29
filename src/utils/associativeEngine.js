// ─── Associative Data Engine ──────────────────────────────────────────────────
//
// Implements an associative data model where fields with the same name across
// tables are treated as the same field. Selections propagate through shared
// fields via BFS until convergence.
//
// Three value states:
//   - Selected: explicitly chosen by the user
//   - Possible: reachable through associations from selected values
//   - Excluded: not reachable
//
// Tables with no connection to any selected field keep ALL rows as possible.
// ─────────────────────────────────────────────────────────────────────────────

import { materializeRows } from './columnStore';

// ── getAllFields ─────────────────────────────────────────────────────────────
// Returns deduplicated [{ name, type }] across all tables in the colStore.

export function getAllFields(colStore) {
  const fields = [];
  const seen = new Set();
  if (!colStore?.tables) return fields;
  for (const table of Object.values(colStore.tables)) {
    if (!table?.columns) continue;
    for (const [name, col] of Object.entries(table.columns)) {
      if (seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, type: col.kind === 'number' ? 'number' : 'string' });
    }
  }
  return fields;
}

// ── getFieldsByTable ────────────────────────────────────────────────────────
// Returns [{ tableName, tableId, fields: [{ name, type }] }] with fields
// sorted alphabetically inside each table. A field shared across tables
// appears in every table group (it's still one field internally).

export function getFieldsByTable(colStore) {
  if (!colStore?.tables) return [];
  const groups = [];
  for (const [tableId, table] of Object.entries(colStore.tables)) {
    if (!table?.columns) continue;
    const fields = Object.entries(table.columns)
      .map(([name, col]) => ({ name, type: col.kind === 'number' ? 'number' : 'string' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ tableName: table.name || tableId, tableId, fields });
  }
  return groups;
}

// ── buildFieldMap ───────────────────────────────────────────────────────────
// Returns { fieldToTables, tableToFields } mappings.

export function buildFieldMap(colStore) {
  const fieldToTables = new Map();  // fieldName → Set<tableId>
  const tableToFields = new Map();  // tableId → Set<fieldName>
  if (!colStore?.tables) return { fieldToTables, tableToFields };

  for (const [tableId, table] of Object.entries(colStore.tables)) {
    if (!table?.columns) continue;
    const fields = new Set();
    for (const colName of Object.keys(table.columns)) {
      fields.add(colName);
      if (!fieldToTables.has(colName)) fieldToTables.set(colName, new Set());
      fieldToTables.get(colName).add(tableId);
    }
    tableToFields.set(tableId, fields);
  }
  return { fieldToTables, tableToFields };
}

// ── computeAssociativeState ─────────────────────────────────────────────────
// Given selections { fieldName: string[] }, computes:
//   possibleRows: { tableId: Uint8Array }  (1=possible, 0=excluded per row)
//   fieldStates:  { fieldName: { selected: Set, possible: Set, excluded: Set } }

export function computeAssociativeState(colStore, selections) {
  const empty = { possibleRows: {}, fieldStates: {} };
  if (!colStore?.tables || !colStore?.dicts) return empty;
  if (!selections || Object.keys(selections).length === 0) {
    // No selections → all rows possible, all values possible
    const possibleRows = {};
    for (const [id, table] of Object.entries(colStore.tables)) {
      const mask = new Uint8Array(table.length);
      mask.fill(1);
      possibleRows[id] = mask;
    }
    const fieldStates = {};
    for (const [name, dict] of Object.entries(colStore.dicts)) {
      fieldStates[name] = { selected: new Set(), possible: new Set(dict), excluded: new Set() };
    }
    // Also include numeric fields
    for (const table of Object.values(colStore.tables)) {
      for (const [name, col] of Object.entries(table.columns)) {
        if (col.kind === 'number' && !fieldStates[name]) {
          fieldStates[name] = { selected: new Set(), possible: new Set(), excluded: new Set() };
        }
      }
    }
    return { possibleRows, fieldStates };
  }

  const { fieldToTables, tableToFields } = buildFieldMap(colStore);
  const tables = colStore.tables;
  const dicts = colStore.dicts;

  // Convert selections to Sets of string values for each field
  const selSets = {};
  for (const [field, values] of Object.entries(selections)) {
    if (values && values.length > 0) {
      selSets[field] = new Set(values.map(String));
    }
  }

  // Find all tables reachable from any selected field via shared-field graph (BFS)
  const reachableTables = new Set();
  const visited = new Set();
  const queue = [];
  for (const field of Object.keys(selSets)) {
    const ft = fieldToTables.get(field);
    if (ft) for (const tid of ft) {
      if (!visited.has(tid)) { visited.add(tid); queue.push(tid); }
    }
  }
  while (queue.length > 0) {
    const tid = queue.shift();
    reachableTables.add(tid);
    const fields = tableToFields.get(tid);
    if (!fields) continue;
    for (const f of fields) {
      const linkedTables = fieldToTables.get(f);
      if (!linkedTables) continue;
      for (const linked of linkedTables) {
        if (!visited.has(linked)) { visited.add(linked); queue.push(linked); }
      }
    }
  }

  // BFS fixed-point: propagate constraints through shared fields
  // constrainedValues[fieldName] = Set of allowed values for that field
  const constrainedValues = {};
  for (const [field, set] of Object.entries(selSets)) {
    constrainedValues[field] = new Set(set);
  }

  let changed = true;
  let iterations = 0;
  const MAX_ITER = 10;

  while (changed && iterations < MAX_ITER) {
    changed = false;
    iterations++;

    for (const [tableId, table] of Object.entries(tables)) {
      if (!reachableTables.has(tableId)) continue;
      const tableFields = tableToFields.get(tableId);
      if (!tableFields) continue;

      // Check which constrained fields this table has
      const constrainedInTable = [];
      for (const f of tableFields) {
        if (constrainedValues[f]) constrainedInTable.push(f);
      }
      if (constrainedInTable.length === 0) continue;

      // Find rows that pass ALL constraints for this table
      const n = table.length;
      const passingRows = new Uint8Array(n);
      passingRows.fill(1);

      for (const f of constrainedInTable) {
        const col = table.columns[f];
        if (!col) continue;
        const allowed = constrainedValues[f];

        if (col.kind === 'string') {
          const dict = dicts[col.dictKey] || [];
          // Build allowed index set for fast lookup
          const allowedIdx = new Set();
          for (let di = 0; di < dict.length; di++) {
            if (allowed.has(dict[di])) allowedIdx.add(di);
          }
          for (let i = 0; i < n; i++) {
            if (passingRows[i] && !allowedIdx.has(col.buf[i])) passingRows[i] = 0;
          }
        } else {
          // Number column — convert allowed set values to numbers
          const allowedNums = new Set();
          for (const v of allowed) allowedNums.add(+v);
          for (let i = 0; i < n; i++) {
            if (passingRows[i] && !allowedNums.has(col.buf[i])) passingRows[i] = 0;
          }
        }
      }

      // Collect possible values from passing rows for all fields in this table
      for (const f of tableFields) {
        if (selSets[f]) continue; // Don't overwrite user selections
        const col = table.columns[f];
        if (!col) continue;

        const newPossible = new Set();
        if (col.kind === 'string') {
          const dict = dicts[col.dictKey] || [];
          for (let i = 0; i < n; i++) {
            if (passingRows[i]) newPossible.add(dict[col.buf[i]]);
          }
        } else {
          for (let i = 0; i < n; i++) {
            if (passingRows[i]) newPossible.add(String(col.buf[i]));
          }
        }

        if (!constrainedValues[f]) {
          // First time this field is constrained
          constrainedValues[f] = newPossible;
          if (newPossible.size > 0) changed = true;
        } else {
          // Intersect with existing constraints
          const prev = constrainedValues[f];
          const intersected = new Set();
          for (const v of newPossible) {
            if (prev.has(v)) intersected.add(v);
          }
          if (intersected.size < prev.size) {
            constrainedValues[f] = intersected;
            changed = true;
          }
        }
      }
    }
  }

  // Build possibleRows masks
  const possibleRows = {};
  for (const [tableId, table] of Object.entries(tables)) {
    const n = table.length;
    const mask = new Uint8Array(n);

    if (!reachableTables.has(tableId)) {
      // Unrelated table → all rows possible
      mask.fill(1);
    } else {
      const tableFields = tableToFields.get(tableId);
      mask.fill(1);

      if (tableFields) {
        for (const f of tableFields) {
          const allowed = constrainedValues[f];
          if (!allowed || allowed.size === 0) continue;
          const col = table.columns[f];
          if (!col) continue;

          if (col.kind === 'string') {
            const dict = dicts[col.dictKey] || [];
            const allowedIdx = new Set();
            for (let di = 0; di < dict.length; di++) {
              if (allowed.has(dict[di])) allowedIdx.add(di);
            }
            for (let i = 0; i < n; i++) {
              if (mask[i] && !allowedIdx.has(col.buf[i])) mask[i] = 0;
            }
          } else {
            const allowedNums = new Set();
            for (const v of allowed) allowedNums.add(+v);
            for (let i = 0; i < n; i++) {
              if (mask[i] && !allowedNums.has(col.buf[i])) mask[i] = 0;
            }
          }
        }
      }
    }
    possibleRows[tableId] = mask;
  }

  // Build fieldStates
  const fieldStates = {};
  for (const [name, dict] of Object.entries(dicts)) {
    const selected = selSets[name] || new Set();
    const possible = constrainedValues[name] || new Set(dict);
    const excluded = new Set();
    for (const v of dict) {
      if (!selected.has(v) && !possible.has(v)) excluded.add(v);
    }
    // Remove selected from possible (they're in their own category)
    for (const v of selected) possible.delete(v);
    fieldStates[name] = { selected, possible, excluded };
  }

  return { possibleRows, fieldStates };
}

// ── Bridge table discovery ──────────────────────────────────────────────────
// Given a set of selected tables, find the shortest join path that connects
// them all, adding bridge tables as needed. Uses BFS on the table adjacency
// graph (two tables are adjacent if they share at least one field name).
//
// Example: Categories(CategoryName,CategoryID) → Products(CategoryID,ProductID)
//          → Order_Details(ProductID,Quantity)
// Widget needs CategoryName + Quantity → selects Categories & Order_Details,
// but they share no field. This function discovers Products as a bridge.

function findJoinPath(selectedTables, fieldToTables, tableToFields, colStore) {
  if (selectedTables.length <= 1) return selectedTables;

  // Build adjacency: tableId → Set<tableId> (connected if they share a field)
  const allTableIds = Object.keys(colStore.tables);
  const adj = new Map();
  for (const tid of allTableIds) adj.set(tid, new Set());

  for (const [, tables] of fieldToTables) {
    const arr = [...tables];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        adj.get(arr[i]).add(arr[j]);
        adj.get(arr[j]).add(arr[i]);
      }
    }
  }

  // BFS from the first selected table to each other selected table,
  // collecting all intermediate (bridge) tables needed
  const needed = new Set(selectedTables);
  const start = selectedTables[0];

  for (let i = 1; i < selectedTables.length; i++) {
    const target = selectedTables[i];
    // BFS shortest path from start to target
    const visited = new Map(); // tableId → parent
    visited.set(start, null);
    const queue = [start];
    let found = false;

    while (queue.length > 0 && !found) {
      const cur = queue.shift();
      for (const neighbor of (adj.get(cur) || [])) {
        if (visited.has(neighbor)) continue;
        visited.set(neighbor, cur);
        if (neighbor === target) { found = true; break; }
        queue.push(neighbor);
      }
    }

    if (found) {
      // Trace back path and add bridge tables
      let node = target;
      while (node !== null) {
        needed.add(node);
        node = visited.get(node);
      }
    }
  }

  // Order: start with tables that have the most connections to others in the set
  // so joins have shared fields at each step
  const orderedSet = new Set();
  const remaining = new Set(needed);

  // Start with the first selected table
  orderedSet.add(start);
  remaining.delete(start);

  while (remaining.size > 0) {
    // Find the remaining table with the most shared fields with already-joined tables
    let bestTid = null;
    let bestShared = -1;

    for (const tid of remaining) {
      const tFields = tableToFields.get(tid) || new Set();
      let shared = 0;
      for (const joinedTid of orderedSet) {
        const jFields = tableToFields.get(joinedTid) || new Set();
        for (const f of tFields) {
          if (jFields.has(f)) { shared++; break; }
        }
      }
      if (shared > bestShared) { bestShared = shared; bestTid = tid; }
    }

    if (bestTid === null) break;
    orderedSet.add(bestTid);
    remaining.delete(bestTid);
  }

  return [...orderedSet];
}

// ── resolveWidgetData ───────────────────────────────────────────────────────
// Given a widget's field references, returns filtered row-oriented data.

const WIDGET_FIELD_KEYS = [
  'xField', 'yField', 'colorField', 'groupField', 'sizeField',
  'labelField', 'valueField', 'axisField', 'sourceField', 'targetField',
  'geoField', 'y2Field',
];

function collectWidgetFields(widget) {
  const fields = new Set();
  for (const key of WIDGET_FIELD_KEYS) {
    const v = widget[key];
    if (v && typeof v === 'string' && !v.startsWith('__hier__') && !v.startsWith('__cyclic__')) {
      fields.add(v);
    }
  }
  // Pivot rows/cols
  if (widget.pivotRows) for (const f of widget.pivotRows) if (f) fields.add(f);
  if (widget.pivotCols) for (const f of widget.pivotCols) if (f) fields.add(f);
  // Sankey multi-level fields
  if (widget.sankeyFields) for (const f of widget.sankeyFields) if (f) fields.add(f);
  // Straight table dimensions (array of field name strings)
  if (widget.straightTableDimensions) {
    for (const f of widget.straightTableDimensions) if (f) fields.add(f);
  }
  // Straight table measures
  if (widget.straightTableMeasures) {
    for (const m of widget.straightTableMeasures) if (m?.field) fields.add(m.field);
  }
  // Multi-measure arrays (bar, line)
  for (const key of ['barChartMeasures', 'lineChartMeasures']) {
    if (widget[key]) for (const m of widget[key]) if (m?.field) fields.add(m.field);
  }
  // Overlay field arrays (scatter mini charts, geo overlays, point layers)
  for (const key of ['scatterOverlayFields', 'overlayFields', 'pointOverlayFields', 'correlogramFields']) {
    if (widget[key]) for (const f of widget[key]) if (f) fields.add(f);
  }
  // DataTable visible columns — these determine which table(s) to resolve from
  if (Array.isArray(widget.visibleColumns)) {
    for (const f of widget.visibleColumns) if (f) fields.add(f);
  }
  // MeasurePipeline step input fields — these are the actual table columns the
  // pipeline needs as input. Without these, resolveWidgetData can't find the
  // right tables when xField/yField reference pipeline *output* columns.
  if (widget.measures?.length > 0) {
    for (const step of widget.measures) {
      if (step.type === 'groupBy') {
        if (step.fields) for (const f of step.fields) if (f) fields.add(f);
        if (step.aggregations) for (const a of step.aggregations) if (a?.field) fields.add(a.field);
      } else if (step.type === 'topN') {
        if (step.orderBy) fields.add(step.orderBy);
        if (step.groupBy) for (const f of step.groupBy) if (f) fields.add(f);
      } else if (step.type === 'filter') {
        if (step.field) fields.add(step.field);
      } else if (step.type === 'sort') {
        if (step.field) fields.add(step.field);
      }
      // compute/formula reference fields via expressions — too complex to parse,
      // but the fields they reference should already be captured from earlier steps
    }
  }
  return fields;
}

export function resolveWidgetData(widget, datasets, colStore, associativeState) {
  if (!colStore?.tables || !datasets?.length) return [];

  // Content widgets don't need data resolution
  if (['text', 'image', 'embed'].includes(widget.type)) return [];

  const requestedFields = collectWidgetFields(widget);

  // For table/straighttable with visibleColumns=null, we want all columns from the resolved table
  const isAllColumns = ['table', 'straighttable', 'pivot'].includes(widget.type) &&
    requestedFields.size === 0 && !widget.visibleColumns;

  if (requestedFields.size === 0 && !isAllColumns) {
    // No fields configured — check if widget has a datasetId hint (backward compat)
    if (widget.datasetId) {
      const ds = datasets.find(d => d.id === widget.datasetId);
      if (ds) return filterByMask(ds.data, associativeState?.possibleRows?.[ds.id]);
    }
    return [];
  }

  const { fieldToTables, tableToFields } = buildFieldMap(colStore);

  // Find candidate tables: tables that contain at least one requested field
  const tableScores = new Map(); // tableId → number of matching fields
  for (const field of requestedFields) {
    const tables = fieldToTables.get(field);
    if (tables) {
      for (const tid of tables) {
        tableScores.set(tid, (tableScores.get(tid) || 0) + 1);
      }
    }
  }

  // For all-columns mode, prefer the datasetId hint or first dataset
  if (isAllColumns && tableScores.size === 0) {
    if (widget.datasetId && colStore.tables[widget.datasetId]) {
      tableScores.set(widget.datasetId, 1);
    } else {
      // Use the first dataset
      const firstId = datasets[0]?.id;
      if (firstId && colStore.tables[firstId]) tableScores.set(firstId, 1);
    }
  }

  if (tableScores.size === 0) return [];

  // Sort tables by score (most matching fields first)
  const ranked = [...tableScores.entries()].sort((a, b) => b[1] - a[1]);

  // Check if the best table covers all *known* fields (fields that exist in some table).
  // Pipeline output columns (like 'sum_Quantity') don't exist in any table — skip them.
  const bestTableId = ranked[0][0];
  const bestTable = colStore.tables[bestTableId];
  const bestTableFields = new Set(Object.keys(bestTable.columns));
  const knownFields = [...requestedFields].filter(f => fieldToTables.has(f));
  const allCovered = knownFields.length > 0 && knownFields.every(f => bestTableFields.has(f));

  if (allCovered || isAllColumns) {
    // Single-table case: materialize and filter
    const rows = materializeRows(bestTable, colStore.dicts);
    return filterByMask(rows, associativeState?.possibleRows?.[bestTableId]);
  }

  // Multi-table case: find tables that together cover all known fields
  // Use a greedy approach: pick tables with most uncovered fields
  const coveredFields = new Set();
  const selectedTables = [];

  for (const [tid] of ranked) {
    const table = colStore.tables[tid];
    if (!table) continue;
    const tableFields = new Set(Object.keys(table.columns));
    let addsNew = false;
    for (const f of knownFields) {
      if (!coveredFields.has(f) && tableFields.has(f)) addsNew = true;
    }
    if (addsNew) {
      selectedTables.push(tid);
      for (const f of tableFields) coveredFields.add(f);
      if (knownFields.every(f => coveredFields.has(f))) break;
    }
  }

  if (selectedTables.length <= 1) {
    // Still single table (or no tables found for missing fields)
    const tid = selectedTables[0] || bestTableId;
    const rows = materializeRows(colStore.tables[tid], colStore.dicts);
    return filterByMask(rows, associativeState?.possibleRows?.[tid]);
  }

  // Add bridge tables: find intermediate tables needed to connect selected tables
  const joinOrder = findJoinPath(selectedTables, fieldToTables, tableToFields, colStore);

  // Full join through shared fields
  return joinTables(joinOrder, colStore, associativeState);
}

// ── Filter rows by possibleRows mask ────────────────────────────────────────

function filterByMask(rows, mask) {
  if (!mask) return rows;
  return rows.filter((_, i) => mask[i]);
}

// ── Multi-table full outer join ─────────────────────────────────────────────

function joinTables(tableIds, colStore, associativeState) {
  if (tableIds.length === 0) return [];

  const dicts = colStore.dicts;

  // Start with the first table's rows (filtered)
  let result = materializeRows(colStore.tables[tableIds[0]], dicts);
  if (associativeState?.possibleRows?.[tableIds[0]]) {
    result = filterByMask(result, associativeState.possibleRows[tableIds[0]]);
  }

  // Full-outer-join each subsequent table
  for (let t = 1; t < tableIds.length; t++) {
    const tableId = tableIds[t];
    const table = colStore.tables[tableId];
    if (!table) continue;

    // Find shared fields between result and this table
    const resultFields = new Set(result.length > 0 ? Object.keys(result[0]) : []);
    const tableFields = new Set(Object.keys(table.columns));
    const sharedFields = [];
    for (const f of resultFields) {
      if (tableFields.has(f)) sharedFields.push(f);
    }

    if (sharedFields.length === 0) {
      // No shared fields — skip this table (don't cartesian-join)
      continue;
    }

    // New fields that this table adds
    const newFields = [];
    for (const f of tableFields) {
      if (!resultFields.has(f)) newFields.push(f);
    }

    // Fields only in the left result (not in this table)
    const leftOnlyFields = [];
    for (const f of resultFields) {
      if (!tableFields.has(f)) leftOnlyFields.push(f);
    }

    let rightRows = materializeRows(table, dicts);
    if (associativeState?.possibleRows?.[tableId]) {
      rightRows = filterByMask(rightRows, associativeState.possibleRows[tableId]);
    }

    // If right table is empty after filtering, keep left rows with null for new fields
    if (rightRows.length === 0) {
      result = result.map(row => {
        const out = { ...row };
        for (const f of newFields) out[f] = null;
        return out;
      });
      continue;
    }

    // Build hash index on right table
    const rightIndex = new Map();
    for (const row of rightRows) {
      const key = sharedFields.map(f => String(row[f] ?? '')).join('\0');
      if (!rightIndex.has(key)) rightIndex.set(key, []);
      rightIndex.get(key).push(row);
    }

    // Track which right keys were matched (for full outer join)
    const matchedRightKeys = new Set();

    // Full outer join
    const joined = [];
    for (const leftRow of result) {
      const key = sharedFields.map(f => String(leftRow[f] ?? '')).join('\0');
      const matches = rightIndex.get(key);
      if (matches) {
        matchedRightKeys.add(key);
        for (const rightRow of matches) {
          const merged = { ...leftRow };
          for (const f of newFields) merged[f] = rightRow[f];
          joined.push(merged);
        }
      } else {
        // No match on right — keep left row, fill new fields with null
        const preserved = { ...leftRow };
        for (const f of newFields) preserved[f] = null;
        joined.push(preserved);
      }
    }

    // Add unmatched right rows (fill left-only fields with null)
    for (const [key, rows] of rightIndex) {
      if (matchedRightKeys.has(key)) continue;
      for (const rightRow of rows) {
        const newRow = {};
        for (const f of leftOnlyFields) newRow[f] = null;
        for (const f of sharedFields) newRow[f] = rightRow[f];
        for (const f of newFields) newRow[f] = rightRow[f];
        joined.push(newRow);
      }
    }

    result = joined;
  }

  return result;
}
