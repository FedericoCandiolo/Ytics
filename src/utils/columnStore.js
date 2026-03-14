// ─── In-memory Columnar Store ─────────────────────────────────────────────────
//
// Columns are stored as typed arrays (Float64Array for numbers, Int32Array of
// dictionary indices for strings). String dictionaries are shared across all
// tables that have a column with the same name — so "USA" is stored once even
// if it appears in ten datasets.
//
// Relationship model:
//   colStore.dicts[colName] — the canonical value list for that dimension.
//   table.columns[colName] = { kind:'string', dictKey, buf:Int32Array }
//                            | { kind:'number', buf:Float64Array }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deep-clone the dicts registry so the reducer never mutates existing state.
 * @param {{ [name]: string[] }} dicts
 */
export function cloneDicts(dicts) {
  const out = {};
  for (const k in dicts) out[k] = [...dicts[k]];
  return out;
}

/**
 * Build a columnar table from an array of row objects.
 *
 * String columns are dictionary-encoded. If `sharedDicts[colName]` already
 * exists (from a previously loaded table), the same dictionary is reused and
 * extended with any new values — this is how cross-table dimension sharing works.
 *
 * @param {string}   id          - dataset id
 * @param {string}   name        - dataset name
 * @param {Object[]} rows        - source row objects (post-transform)
 * @param {{ [colName]: string[] }} sharedDicts - mutable registry (extended in-place)
 * @returns {{ id, name, length, schema, columns }}
 */
export function buildTable(id, name, rows, sharedDicts) {
  if (!rows.length) return { id, name, length: 0, schema: {}, columns: {} };

  const colNames = Object.keys(rows[0]);
  const n = rows.length;
  const schema = {};
  const columns = {};

  for (const col of colNames) {
    // Type detection: sample up to 200 rows, require all non-null values to be numeric
    let numCount = 0, strCount = 0;
    for (let i = 0; i < Math.min(n, 200); i++) {
      const v = rows[i][col];
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number' || (!isNaN(+v) && String(v).trim() !== '')) numCount++;
      else strCount++;
    }
    const isNum = numCount > 0 && strCount === 0;

    if (isNum) {
      schema[col] = { type: 'number' };
      const buf = new Float64Array(n);
      for (let i = 0; i < n; i++) buf[i] = +rows[i][col] || 0;
      columns[col] = { kind: 'number', buf };
    } else {
      schema[col] = { type: 'string' };
      // Shared dict: reuse or create
      if (!sharedDicts[col]) sharedDicts[col] = [];
      const dict = sharedDicts[col];
      const valIdx = new Map(dict.map((v, i) => [v, i]));
      const buf = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const v = String(rows[i][col] ?? '');
        if (!valIdx.has(v)) { valIdx.set(v, dict.length); dict.push(v); }
        buf[i] = valIdx.get(v);
      }
      columns[col] = { kind: 'string', dictKey: col, buf };
    }
  }

  return { id, name, length: n, schema, columns };
}

/**
 * Decode all values for a single column into a plain JS array.
 * Numbers return as numbers; strings are resolved through the shared dict.
 */
export function getColumnValues(table, colName, dicts) {
  const col = table?.columns?.[colName];
  if (!col) return [];
  if (col.kind === 'number') return Array.from(col.buf);
  const dict = dicts[col.dictKey] || [];
  return Array.from(col.buf, i => dict[i]);
}

/**
 * Return the raw Float64Array for a numeric column (no copy — fast path).
 */
export function getNumericBuf(table, colName) {
  const col = table?.columns?.[colName];
  return col?.kind === 'number' ? col.buf : null;
}

/**
 * Reconstruct an array of row objects from a columnar table.
 * This is the bridge between the column store and chart components,
 * which continue to consume row-oriented data.
 *
 * @param {string[]} [colNames] - subset of columns; defaults to all
 */
export function materializeRows(table, dicts, colNames) {
  if (!table || table.length === 0) return [];
  const cols = colNames || Object.keys(table.columns);
  const decoded = {};
  for (const c of cols) {
    const col = table.columns[c];
    if (!col) continue;
    if (col.kind === 'number') {
      decoded[c] = col.buf;
    } else {
      const dict = dicts[col.dictKey] || [];
      decoded[c] = col.buf.map(i => dict[i]);
    }
  }
  const valid = cols.filter(c => decoded[c]);
  return Array.from({ length: table.length }, (_, i) =>
    Object.fromEntries(valid.map(c => [c, decoded[c][i]]))
  );
}

