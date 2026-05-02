// ── Tool Executor ────────────────────────────────────────────────────────────
// Executes AI tool calls against app state/dispatch. Returns result objects.

import { searchHelp } from './helpDocs';

function findDataset(state, datasetId) {
  if (datasetId) return state.datasets.find(d => d.id === datasetId);
  return state.datasets[0];
}

function applyCondition(val, cond) {
  const { op, value } = cond;
  const v = val == null ? '' : val;
  switch (op) {
    case 'eq': return v === value;
    case 'gt': return Number(v) > Number(value);
    case 'lt': return Number(v) < Number(value);
    case 'gte': return Number(v) >= Number(value);
    case 'lte': return Number(v) <= Number(value);
    case 'contains': return String(v).toLowerCase().includes(String(value).toLowerCase());
    case 'in': return Array.isArray(value) ? value.includes(v) : v === value;
    default: return true;
  }
}

function groupAndAggregate(rows, groupBy, aggregations) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row[groupBy] ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()].map(([key, groupRows]) => {
    const result = { [groupBy]: key };
    for (const [field, agg] of Object.entries(aggregations)) {
      const vals = groupRows.map(r => Number(r[field])).filter(n => !isNaN(n));
      switch (agg) {
        case 'sum': result[field] = vals.reduce((a, b) => a + b, 0); break;
        case 'avg': result[field] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; break;
        case 'count': result[field] = groupRows.length; break;
        case 'min': result[field] = vals.length ? Math.min(...vals) : null; break;
        case 'max': result[field] = vals.length ? Math.max(...vals) : null; break;
        default: result[field] = vals.length ? vals.reduce((a, b) => a + b, 0) : 0;
      }
    }
    return result;
  });
}

function describeField(data, field, type) {
  const vals = data.map(r => r[field]).filter(v => v != null);
  if (type === 'number') {
    const nums = vals.map(Number).filter(n => !isNaN(n));
    if (nums.length === 0) return { type: 'number', count: 0 };
    nums.sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const median = nums.length % 2 === 0
      ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
      : nums[Math.floor(nums.length / 2)];
    const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
    return {
      type: 'number', count: nums.length,
      min: nums[0], max: nums[nums.length - 1],
      mean: Math.round(mean * 100) / 100,
      median: Math.round(median * 100) / 100,
      std: Math.round(Math.sqrt(variance) * 100) / 100,
    };
  }
  // Categorical
  const freq = {};
  for (const v of vals) { const s = String(v); freq[s] = (freq[s] || 0) + 1; }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return {
    type: type || 'string', count: vals.length,
    unique: sorted.length,
    topValues: sorted.slice(0, 5).map(([v, c]) => ({ value: v, count: c })),
  };
}

export function executeTool(toolCall, dispatch, state) {
  const { name, args } = toolCall;

  switch (name) {
    case 'add_widget': {
      const payload = { type: args.type, title: args.title || `${args.type} Chart` };
      for (const key of ['xField', 'yField', 'valueField', 'labelField', 'colorField', 'sourceField', 'targetField', 'aggregation']) {
        if (args[key]) payload[key] = args[key];
      }
      if (args.datasetId) payload.datasetId = args.datasetId;
      else if (state.datasets.length > 0) payload.datasetId = state.datasets[0].id;
      dispatch({ type: 'ADD_WIDGET', payload });
      return { success: true, message: `Added ${args.type} chart "${payload.title}"` };
    }

    case 'update_widget': {
      dispatch({ type: 'UPDATE_WIDGET', payload: { id: args.widgetId, updates: args.updates } });
      return { success: true, message: `Updated widget ${args.widgetId}` };
    }

    case 'remove_widget': {
      dispatch({ type: 'REMOVE_WIDGET', payload: args.widgetId });
      return { success: true, message: `Removed widget ${args.widgetId}` };
    }

    case 'set_dashboard_title': {
      dispatch({ type: 'SET_DASHBOARD_TITLE', payload: args.title });
      return { success: true, message: `Title set to "${args.title}"` };
    }

    case 'suggest_charts': {
      const ds = findDataset(state, args.datasetId);
      if (!ds) return { error: 'No dataset found' };
      return {
        datasetName: ds.name,
        columns: Object.entries(ds.columnTypes).map(([n, t]) => ({ name: n, type: t })),
        rowCount: ds.data.length,
        message: 'Analyze these columns and suggest chart configurations. Then use add_widget to create them if the user agrees.',
      };
    }

    case 'query_data': {
      const ds = findDataset(state, args.datasetId);
      if (!ds) return { error: 'Dataset not found' };
      let rows = [...ds.data];
      // Apply filters
      if (args.filter) {
        for (const [field, cond] of Object.entries(args.filter)) {
          rows = rows.filter(row => applyCondition(row[field], cond));
        }
      }
      // Group + aggregate
      if (args.groupBy && args.aggregation) {
        rows = groupAndAggregate(rows, args.groupBy, args.aggregation);
      }
      // Sort
      if (args.sortBy) {
        const dir = args.sortOrder === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const va = a[args.sortBy], vb = b[args.sortBy];
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
        });
      }
      const totalMatched = rows.length;
      rows = rows.slice(0, args.limit || 20);
      // Select fields
      if (args.fields) {
        const fields = new Set(args.fields);
        rows = rows.map(r => {
          const out = {};
          for (const f of fields) if (f in r) out[f] = r[f];
          return out;
        });
      }
      return { rows, totalMatched };
    }

    case 'describe_data': {
      const ds = findDataset(state, args.datasetId);
      if (!ds) return { error: 'Dataset not found' };
      const fields = args.fields || Object.keys(ds.columnTypes);
      const summary = {};
      for (const f of fields) {
        if (ds.columnTypes[f]) {
          summary[f] = describeField(ds.data, f, ds.columnTypes[f]);
        }
      }
      return summary;
    }

    case 'set_selection': {
      dispatch({ type: 'SET_SELECTION', payload: { field: args.field, values: args.values } });
      return { success: true, message: `Selection set on ${args.field}: ${args.values.length ? args.values.join(', ') : 'all'}` };
    }

    case 'lookup_help': {
      const results = searchHelp(args.query);
      if (results.length === 0) return { message: 'No matching help sections found.' };
      // Return top 3 full sections
      return {
        sections: results.slice(0, 3).map(s => ({ title: s.title, content: s.content })),
        message: `Found ${results.length} relevant section(s).`,
      };
    }

    case 'set_field_synonyms': {
      dispatch({ type: 'SET_FIELD_SYNONYMS', payload: { field: args.field, synonyms: args.synonyms } });
      const action = args.synonyms.length === 0 ? 'Removed synonyms for' : `Set synonyms for "${args.field}": ${args.synonyms.join(', ')}`;
      return { success: true, message: action };
    }

    case 'suggest_synonyms': {
      const datasets = args.datasetId
        ? state.datasets.filter(d => d.id === args.datasetId)
        : state.datasets;
      if (datasets.length === 0) return { error: 'No datasets found' };
      const fields = {};
      for (const ds of datasets) {
        for (const [col, type] of Object.entries(ds.columnTypes)) {
          fields[col] = { type, dataset: ds.name, currentSynonyms: state.dashboard.fieldSynonyms?.[col] || [] };
        }
      }
      return {
        fields,
        message: 'Analyze these field names and suggest natural-language synonyms. Present suggestions to the user before applying with set_field_synonyms.',
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
