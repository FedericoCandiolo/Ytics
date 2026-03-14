import React, { createContext, useContext, useReducer } from 'react';
import { applyTransforms, detectColumnTypes } from '../utils/dataUtils';
import { v4 as uuid } from 'uuid';

const AppContext = createContext(null);

const initialState = {
  mode: 'developer',       // 'developer' | 'viewer'
  developerTab: 'data',    // 'data' | 'dashboard'
  datasets: [],
  activeDatasetId: null,
  dashboard: {
    title: 'My Dashboard',
    widgets: [],
    layout: [],
  },
  filters: {},             // { [filterId]: filterObject }
  editingWidgetId: null,
};

function makeDataset(id, name, data) {
  const columns = Object.keys(data[0] || {});
  const columnTypes = detectColumnTypes(data);
  return { id, name, originalData: data, transforms: [], data, columns, columnTypes };
}

function recompute(ds) {
  const data = applyTransforms(ds.originalData, ds.transforms);
  const columns = Object.keys(data[0] || {});
  const columnTypes = detectColumnTypes(data);
  return { ...ds, data, columns, columnTypes };
}

function defaultWidget(overrides = {}) {
  return {
    id: uuid(),
    type: 'bar',
    datasetId: null,
    title: 'New Chart',
    colorScheme: 'tableau10',
    backgroundColor: '#ffffff',
    showLegend: true,
    showGrid: true,
    opacity: 1,
    xField: null,
    yField: null,
    colorField: null,
    groupField: null,
    sizeField: null,
    labelField: null,
    valueField: null,
    aggregation: 'sum',
    sortBy: 'value',
    sortOrder: 'desc',
    orientation: 'vertical',
    lineType: 'linear',
    showPoints: true,
    showArea: false,
    innerRadius: 0,
    bins: 20,
    ...overrides,
  };
}

function reducer(state, action) {
  switch (action.type) {

    case 'SET_MODE':
      return { ...state, mode: action.payload, editingWidgetId: null };

    case 'SET_DEVELOPER_TAB':
      return { ...state, developerTab: action.payload };

    // ── Datasets ──────────────────────────────────────────────
    case 'LOAD_DATASET': {
      const { name, data } = action.payload;
      const id = uuid();
      const ds = makeDataset(id, name, data);
      return { ...state, datasets: [...state.datasets, ds], activeDatasetId: id };
    }

    case 'DELETE_DATASET': {
      const datasets = state.datasets.filter(d => d.id !== action.payload);
      const activeDatasetId = state.activeDatasetId === action.payload
        ? (datasets[0]?.id ?? null) : state.activeDatasetId;
      return { ...state, datasets, activeDatasetId };
    }

    case 'SET_ACTIVE_DATASET':
      return { ...state, activeDatasetId: action.payload };

    // ── Transforms ────────────────────────────────────────────
    case 'ADD_TRANSFORM': {
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        return recompute({ ...d, transforms: [...d.transforms, { ...action.payload.transform, id: uuid() }] });
      });
      return { ...state, datasets };
    }

    case 'REMOVE_TRANSFORM': {
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        return recompute({ ...d, transforms: d.transforms.filter(t => t.id !== action.payload.transformId) });
      });
      return { ...state, datasets };
    }

    case 'UPDATE_TRANSFORM': {
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const transforms = d.transforms.map(t =>
          t.id === action.payload.transformId ? { ...t, ...action.payload.updates } : t
        );
        return recompute({ ...d, transforms });
      });
      return { ...state, datasets };
    }

    case 'MOVE_TRANSFORM': {
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const ts = [...d.transforms];
        const { from, to } = action.payload;
        ts.splice(to, 0, ts.splice(from, 1)[0]);
        return recompute({ ...d, transforms: ts });
      });
      return { ...state, datasets };
    }

    // ── Widgets ───────────────────────────────────────────────
    case 'ADD_WIDGET': {
      const widget = defaultWidget({
        datasetId: state.datasets[0]?.id ?? null,
        ...action.payload,
      });
      const layout = [...state.dashboard.layout, { i: widget.id, x: 0, y: Infinity, w: 6, h: 4 }];
      return {
        ...state,
        dashboard: { ...state.dashboard, widgets: [...state.dashboard.widgets, widget], layout },
        developerTab: 'dashboard',
        editingWidgetId: widget.id,
      };
    }

    case 'UPDATE_WIDGET': {
      const widgets = state.dashboard.widgets.map(w =>
        w.id === action.payload.id ? { ...w, ...action.payload.updates } : w
      );
      return { ...state, dashboard: { ...state.dashboard, widgets } };
    }

    case 'REMOVE_WIDGET': {
      const widgets = state.dashboard.widgets.filter(w => w.id !== action.payload);
      const layout = state.dashboard.layout.filter(l => l.i !== action.payload);
      const editingWidgetId = state.editingWidgetId === action.payload ? null : state.editingWidgetId;
      return { ...state, dashboard: { ...state.dashboard, widgets, layout }, editingWidgetId };
    }

    case 'DUPLICATE_WIDGET': {
      const src = state.dashboard.widgets.find(w => w.id === action.payload);
      if (!src) return state;
      const widget = { ...src, id: uuid(), title: src.title + ' (copy)' };
      const layout = [...state.dashboard.layout, { i: widget.id, x: 0, y: Infinity, w: 6, h: 4 }];
      return {
        ...state,
        dashboard: { ...state.dashboard, widgets: [...state.dashboard.widgets, widget], layout },
        editingWidgetId: widget.id,
      };
    }

    case 'UPDATE_LAYOUT':
      return { ...state, dashboard: { ...state.dashboard, layout: action.payload } };

    case 'SET_DASHBOARD_TITLE':
      return { ...state, dashboard: { ...state.dashboard, title: action.payload } };

    case 'SET_EDITING_WIDGET':
      return { ...state, editingWidgetId: action.payload };

    // ── Filters ───────────────────────────────────────────────
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, [action.payload.id]: action.payload } };

    case 'REMOVE_FILTER': {
      const filters = { ...state.filters };
      delete filters[action.payload];
      return { ...state, filters };
    }

    case 'CLEAR_FILTERS':
      return { ...state, filters: {} };

    // ── Import ────────────────────────────────────────────────
    case 'IMPORT_STATE': {
      const { datasets, dashboard } = action.payload;
      const processed = datasets.map(d => recompute({ ...d, transforms: d.transforms ?? [] }));
      return {
        ...initialState,
        mode: 'viewer',
        datasets: processed,
        activeDatasetId: processed[0]?.id ?? null,
        dashboard,
      };
    }

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