/**
 * Return column metadata for WidgetEditor field selectors.
 * Each entry: { name, type: 'number'|'string' }
 */
export function getTableSchema(table) {
  if (!table?.schema) return [];
  return Object.entries(table.schema).map(([name, { type }]) => ({ name, type }));
}

/**
 * Aggregate a numeric column directly from the typed buffer — no row
 * materialisation required. ~10× faster than the row-based path for large data.
 *
 * @param {Float64Array} buf
 * @param {string}       fn  - aggregation key
 * @param {Int32Array}   [groupBuf]  - if provided, only include rows where groupBuf[i] === groupIdx
 * @param {number}       [groupIdx]
 */
export function aggregateBuf(buf, fn, groupBuf, groupIdx) {
  const vals = groupBuf !== undefined
    ? (() => {
        const out = [];
        for (let i = 0; i < buf.length; i++)
          if (groupBuf[i] === groupIdx) out.push(buf[i]);
        return out;
      })()
    : Array.from(buf);
  return _agg(vals, fn);
}

/**
 * Group-by + aggregate directly on typed buffers.
 * Returns Map<groupValue, aggregatedNumber>.
 *
 * @param {string} groupColName - the categorical column to group on
 * @param {string} valueColName - the numeric column to aggregate
 * @param {string} fn           - aggregation key
 */
export function groupAggregateBuf(table, dicts, groupColName, valueColName, fn) {
  const gCol = table.columns[groupColName];
  const vCol = table.columns[valueColName];
  if (!gCol || !vCol || vCol.kind !== 'number') return new Map();

  const dict = gCol.kind === 'string' ? (dicts[gCol.dictKey] || []) : null;
  const n = table.length;
  const groups = new Map();

  for (let i = 0; i < n; i++) {
    const gKey = dict ? dict[gCol.buf[i]] : gCol.buf[i];
    if (!groups.has(gKey)) groups.set(gKey, []);
    groups.get(gKey).push(vCol.buf[i]);
  }

  const result = new Map();
  groups.forEach((vals, key) => result.set(key, _agg(vals, fn)));
  return result;
}

// ── Internal aggregation kernel ───────────────────────────────────────────────
function _agg(vals, fn) {
  if (!vals.length) return 0;
  switch (fn) {
    case 'count':  return vals.length;
    case 'mean':   return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min':    return Math.min(...vals);
    case 'max':    return Math.max(...vals);
    case 'median': return _quantile([...vals].sort((a, b) => a - b), 0.5);
    case 'std': {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(vals.length - 1, 1));
    }
    case 'p25': return _quantile([...vals].sort((a, b) => a - b), 0.25);
    case 'p75': return _quantile([...vals].sort((a, b) => a - b), 0.75);
    case 'p90': return _quantile([...vals].sort((a, b) => a - b), 0.90);
    case 'p95': return _quantile([...vals].sort((a, b) => a - b), 0.95);
    default:     return vals.reduce((a, b) => a + b, 0); // sum
  }
}

function _quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Serialisation (for .ytics export / localStorage) ─────────────────────────

/** Convert TypedArrays → plain arrays so JSON.stringify works. */
export function serializeColStore(colStore) {
  const tables = {};
  for (const [id, t] of Object.entries(colStore.tables)) {
    const columns = {};
    for (const [k, col] of Object.entries(t.columns)) {
      columns[k] = col.kind === 'number'
        ? { kind: 'number', buf: Array.from(col.buf) }
        : { kind: 'string', dictKey: col.dictKey, buf: Array.from(col.buf) };
    }
    tables[id] = { ...t, columns };
  }
  return { dicts: colStore.dicts, tables };
}

/** Restore TypedArrays from a deserialised colStore. */
export function deserializeColStore(raw) {
  const tables = {};
  for (const [id, t] of Object.entries(raw.tables)) {
    const columns = {};
    for (const [k, col] of Object.entries(t.columns)) {
      columns[k] = col.kind === 'number'
        ? { kind: 'number', buf: new Float64Array(col.buf) }
        : { kind: 'string', dictKey: col.dictKey, buf: new Int32Array(col.buf) };
    }
    tables[id] = { ...t, columns };
  }
  return { dicts: raw.dicts, tables };
}
