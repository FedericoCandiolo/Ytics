import React, { createContext, useContext, useReducer } from 'react';
import { applyTransforms, detectColumnTypes } from '../utils/dataUtils';
import { buildTable, cloneDicts } from '../utils/columnStore';
import { v4 as uuid } from 'uuid';

const AppContext = createContext(null);

function makePage(overrides = {}) {
  return { id: uuid(), name: 'Page 1', widgets: [], layout: [], ...overrides };
}

const _firstPage = makePage();

const initialState = {
  mode: 'developer',
  developerTab: 'data',
  datasets: [],
  activeDatasetId: null,
  dashboard: {
    title: 'My Dashboard',
    pages: [_firstPage],
    currentPageId: _firstPage.id,
  },
  filters: {},
  editingWidgetId: null,
  colStore: { dicts: {}, tables: {} },
};

function makeDataset(id, name, data, table) {
  const columns = Object.keys(data[0] || {});
  const columnTypes = detectColumnTypes(data);
  return { id, name, originalData: data, transforms: [], data, columns, columnTypes, table };
}

function recompute(ds, sharedDicts) {
  const data = applyTransforms(ds.originalData, ds.transforms);
  const columns = Object.keys(data[0] || {});
  const columnTypes = detectColumnTypes(data);
  const table = buildTable(ds.id, ds.name, data, sharedDicts);
  return { ...ds, data, columns, columnTypes, table };
}

