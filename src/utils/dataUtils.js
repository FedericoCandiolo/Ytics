// ─── Data Utilities ───────────────────────────────────────────────────────────

// ── CSV parsing (no external dependency) ─────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

export function readCSVFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (e) => {
      try {
        let text = e.target.result;
        // Strip BOM if present
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return resolve({ data: [], columns: [] });
        const headers = parseCSVLine(lines[0]);
        const data = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = parseCSVLine(lines[i]);
          const row = {};
          headers.forEach((h, j) => {
            const v = vals[j] ?? '';
            row[h] = v !== '' && !isNaN(v) && v.trim() !== '' ? Number(v) : v;
          });
          data.push(row);
        }
        resolve({ data, columns: headers });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsText(file);
  });
}

export function detectColumnTypes(data) {
  if (!data || data.length === 0) return {};
  const columns = Object.keys(data[0]);
  const types = {};
  for (const col of columns) {
    const values = data.map(d => d[col]).filter(v => v !== null && v !== undefined && v !== '');
    if (values.length === 0) { types[col] = 'string'; continue; }
    if (values.every(v => typeof v === 'number' && !isNaN(v))) {
      types[col] = 'number';
    } else if (values.every(v => !isNaN(Date.parse(String(v))))) {
      types[col] = 'date';
    } else {
      types[col] = 'string';
    }
  }
  return types;
}

export function getColumnInfo(data) {
  if (!data || data.length === 0) return [];
  const types = detectColumnTypes(data);
  return Object.keys(types).map(name => ({ name, type: types[name] }));
}

export function applyTransforms(data, transforms) {
  let result = [...data];
  for (const t of transforms) {
    if (t.disabled) continue;
    result = applyOneTransform(result, t);
  }
  return result;
}

/**
 * Apply transforms up to (and including) the given index.
 * Respects the `disabled` flag. Returns intermediate data.
 */
export function applyTransformsUpTo(data, transforms, upToIndex) {
  let result = [...data];
  for (let i = 0; i <= upToIndex && i < transforms.length; i++) {
    if (transforms[i].disabled) continue;
    result = applyOneTransform(result, transforms[i]);
  }
  return result;
}

function applyOneTransform(data, t) {
  switch (t.type) {
    case 'filter':   return applyFilter(data, t);
    case 'rename':   return applyRename(data, t);
    case 'compute':  return applyCompute(data, t);
    case 'sort':     return applySort(data, t);
    case 'select':   return applySelect(data, t);
    case 'cast':     return applyCast(data, t);
    default:         return data;
  }
}

function applyFilter(data, { field, operator, value }) {
  return data.filter(row => {
    const v = row[field];
    const num = parseFloat(value);
    const val = !isNaN(num) ? num : value;
    switch (operator) {
      // eslint-disable-next-line eqeqeq
      case '=':           return v == val;
      // eslint-disable-next-line eqeqeq
      case '!=':          return v != val;
      case '>':           return Number(v) > Number(val);
      case '<':           return Number(v) < Number(val);
      case '>=':          return Number(v) >= Number(val);
      case '<=':          return Number(v) <= Number(val);
      case 'contains':    return String(v).toLowerCase().includes(String(val).toLowerCase());
      case 'not contains':return !String(v).toLowerCase().includes(String(val).toLowerCase());
      case 'is null':     return v === null || v === undefined || v === '';
      case 'is not null': return v !== null && v !== undefined && v !== '';
      default: return true;
    }
  });
}

function applyRename(data, { oldName, newName }) {
  if (!oldName || !newName || oldName === newName) return data;
  return data.map(row => {
    const r = { ...row };
    r[newName] = r[oldName];
    delete r[oldName];
    return r;
  });
}

function applyCompute(data, { newColumn, expression }) {
  if (!newColumn || !expression) return data;
  return data.map(row => {
    try {
      const keys = Object.keys(row);
      const vals = keys.map(k => row[k]);
      // eslint-disable-next-line no-new-func
      const fn = new Function(...keys, `return (${expression})`);
      return { ...row, [newColumn]: fn(...vals) };
    } catch {
      return { ...row, [newColumn]: null };
    }
  });
}

