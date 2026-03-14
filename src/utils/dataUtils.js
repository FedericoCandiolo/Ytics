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
    switch (t.type) {
      case 'filter':   result = applyFilter(result, t);   break;
      case 'rename':   result = applyRename(result, t);   break;
      case 'compute':  result = applyCompute(result, t);  break;
      case 'sort':     result = applySort(result, t);     break;
      case 'select':   result = applySelect(result, t);   break;
      default: break;
    }
  }
  return result;
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
        const num = Number(value);
        if (isNaN(num)) return true;
        return num >= f.range[0] && num <= f.range[1];
      }
      return true;
    })
  );
}

export function aggregateData(data, groupField, valueField, aggregation) {
  if (!data || !groupField || !valueField) return [];
  const groups = new Map();
  for (const row of data) {
    const key = String(row[groupField] ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(+row[valueField] || 0);
  }
  return Array.from(groups.entries()).map(([key, vals]) => ({
    key,
    value: aggregate(vals, aggregation),
  }));
}

export function aggregate(vals, fn) {
  if (!vals.length) return 0;
  switch (fn) {
    case 'count': return vals.length;
    case 'mean':  return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min':   return Math.min(...vals);
    case 'max':   return Math.max(...vals);
    default:      return vals.reduce((a, b) => a + b, 0);
  }
}

export function formatValue(v) {
  if (typeof v !== 'number') return v;
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

export const COLOR_SCHEMES = {
  tableau10: 'Tableau 10',
  category10: 'Category 10',
  set2: 'Set 2',
  set3: 'Set 3',
  pastel1: 'Pastel',
  dark2: 'Dark',
  paired: 'Paired',
  accent: 'Accent',
};

export const AGGREGATIONS = {
  sum: 'Sum',
  count: 'Count',
  mean: 'Average',
  min: 'Min',
  max: 'Max',
};