function defaultWidget(overrides = {}) {
  return {
    id: uuid(),
    type: 'bar',
    datasetId: null,
    title: 'New Chart',
    colorScheme: 'vivid',
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
    dotSizeMin: 4,
    dotSizeMax: 20,
    slides: [],        // for carousel widget
    autoPlay: false,
    autoPlayInterval: 5000,
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
      const dicts = cloneDicts(state.colStore.dicts);
      const table = buildTable(id, name, data, dicts);
      const ds = makeDataset(id, name, data, table);
      return {
        ...state,
        datasets: [...state.datasets, ds],
        activeDatasetId: id,
        colStore: { dicts, tables: { ...state.colStore.tables, [id]: table } },
      };
    }

    case 'DELETE_DATASET': {
      const datasets = state.datasets.filter(d => d.id !== action.payload);
      const activeDatasetId = state.activeDatasetId === action.payload
        ? (datasets[0]?.id ?? null) : state.activeDatasetId;
      const tables = { ...state.colStore.tables };
      delete tables[action.payload];
      return { ...state, datasets, activeDatasetId, colStore: { ...state.colStore, tables } };
    }

    case 'SET_ACTIVE_DATASET':
      return { ...state, activeDatasetId: action.payload };

    // ── Transforms ────────────────────────────────────────────
    case 'ADD_TRANSFORM': {
      const dicts = cloneDicts(state.colStore.dicts);
      const tables = { ...state.colStore.tables };
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const updated = recompute(
          { ...d, transforms: [...d.transforms, { ...action.payload.transform, id: uuid() }] },
          dicts
        );
        tables[d.id] = updated.table;
        return updated;
      });
      return { ...state, datasets, colStore: { dicts, tables } };
    }

    case 'REMOVE_TRANSFORM': {
      const dicts = cloneDicts(state.colStore.dicts);
      const tables = { ...state.colStore.tables };
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const updated = recompute(
          { ...d, transforms: d.transforms.filter(t => t.id !== action.payload.transformId) },
          dicts
        );
        tables[d.id] = updated.table;
        return updated;
      });
      return { ...state, datasets, colStore: { dicts, tables } };
    }

    case 'UPDATE_TRANSFORM': {
      const dicts = cloneDicts(state.colStore.dicts);
      const tables = { ...state.colStore.tables };
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const transforms = d.transforms.map(t =>
          t.id === action.payload.transformId ? { ...t, ...action.payload.updates } : t
        );
        const updated = recompute({ ...d, transforms }, dicts);
        tables[d.id] = updated.table;
        return updated;
      });
      return { ...state, datasets, colStore: { dicts, tables } };
    }

    case 'MOVE_TRANSFORM': {
      const dicts = cloneDicts(state.colStore.dicts);
      const tables = { ...state.colStore.tables };
      const datasets = state.datasets.map(d => {
        if (d.id !== action.payload.datasetId) return d;
        const ts = [...d.transforms];
        const { from, to } = action.payload;
        ts.splice(to, 0, ts.splice(from, 1)[0]);
        const updated = recompute({ ...d, transforms: ts }, dicts);
        tables[d.id] = updated.table;
        return updated;
      });
      return { ...state, datasets, colStore: { dicts, tables } };
    }

    // ── Pages ─────────────────────────────────────────────────
    case 'ADD_PAGE': {
      const page = makePage({ name: `Page ${state.dashboard.pages.length + 1}` });
      return {
        ...state,
        dashboard: {
          ...state.dashboard,
          pages: [...state.dashboard.pages, page],
          currentPageId: page.id,
        },
        editingWidgetId: null,
      };
    }

    case 'REMOVE_PAGE': {
      if (state.dashboard.pages.length <= 1) return state;
      const pages = state.dashboard.pages.filter(p => p.id !== action.payload);
      const currentPageId = state.dashboard.currentPageId === action.payload
        ? pages[pages.length - 1].id : state.dashboard.currentPageId;
      return {
        ...state,
        dashboard: { ...state.dashboard, pages, currentPageId },
        editingWidgetId: null,
      };
    }

    case 'RENAME_PAGE': {
      const pages = state.dashboard.pages.map(p =>
        p.id === action.payload.id ? { ...p, name: action.payload.name } : p
      );
      return { ...state, dashboard: { ...state.dashboard, pages } };
    }

    case 'SET_CURRENT_PAGE':
      return {
        ...state,
        dashboard: { ...state.dashboard, currentPageId: action.payload },
        editingWidgetId: null,
      };

    // ── Widgets ───────────────────────────────────────────────
    case 'ADD_WIDGET': {
      const widget = defaultWidget({
        datasetId: state.datasets[0]?.id ?? null,
        ...action.payload,
      });
      const layoutItem = { i: widget.id, x: 0, y: Infinity, w: 6, h: 6 };
      const pages = state.dashboard.pages.map(p =>
        p.id === state.dashboard.currentPageId
          ? { ...p, widgets: [...p.widgets, widget], layout: [...p.layout, layoutItem] }
          : p
      );
      return {
        ...state,
        dashboard: { ...state.dashboard, pages },
        developerTab: 'dashboard',
        editingWidgetId: widget.id,
      };
    }

    case 'UPDATE_WIDGET': {
      const pages = state.dashboard.pages.map(p => ({
        ...p,
        widgets: p.widgets.map(w =>
          w.id === action.payload.id ? { ...w, ...action.payload.updates } : w
        ),
      }));
      return { ...state, dashboard: { ...state.dashboard, pages } };
    }

    case 'REMOVE_WIDGET': {
      const id = action.payload;
      const pages = state.dashboard.pages.map(p => ({
        ...p,
        widgets: p.widgets.filter(w => w.id !== id),
        layout: p.layout.filter(l => l.i !== id),
      }));
      const editingWidgetId = state.editingWidgetId === id ? null : state.editingWidgetId;
      return { ...state, dashboard: { ...state.dashboard, pages }, editingWidgetId };
    }

    case 'DUPLICATE_WIDGET': {
      let newWidget = null;
      const pages = state.dashboard.pages.map(p => {
        const src = p.widgets.find(w => w.id === action.payload);
        if (!src) return p;
        newWidget = { ...src, id: uuid(), title: src.title + ' (copy)' };
        return {
          ...p,
          widgets: [...p.widgets, newWidget],
          layout: [...p.layout, { i: newWidget.id, x: 0, y: Infinity, w: 6, h: 6 }],
        };
      });
      if (!newWidget) return state;
      return { ...state, dashboard: { ...state.dashboard, pages }, editingWidgetId: newWidget.id };
    }

    case 'UPDATE_LAYOUT': {
      const pages = state.dashboard.pages.map(p =>
        p.id === state.dashboard.currentPageId ? { ...p, layout: action.payload } : p
      );
      return { ...state, dashboard: { ...state.dashboard, pages } };
    }

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
      // Support both old format (widgets/layout) and new format (pages)
      let pages = dashboard.pages;
      if (!pages) {
        const migratedPage = makePage({
          name: 'Page 1',
          widgets: dashboard.widgets || [],
          layout: dashboard.layout || [],
        });
        pages = [migratedPage];
      }
      const currentPageId = pages[0]?.id ?? uuid();
      const dicts = {};
      const tables = {};
      const processed = datasets.map(d => {
        const updated = recompute({ ...d, transforms: d.transforms ?? [] }, dicts);
        tables[d.id] = updated.table;
        return updated;
      });
      return {
        ...initialState,
        mode: 'viewer',
        datasets: processed,
        activeDatasetId: processed[0]?.id ?? null,
        dashboard: { ...dashboard, pages, currentPageId },
        colStore: { dicts, tables },
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