function applySort(data, { field, direction }) {
  return [...data].sort((a, b) => {
    const va = a[field], vb = b[field];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number')
      return direction === 'asc' ? va - vb : vb - va;
    return direction === 'asc'
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

function applySelect(data, { columns, mode }) {
  return data.map(row => {
    if (mode === 'keep') {
      const r = {};
      for (const c of columns) if (c in row) r[c] = row[c];
      return r;
    } else {
      const r = { ...row };
      for (const c of columns) delete r[c];
      return r;
    }
  });
}

function applyCast(data, { field, targetType }) {
  return data.map(row => {
    const v = row[field];
    let converted;
    switch (targetType) {
      case 'number': {
        if (v === null || v === undefined || v === '') { converted = null; break; }
        const n = Number(String(v).replace(/[,%$€£]/g, ''));
        converted = isNaN(n) ? null : n;
        break;
      }
      case 'string':
        converted = v === null || v === undefined ? '' : String(v);
        break;
      case 'date': {
        if (v === null || v === undefined || v === '') { converted = null; break; }
        const d = new Date(v);
        converted = isNaN(d.getTime()) ? String(v) : d.toISOString().split('T')[0];
        break;
      }
      case 'boolean': {
        if (v === null || v === undefined || v === '') { converted = null; break; }
        const s = String(v).toLowerCase().trim();
        converted = ['true', '1', 'yes', 'y', 'on'].includes(s);
        break;
      }
      default: converted = v;
    }
    return { ...row, [field]: converted };
  });
}

/**
 * Join two datasets on shared columns.
 * @param {object[]} leftData
 * @param {object[]} rightData
 * @param {string} leftField - join key in left dataset
 * @param {string} rightField - join key in right dataset
 * @param {'inner'|'left'|'right'|'full'} joinType
 * @param {string} [rightPrefix] - prefix for right-side columns on name collision
 * @returns {object[]}
 */
export function joinDatasets(leftData, rightData, leftField, rightField, joinType = 'inner', rightPrefix = '') {
  // Build right-side index (group by join key)
  const rightIndex = new Map();
  for (const row of rightData) {
    const key = String(row[rightField] ?? '');
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key).push(row);
  }

  // Determine right columns (excluding the join key to avoid duplication)
  const rightCols = rightData.length > 0
    ? Object.keys(rightData[0]).filter(c => c !== rightField)
    : [];

  // Resolve column name conflicts with prefix
  const prefix = rightPrefix || '';
  const rightColMap = {};
  const leftCols = leftData.length > 0 ? new Set(Object.keys(leftData[0])) : new Set();
  for (const c of rightCols) {
    rightColMap[c] = leftCols.has(c) ? `${prefix || 'right_'}${c}` : c;
  }

  function mergeRow(leftRow, rightRow) {
    const out = { ...leftRow };
    if (rightRow) {
      for (const c of rightCols) {
        out[rightColMap[c]] = rightRow[c];
      }
    } else {
      for (const c of rightCols) {
        out[rightColMap[c]] = null;
      }
    }
    return out;
  }

  const result = [];
  const matchedRightKeys = new Set();

  for (const leftRow of leftData) {
    const key = String(leftRow[leftField] ?? '');
    const matches = rightIndex.get(key);

    if (matches && matches.length > 0) {
      matchedRightKeys.add(key);
      for (const rightRow of matches) {
        result.push(mergeRow(leftRow, rightRow));
      }
    } else if (joinType === 'left' || joinType === 'full') {
      result.push(mergeRow(leftRow, null));
    }
    // inner: skip unmatched lefts
  }

  // For right/full join: add unmatched right rows
  if (joinType === 'right' || joinType === 'full') {
    const leftColKeys = leftData.length > 0 ? Object.keys(leftData[0]) : [];
    for (const rightRow of rightData) {
      const key = String(rightRow[rightField] ?? '');
      if (!matchedRightKeys.has(key)) {
        const out = {};
        for (const c of leftColKeys) out[c] = c === leftField ? rightRow[rightField] : null;
        for (const c of rightCols) out[rightColMap[c]] = rightRow[c];
        result.push(out);
      }
    }
  }

  return result;
}

export function applyFilters(data, filters) {
  if (!filters || Object.keys(filters).length === 0) return data;
  return data.filter(row =>
    Object.values(filters).every(f => {
      if (!f.active) return true;
      const value = row[f.field];
      if (f.filterType === 'categorical') {
        if (!f.values || f.values.length === 0) return true;
        return f.values.includes(String(value));
      }
      if (f.filterType === 'range') {
        if (!f.range) return true;
        const num = Number(value);
        if (isNaN(num)) return true;
        return num >= f.range[0] && num <= f.range[1];
      }
      return true;
    })
  );
}

export function aggregateData(data, groupField, valueField, aggregation, opts = {}) {
  if (!data || !groupField || !valueField) return [];
  const groups = new Map();
  for (const row of data) {
    const key = String(row[groupField] ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(+row[valueField] || 0);
  }
  const allVals = opts.total ? data.map(r => +r[valueField] || 0) : null;
  return Array.from(groups.entries()).map(([key, vals]) => ({
    key,
    value: aggregate(opts.total ? allVals : vals, aggregation, undefined, opts),
  }));
}

// Build grouped value arrays from data. When total=true, every group shares all values.
export function buildGroups(data, keyField, valueField, opts = {}) {
  const groups = new Map();
  for (const row of data) {
    const key = String(row[keyField] ?? '(blank)');
    const val = +row[valueField] || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(val);
  }
  if (opts.total) {
    const allVals = data.map(r => +r[valueField] || 0);
    for (const key of groups.keys()) groups.set(key, allVals);
  }
  return groups;
}

export function aggregate(vals, fn, rawVals, opts = {}) {
  if (!vals.length) return 0;
  // Apply distinct modifier: deduplicate values before aggregating
  if (opts.distinct) {
    vals = [...new Set(vals)];
    if (rawVals) rawVals = [...new Set(rawVals)];
  }
  // Handle parameterized aggregations: "fractile:0.33", "concat:,", "moment:3", etc.
  if (fn && fn.includes(':')) {
    const [base, param] = fn.split(':', 2);
    return _paramAggregate(vals, base, param, rawVals);
  }
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
    case 'variance': {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      return vals.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(vals.length - 1, 1);
    }
    case 'p25': return _quantile([...vals].sort((a, b) => a - b), 0.25);
    case 'p75': return _quantile([...vals].sort((a, b) => a - b), 0.75);
    case 'p90': return _quantile([...vals].sort((a, b) => a - b), 0.90);
    case 'p95': return _quantile([...vals].sort((a, b) => a - b), 0.95);
    // ── Advanced ──
    case 'geomean': {
      const pos = vals.filter(v => v > 0);
      if (!pos.length) return 0;
      const logSum = pos.reduce((s, v) => s + Math.log(v), 0);
      return Math.exp(logSum / pos.length);
    }
    case 'harmean': {
      const pos = vals.filter(v => v > 0);
      if (!pos.length) return 0;
      return pos.length / pos.reduce((s, v) => s + 1 / v, 0);
    }
    case 'only': {
      const unique = new Set(vals);
      return unique.size === 1 ? vals[0] : null;
    }
    case 'concat': {
      const src = rawVals || vals;
      return src.map(String).join(', ');
    }
    case 'skewness': {
      const n = vals.length;
      if (n < 3) return 0;
      const m = vals.reduce((a, b) => a + b, 0) / n;
      const s = Math.sqrt(vals.reduce((s2, v) => s2 + (v - m) ** 2, 0) / (n - 1));
      if (s === 0) return 0;
      return (n / ((n - 1) * (n - 2))) * vals.reduce((s3, v) => s3 + ((v - m) / s) ** 3, 0);
    }
    case 'kurtosis': {
      const n = vals.length;
      if (n < 4) return 0;
      const m = vals.reduce((a, b) => a + b, 0) / n;
      const s2 = vals.reduce((s, v) => s + (v - m) ** 2, 0) / n;
      if (s2 === 0) return 0;
      const m4 = vals.reduce((s, v) => s + (v - m) ** 4, 0) / n;
      return (m4 / (s2 * s2)) - 3; // excess kurtosis
    }
    default:     return vals.reduce((a, b) => a + b, 0); // sum
  }
}

function _paramAggregate(vals, base, param, rawVals) {
  switch (base) {
    case 'fractile': {
      const p = parseFloat(param);
      if (isNaN(p)) return 0;
      return _quantile([...vals].sort((a, b) => a - b), Math.max(0, Math.min(1, p)));
    }
    case 'concat': {
      const src = rawVals || vals;
      return src.map(String).join(param);
    }
    case 'moment': {
      const order = parseInt(param, 10);
      if (isNaN(order) || order < 1) return 0;
      const n = vals.length;
      const m = vals.reduce((a, b) => a + b, 0) / n;
      return vals.reduce((s, v) => s + (v - m) ** order, 0) / n;
    }
    case 'cmoment': {
      // Centered moment = same as moment (already centered around mean)
      const order = parseInt(param, 10);
      if (isNaN(order) || order < 1) return 0;
      const n = vals.length;
      const m = vals.reduce((a, b) => a + b, 0) / n;
      return vals.reduce((s, v) => s + (v - m) ** order, 0) / n;
    }
    case 'rmoment': {
      // Reduced (standardized) moment: centered moment / std^order
      const order = parseInt(param, 10);
      if (isNaN(order) || order < 1) return 0;
      const n = vals.length;
      const m = vals.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / n);
      if (std === 0) return 0;
      const cm = vals.reduce((s, v) => s + (v - m) ** order, 0) / n;
      return cm / (std ** order);
    }
    case 'lmoment': {
      // Local (raw) moment: E[X^k] (not centered)
      const order = parseInt(param, 10);
      if (isNaN(order) || order < 1) return 0;
      return vals.reduce((s, v) => s + v ** order, 0) / vals.length;
    }
    default:
      return vals.reduce((a, b) => a + b, 0);
  }
}

function _quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Number format registry ─────────────────────────────────────────────────────
export const NUMBER_FORMATS = {
  auto:       'Auto (K / M / B)',
  number:     'Number (1,234,567)',
  si:         'SI metric (k / M / G / T)',
  scientific: 'Scientific (1.23e+6)',
  currency:   'Currency ($1,234.56)',
  percent:    'Percent (85.0%)',
};

export function formatValue(v, format) {
  if (typeof v !== 'number' || isNaN(v)) return v == null ? '' : String(v);
  if (!format || format === 'auto') {
    // Default: abbreviated K/M/B
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }
  switch (format) {
    case 'number':
      return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'si': {
      const abs = Math.abs(v);
      if (abs >= 1e15) return (v / 1e15).toFixed(2) + 'P';
      if (abs >= 1e12) return (v / 1e12).toFixed(2) + 'T';
      if (abs >= 1e9)  return (v / 1e9).toFixed(2) + 'G';
      if (abs >= 1e6)  return (v / 1e6).toFixed(2) + 'M';
      if (abs >= 1e3)  return (v / 1e3).toFixed(2) + 'k';
      return v % 1 === 0 ? String(v) : v.toFixed(2);
    }
    case 'scientific':
      return v.toExponential(2);
    case 'currency':
      return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    case 'percent':
      return (v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
    default:
      return v % 1 === 0 ? String(v) : v.toFixed(2);
  }
}

// Descriptive, non-commercial color palette names
export const COLOR_SCHEMES = {
  vivid:     'Vivid',          // bold, high-contrast categorical (was tableau10)
  spectrum:  'Spectrum',       // full spectral categorical      (was category10)
  muted:     'Muted',          // subdued 8-color set            (was set2)
  soft:      'Soft',           // light 12-color set             (was set3)
  pastel:    'Pastel',         // desaturated gentle tones
  contrast:  'Contrast',       // dark high-contrast set         (was dark2)
  duo:       'Duo-tone',       // two-hue sequential pairs       (was paired)
  bold:      'Bold Accent',    // saturated accent palette
  // Sequential single-hue
  blues:     'Blues',
  greens:    'Greens',
  reds:      'Reds',
  purples:   'Purples',
  oranges:   'Oranges',
  // Diverging
  warmCool:  'Warm–Cool',      // red-blue diverging (was RdYlBu)
  brownGreen:'Brown–Green',    // BrBG diverging
};

// Maps scheme key → d3 color array (used in editor swatches)
export const SCHEME_D3_MAP = {
  vivid:      'schemeTableau10',
  spectrum:   'schemeCategory10',
  muted:      'schemeSet2',
  soft:       'schemeSet3',
  pastel:     'schemePastel1',
  contrast:   'schemeDark2',
  duo:        'schemePaired',
  bold:       'schemeAccent',
  blues:      'schemeBlues[9]',
  greens:     'schemeGreens[9]',
  reds:       'schemeReds[9]',
  purples:    'schemePurples[9]',
  oranges:    'schemeOranges[9]',
  warmCool:   'schemeRdYlBu[9]',
  brownGreen: 'schemeBrBG[9]',
};

export const AGGREGATIONS_BASIC = {
  sum:    'Sum',
  count:  'Count',
  mean:   'Average',
  min:    'Min',
  max:    'Max',
  median: 'Median',
  std:    'Std Dev',
  p25:    '25th pct',
  p75:    '75th pct',
  p90:    '90th pct',
  p95:    '95th pct',
};

export const AGGREGATIONS_ADVANCED = {
  variance: 'Variance',
  geomean:  'Geometric mean',
  harmean:  'Harmonic mean',
  only:     'Only',
  concat:   'Concat',
  skewness: 'Skewness',
  kurtosis: 'Kurtosis',
};

// Parameterized aggregations (shown as separate UI controls)
export const AGGREGATIONS_PARAM = {
  fractile: { label: 'Fractile', paramLabel: 'p', paramType: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
  concat:   { label: 'Concat', paramLabel: 'delimiter', paramType: 'text', default: ', ' },
  moment:   { label: 'Moment (centered)', paramLabel: 'order', paramType: 'number', min: 1, max: 10, step: 1, default: 2 },
  rmoment:  { label: 'Moment (standardized)', paramLabel: 'order', paramType: 'number', min: 1, max: 10, step: 1, default: 3 },
  lmoment:  { label: 'Moment (raw)', paramLabel: 'order', paramType: 'number', min: 1, max: 10, step: 1, default: 1 },
};

// Combined for backward compat — used where no basic/advanced split is needed
export const AGGREGATIONS = { ...AGGREGATIONS_BASIC, ...AGGREGATIONS_ADVANCED };

// ── Measure Pipeline ────────────────────────────────────────────────────────────
// Per-widget multi-step aggregation pipeline.
// When `widget.measures` is non-empty, data is processed through these steps
// BEFORE reaching the chart component.

export function executeMeasurePipeline(data, steps) {
  if (!steps || steps.length === 0) return data;
  let result = [...data];
  for (const step of steps) {
    switch (step.type) {
      case 'groupBy':  result = executeGroupBy(result, step);  break;
      case 'topN':     result = executeTopN(result, step);     break;
      case 'filter':   result = applyFilter(result, step);     break;
      case 'compute':  result = applyCompute(result, step);    break;
      case 'formula':  result = applyCompute(result, step);    break; // same as compute — expression over row columns
      case 'sort':     result = applySort(result, step);       break;
      default: break;
    }
  }
  return result;
}

function executeGroupBy(data, step) {
  if (!step.fields?.length || !step.aggregations?.length) return data;
  const groups = new Map();
  for (const row of data) {
    const key = step.fields.map(f => String(row[f] ?? '')).join('|||');
    if (!groups.has(key)) groups.set(key, { keyParts: step.fields.map(f => row[f]), rows: [] });
    groups.get(key).rows.push(row);
  }
  // Pre-compute total (all-data) values for aggregations that use the total modifier
  const totalCache = {};
  for (const agg of step.aggregations) {
    if (agg.total) {
      const baseFn = agg.fn?.split(':')[0] || agg.fn;
      const isText = baseFn === 'concat' || baseFn === 'only' || baseFn === 'count';
      totalCache[agg.as || `${agg.fn}_${agg.field}`] = {
        vals: baseFn === 'count' ? data.map(() => 1) : data.map(r => isText ? r[agg.field] : (+r[agg.field] || 0)),
        rawVals: isText ? data.map(r => r[agg.field]) : undefined,
      };
    }
  }
  return Array.from(groups.values()).map(({ keyParts, rows }) => {
    const result = {};
    step.fields.forEach((f, i) => { result[f] = keyParts[i]; });
    for (const agg of step.aggregations) {
      const baseFn = agg.fn?.split(':')[0] || agg.fn;
      const isText = baseFn === 'concat' || baseFn === 'only' || baseFn === 'count';
      const outputKey = agg.as || `${agg.fn}_${agg.field}`;
      let vals, rawVals;
      if (agg.total && totalCache[outputKey]) {
        vals = totalCache[outputKey].vals;
        rawVals = totalCache[outputKey].rawVals;
      } else {
        vals = baseFn === 'count'
          ? rows.map(() => 1)
          : rows.map(r => isText ? r[agg.field] : (+r[agg.field] || 0));
        rawVals = isText ? rows.map(r => r[agg.field]) : undefined;
      }
      result[outputKey] = aggregate(vals, agg.fn, rawVals, { distinct: agg.distinct });
    }
    return result;
  });
}

function executeTopN(data, step) {
  const n = step.n || 1;
  const dir = step.direction || 'desc';
  const cmp = (a, b) => dir === 'desc'
    ? (+b[step.orderBy] || 0) - (+a[step.orderBy] || 0)
    : (+a[step.orderBy] || 0) - (+b[step.orderBy] || 0);

  if (!step.groupBy?.length) {
    return [...data].sort(cmp).slice(0, n);
  }
  const groups = new Map();
  for (const row of data) {
    const key = step.groupBy.map(f => String(row[f] ?? '')).join('|||');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = [];
  groups.forEach(rows => {
    rows.sort(cmp);
    result.push(...rows.slice(0, n));
  });
  return result;
}

// Returns the output column names after running a pipeline (for field selectors)
export function getPipelineOutputColumns(data, steps) {
  if (!data?.length) return [];
  const output = executeMeasurePipeline(data.slice(0, 100), steps);
  if (!output.length) return [];
  return Object.keys(output[0]);
}

// Returns column types of pipeline output
export function getPipelineOutputTypes(data, steps) {
  if (!data?.length) return {};
  const output = executeMeasurePipeline(data.slice(0, 100), steps);
  return detectColumnTypes(output);
}

// ── Sorting & Grouping Utilities ─────────────────────────────────────────────

export function sortAggregated(pts, options = {}) {
  const { sortBy = 'original', sortOrder = 'asc', customOrder = null } = options;
  if (sortBy === 'original') return [...pts];
  const sorted = [...pts];
  const dir = sortOrder === 'desc' ? -1 : 1;
  switch (sortBy) {
    case 'value':
      sorted.sort((a, b) => dir * (a.value - b.value));
      break;
    case 'label':
      sorted.sort((a, b) => dir * String(a.key).localeCompare(String(b.key)));
      break;
    case 'custom': {
      if (!customOrder) return sorted;
      const orderMap = new Map(customOrder.map((k, i) => [k, i]));
      sorted.sort((a, b) => {
        const ia = orderMap.has(a.key) ? orderMap.get(a.key) : Infinity;
        const ib = orderMap.has(b.key) ? orderMap.get(b.key) : Infinity;
        return dir * (ia - ib);
      });
      break;
    }
    default:
      break;
  }
  return sorted;
}

export function applyParetoGrouping(pts, options = {}) {
  const { method = 'topN', topN = 10, threshold = 0.8, othersLabel = 'Others' } = options;
  if (!pts || pts.length === 0) return [];

  let splitIndex = pts.length; // default: keep everything

  switch (method) {
    case 'topN':
      splitIndex = Math.min(topN, pts.length);
      break;

    case 'threshold': {
      const total = pts.reduce((s, p) => s + p.value, 0);
      if (total === 0) return [...pts];
      let cumulative = 0;
      for (let i = 0; i < pts.length; i++) {
        cumulative += pts[i].value;
        if (cumulative / total >= threshold) {
          splitIndex = i + 1;
          break;
        }
      }
      break;
    }

    case 'pareto': {
      const total = pts.reduce((s, p) => s + p.value, 0);
      if (total === 0) return [...pts];
      const n = pts.length;
      // Walk through items sorted desc by value. Items where
      // (cumulative count proportion + cumulative value proportion) > 1
      // are grouped as Others. The first item crossing that threshold
      // marks the split point.
      let cumulativeValue = 0;
      splitIndex = n; // default: keep all
      for (let i = 0; i < n; i++) {
        cumulativeValue += pts[i].value;
        const countProportion = (i + 1) / n;
        const valueProportion = cumulativeValue / total;
        if (countProportion + valueProportion > 1) {
          splitIndex = Math.max(1, i); // keep at least 1 item
          break;
        }
      }
      break;
    }

    default:
      break;
  }

  if (splitIndex >= pts.length) return [...pts];

  const kept = pts.slice(0, splitIndex);
  const tail = pts.slice(splitIndex);
  const othersValue = tail.reduce((s, p) => s + p.value, 0);
  const othersCount = tail.reduce((s, p) => s + (p.count || 0), 0);
  return [...kept, { key: othersLabel, value: othersValue, count: othersCount }];
}

// ── Linear Regression ────────────────────────────────────────────────────────

export function linearRegression(points) {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // Coefficient of determination (R²)
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (slope * x + intercept)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

// ── Polynomial Regression (degree N) ─────────────────────────────────────────
// Solves via normal equations with Gaussian elimination.
// Returns { coeffs: [a0, a1, ..., aN], r2 }  where y = a0 + a1*x + a2*x² + ...
export function polynomialRegression(points, degree = 2) {
  const n = points.length;
  if (n <= degree) return null;

  const d = degree + 1;
  // Build Vandermonde-style normal equations: (X^T X) a = X^T y
  const M = Array.from({ length: d }, () => new Array(d + 1).fill(0));

  // Precompute sums of x^k and x^k * y
  const xPow = new Array(2 * degree + 1).fill(0);
  const xyPow = new Array(d).fill(0);
  for (const { x, y } of points) {
    let xk = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      xPow[k] += xk;
      if (k < d) xyPow[k] += xk * y;
      xk *= x;
    }
  }

  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) M[i][j] = xPow[i + j];
    M[i][d] = xyPow[i];
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < d; col++) {
    let maxRow = col;
    for (let row = col + 1; row < d; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let row = col + 1; row < d; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= d; j++) M[row][j] -= f * M[col][j];
    }
  }

  // Back substitution
  const coeffs = new Array(d).fill(0);
  for (let i = d - 1; i >= 0; i--) {
    coeffs[i] = M[i][d];
    for (let j = i + 1; j < d; j++) coeffs[i] -= M[i][j] * coeffs[j];
    coeffs[i] /= M[i][i];
  }

  // R²
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    let yHat = 0, xk = 1;
    for (let k = 0; k < d; k++) { yHat += coeffs[k] * xk; xk *= x; }
    ssTot += (y - meanY) ** 2;
    ssRes += (y - yHat) ** 2;
  }

  return { coeffs, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

// Evaluate polynomial: coeffs = [a0, a1, ..., aN]
export function polyEval(coeffs, x) {
  let y = 0, xk = 1;
  for (const c of coeffs) { y += c * xk; xk *= x; }
  return y;
}

// ── Logarithmic Regression ───────────────────────────────────────────────────
// y = a + b * ln(x).  Only uses points with x > 0.
export function logarithmicRegression(points) {
  const valid = points.filter(p => p.x > 0);
  if (valid.length < 2) return null;
  const transformed = valid.map(p => ({ x: Math.log(p.x), y: p.y }));
  const lr = linearRegression(transformed);
  if (!lr) return null;

  // R² against original data
  const n = valid.length;
  const meanY = valid.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of valid) {
    const yHat = lr.intercept + lr.slope * Math.log(x);
    ssTot += (y - meanY) ** 2;
    ssRes += (y - yHat) ** 2;
  }

  return { a: lr.intercept, b: lr.slope, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

// ── Exponential Regression ───────────────────────────────────────────────────
// y = a * e^(b*x).  Only uses points with y > 0.
export function exponentialRegression(points) {
  const valid = points.filter(p => p.y > 0);
  if (valid.length < 2) return null;
  const transformed = valid.map(p => ({ x: p.x, y: Math.log(p.y) }));
  const lr = linearRegression(transformed);
  if (!lr) return null;

  const a = Math.exp(lr.intercept);
  const b = lr.slope;

  // R² against original data
  const n = valid.length;
  const meanY = valid.reduce((s, p) => s + p.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of valid) {
    const yHat = a * Math.exp(b * x);
    ssTot += (y - meanY) ** 2;
    ssRes += (y - yHat) ** 2;
  }

  return { a, b, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}
