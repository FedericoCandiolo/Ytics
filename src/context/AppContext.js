import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { applyTransforms, detectColumnTypes } from '../utils/dataUtils';
import { buildTable, cloneDicts } from '../utils/columnStore';
import { v4 as uuid } from 'uuid';

const AppContext = createContext(null);

export const GRID_COLS = 24;

// Required field keys per chart type (used for type-replace compatibility)
export const CHART_REQUIRED_FIELDS = {
  bar:       ['xField', 'yField'],
  line:      ['xField', 'yField'],
  scatter:   ['xField', 'yField'],
  pie:       ['labelField', 'valueField'],
  histogram: ['xField'],
  table:     [],
  treemap:   ['labelField', 'valueField'],
  heatmap:   ['xField', 'yField', 'valueField'],
  bump:      ['xField', 'colorField', 'valueField'],
  stream:    ['xField', 'colorField', 'valueField'],
  violin:    ['xField', 'yField'],
  carousel:  [],
  boxplot:   ['xField', 'yField'],
  radar:     ['axisField', 'valueField'],
  waffle:    ['labelField', 'valueField'],
  sankey:    ['sourceField', 'targetField', 'valueField'],
  geo:       ['geoField', 'valueField'],
  pivot:     ['valueField'],
  waterfall: ['xField', 'valueField'],
  wordcloud: ['xField', 'valueField'],
  funnel:    ['xField', 'valueField'],
  kpi:       ['valueField'],
  bubble:    ['xField', 'valueField'],
  combo:     ['xField', 'yField', 'y2Field'],
  straighttable: ['valueField'],
  mekko:     ['xField', 'yField', 'colorField'],
  text:      [],
  image:     [],
  embed:     [],
};

// Check if converting from one type to another is reasonable
// Returns true if the target type can use at least one field from the source widget
export function canReplaceType(sourceType, targetType, widget) {
  if (sourceType === targetType) return false;
  const targetFields = CHART_REQUIRED_FIELDS[targetType];
  if (!targetFields) return false;
  // table and carousel accept anything
  if (targetFields.length === 0) return true;
  if ((CHART_REQUIRED_FIELDS[sourceType] || []).length === 0) return false;
  // Check if any of the source widget's assigned fields can map to the target
  const allFieldKeys = ['xField', 'yField', 'colorField', 'groupField', 'sizeField',
    'labelField', 'valueField', 'axisField', 'sourceField', 'targetField', 'geoField', 'y2Field'];
  const assignedKeys = allFieldKeys.filter(k => widget[k] != null);
  if (assignedKeys.length === 0) return true; // no fields assigned yet, allow any switch
  // Target needs at least one field that is either directly assigned or can be inferred
  const targetNeeds = new Set(targetFields);
  for (const k of assignedKeys) {
    if (targetNeeds.has(k)) return true;
  }
  // Also check cross-mappable fields (xField↔labelField↔axisField, yField↔valueField)
  const categoryKeys = new Set(['xField', 'labelField', 'axisField', 'geoField', 'sourceField', 'colorField', 'groupField']);
  const numericKeys = new Set(['yField', 'valueField', 'sizeField', 'y2Field']);
  const hasCategoryAssigned = assignedKeys.some(k => categoryKeys.has(k));
  const hasNumericAssigned = assignedKeys.some(k => numericKeys.has(k));
  const targetNeedsCategory = targetFields.some(k => categoryKeys.has(k));
  const targetNeedsNumeric = targetFields.some(k => numericKeys.has(k));
  if ((targetNeedsCategory && hasCategoryAssigned) || (targetNeedsNumeric && hasNumericAssigned)) return true;
  return false;
}

// Map fields from source type to target type, preserving as much as possible
export function mapFieldsForTypeChange(sourceType, targetType, widget) {
  const updates = { type: targetType };
  // Cross-mapping for category fields
  const categoryMap = ['xField', 'labelField', 'axisField', 'geoField', 'sourceField'];
  const numericMap = ['yField', 'valueField'];

  // Find the first assigned category and numeric field from source
  const assignedCategory = categoryMap.find(k => widget[k] != null);
  const assignedNumeric = numericMap.find(k => widget[k] != null);

  // For each target required field, try to fill it
  for (const tf of (CHART_REQUIRED_FIELDS[targetType] || [])) {
    if (widget[tf] != null) continue; // already has it
    if (categoryMap.includes(tf) && assignedCategory && widget[assignedCategory]) {
      updates[tf] = widget[assignedCategory];
    } else if (numericMap.includes(tf) && assignedNumeric && widget[assignedNumeric]) {
      updates[tf] = widget[assignedNumeric];
    }
  }
  // Also map colorField → groupField and vice versa if needed
  if (targetType === 'bar' && !widget.groupField && widget.colorField) {
    updates.groupField = widget.colorField;
  }
  if (targetType !== 'bar' && !widget.colorField && widget.groupField) {
    updates.colorField = widget.groupField;
  }
  // Map y2Field for combo charts from yField if not set
  if (targetType === 'combo' && !widget.y2Field && assignedNumeric && widget[assignedNumeric]) {
    updates.y2Field = widget[assignedNumeric];
  }
  // Map valueField for bubble charts from yField/sizeField if not set
  if (targetType === 'bubble' && !widget.valueField && assignedNumeric && widget[assignedNumeric]) {
    updates.valueField = widget[assignedNumeric];
  }
  // Map xField for waterfall/wordcloud/funnel from labelField or other category fields
  if (['waterfall', 'wordcloud', 'funnel'].includes(targetType) && !widget.xField && assignedCategory && widget[assignedCategory]) {
    updates.xField = widget[assignedCategory];
  }
  // Map valueField for waterfall/wordcloud/funnel/kpi/straighttable from yField or other numeric fields
  if (['waterfall', 'wordcloud', 'funnel', 'kpi', 'straighttable'].includes(targetType) && !widget.valueField && assignedNumeric && widget[assignedNumeric]) {
    updates.valueField = widget[assignedNumeric];
  }
  // Map colorField for mekko from groupField if not set
  if (targetType === 'mekko' && !widget.colorField && widget.groupField) {
    updates.colorField = widget.groupField;
  }
  return updates;
}

export const defaultTheme = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 13,
  canvasColor: '#f0f4f8',
  cardColor: '#ffffff',
  cardRadius: 8,
  cardShadow: 'md',      // 'none' | 'sm' | 'md' | 'lg'
  accentColor: '#3b82f6',
  colorScheme: 'vivid',  // global palette applied to all charts by default
};

function makePage(overrides = {}) {
  return { id: uuid(), name: 'Page 1', widgets: [], layout: [], ...overrides };
}

const _firstPage = makePage();

const initialState = {
  mode: 'developer',
  developerTab: 'dashboard',
  datasets: [],
  activeDatasetId: null,
  dashboard: {
    title: 'My Dashboard',
    pages: [_firstPage],
    currentPageId: _firstPage.id,
    theme: { ...defaultTheme },
    dimensionColors: {},   // { 'Argentina': { type: 'custom', color: '#74b9ff' }, 'Brazil': { type: 'palette', index: 2 } }
    // Shared dimension definitions + state
    hierarchicDimensions: [], // [{ id, name, levels: [field,...], currentLevel: 0, filters: [] }]
    cyclicDimensions: [],     // [{ id, name, fields: [field,...], activeIndex: 0 }]
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
    colorScheme: null,    // null = inherit from theme
    backgroundColor: null,
    cardRadius: null,
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
    // Sort
    sortBy: 'original',        // 'value' | 'label' | 'custom' | 'original'
    sortOrder: 'desc',
    customSortOrder: null,      // string[] for custom sort
    // Pareto / Others
    paretoEnabled: false,
    paretoMethod: 'topN',       // 'topN' | 'threshold' | 'pareto'
    paretoTopN: 10,
    paretoThreshold: 0.8,
    othersLabel: 'Others',
    // Reference line (bar chart)
    referenceLine: null,        // { value: number, label: string } or null
    useLogScale: false,
    orientation: 'vertical',
    lineType: 'linear',
    showPoints: true,
    showArea: false,
    // Line chart
    showTrendLine: false,
    innerRadius: 0,
    // Pie chart
    showSliceValues: false,
    sliceValueMode: 'percent',  // 'value' | 'percent' | 'both'
    // Box/Violin
    iqrMultiplier: 1.5,
    showDataPoints: false,
    // Histogram
    binMode: 'equalWidth',      // 'equalWidth' | 'equalFrequency'
    histogramDimension: null,   // dimension field for aggregated histogram
    bins: 20,
    dotSizeMin: 4,
    dotSizeMax: 20,
    // Scatter
    showRegression: false,
    regressionType: 'linear',   // 'linear' | 'polynomial'
    barMode: 'stacked',    // 'stacked' | 'grouped'
    stackMode: 'none',     // 'none' | 'stacked' | 'percent' (line chart area)
    // Bump
    bumpTopN: null,
    // Sankey fields
    sourceField: null,
    targetField: null,
    sankeyFields: [],           // array of dimension fields for multi-level sankey
    // Radar
    axisField: null,
    radarCurve: 'polygon',     // 'polygon' | 'curved'
    // Geo
    geoField: null,
    mapProjection: 'naturalEarth',
    mapScope: 'world',             // 'world' | 'north-america' | 'south-america' | 'europe' | 'africa' | 'asia' | 'oceania' | country name
    // Pivot table
    pivotRows: [],
    pivotCols: [],
    // Conditional formatting (DataTable / PivotTable)
    conditionalFormatting: [],  // [{ id, column, mode:'gradient'|'rules', gradient, rules:[{op,value,bg,text}] }]
    // Color mode for charts
    colorMode: 'categorical',  // 'categorical' | 'gradient'
    colorGradient: null,       // gradient override (null = follows palette)
    colorGradientField: null,  // numeric field for gradient (null = use chart's value field)
    // Data table
    visibleColumns: null,       // null = all, string[] for selected columns
    // Geo map
    mapZoom: null,
    mapCenter: null,
    // Waterfall
    waterfallMode: 'difference', // 'difference' | 'absolute'
    // Funnel
    funnelMode: 'absolute',     // 'absolute' | 'cumulative'
    // KPI
    kpiFormat: 'number',       // 'number' | 'currency' | 'percent'
    kpiTarget: null,
    kpiGaugeMin: 0,
    kpiGaugeMax: 100,
    kpiStyle: 'card',          // 'card' | 'gauge' | 'satellite'
    // Combo
    y2Field: null,
    y2Aggregation: 'sum',
    comboType: 'barLine',      // 'barLine' | 'lineLine'
    dualAxis: true,
    // Mekko
    mekkoValueMode: 'absolute', // 'absolute' | 'relative' | 'both'
    // Word cloud
    wordCloudMode: 'cell',      // 'cell' | 'split'
    wordCloudMaxWords: 100,
    // Straight table
    straightTableMeasures: [],  // additional measure fields
    straightTableShowTotals: false,
    primaryRepresentation: 'text', // 'text'|'bar'|'pie'|'line' for primary measure display
    primaryChartDimension: null,  // breakdown dimension when primary measure is mini chart
    // Text / Image / Embed content widgets
    staticContent: '',      // text content template
    contentMode: 'markdown', // 'plain' | 'markdown' | 'html'
    textAlign: 'left',
    textFontSize: 14,
    imageUrl: '',
    imageFit: 'contain',    // 'contain' | 'cover' | 'fill'
    embedUrl: '',
    // Measure pipeline
    measures: [],           // array of pipeline steps
    slides: [],             // for carousel widget
    autoPlay: false,
    autoPlayInterval: 5000,
    ...overrides,
  };
}

function findFirstSlot(layout, w, h) {
  const maxY = layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  for (let y = 0; y <= maxY + h; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const fits = !layout.some(l =>
        l.x < x + w && l.x + l.w > x &&
        l.y < y + h && l.y + l.h > y
      );
      if (fits) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

function reducer(state, action) {
  switch (action.type) {

    case 'SET_MODE':
      return { ...state, mode: action.payload, editingWidgetId: null, developerTab: action.payload === 'developer' ? 'dashboard' : state.developerTab };

    case 'SET_DEVELOPER_TAB':
      return { ...state, developerTab: action.payload };

    case 'SET_THEME':
      return {
        ...state,
        dashboard: {
          ...state.dashboard,
          theme: { ...state.dashboard.theme, ...action.payload },
        },
      };

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
      const pageLayout = state.dashboard.pages.find(p => p.id === state.dashboard.currentPageId)?.layout ?? [];
      const { x: slotX, y: slotY } = findFirstSlot(pageLayout, 12, 5);
      const layoutItem = { i: widget.id, x: slotX, y: slotY, w: 12, h: 5 };
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
        const srcLayout = p.layout.find(l => l.i === action.payload);
        const sw = srcLayout?.w ?? 12;
        const sh = srcLayout?.h ?? 5;
        const { x: slotX, y: slotY } = findFirstSlot(p.layout, sw, sh);
        return {
          ...p,
          widgets: [...p.widgets, newWidget],
          layout: [...p.layout, { i: newWidget.id, x: slotX, y: slotY, w: sw, h: sh }],
        };
      });
      if (!newWidget) return state;
      return { ...state, dashboard: { ...state.dashboard, pages }, editingWidgetId: newWidget.id };
    }

    case 'MOVE_WIDGET_TO_PAGE': {
      const { widgetId, targetPageId, copy } = action.payload;
      let srcWidget = null;
      let srcLayout = null;
      // Find the widget and its layout item in any page
      for (const p of state.dashboard.pages) {
        const w = p.widgets.find(w => w.id === widgetId);
        if (w) {
          srcWidget = w;
          srcLayout = p.layout.find(l => l.i === widgetId);
          break;
        }
      }
      if (!srcWidget) return state;
      const newId = copy ? uuid() : srcWidget.id;
      const movedWidget = copy
        ? { ...srcWidget, id: newId, title: srcWidget.title + ' (copy)' }
        : srcWidget;
      const pages = state.dashboard.pages.map(p => {
        if (p.id === targetPageId) {
          const sw = srcLayout?.w ?? 12;
          const sh = srcLayout?.h ?? 5;
          const { x: slotX, y: slotY } = findFirstSlot(p.layout, sw, sh);
          return {
            ...p,
            widgets: [...p.widgets, movedWidget],
            layout: [...p.layout, { i: newId, x: slotX, y: slotY, w: sw, h: sh }],
          };
        }
        if (!copy) {
          // Remove from source page
          return {
            ...p,
            widgets: p.widgets.filter(w => w.id !== widgetId),
            layout: p.layout.filter(l => l.i !== widgetId),
          };
        }
        return p;
      });
      const editingWidgetId = state.editingWidgetId === widgetId && !copy ? null : state.editingWidgetId;
      return { ...state, dashboard: { ...state.dashboard, pages }, editingWidgetId };
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

    // ── Dimension colors ───────────────────────────────────────
    case 'SET_DIMENSION_COLOR': {
      const { value, colorDef } = action.payload; // colorDef: { type: 'custom', color } | { type: 'palette', index }
      return {
        ...state,
        dashboard: {
          ...state.dashboard,
          dimensionColors: { ...state.dashboard.dimensionColors, [value]: colorDef },
        },
      };
    }

    case 'REMOVE_DIMENSION_COLOR': {
      const dc = { ...state.dashboard.dimensionColors };
      delete dc[action.payload];
      return { ...state, dashboard: { ...state.dashboard, dimensionColors: dc } };
    }

    // ── Shared dimensions (dashboard-level) ─────────────────
    case 'SET_HIERARCHIC_DIMENSIONS':
      return { ...state, dashboard: { ...state.dashboard, hierarchicDimensions: action.payload } };

    case 'SET_CYCLIC_DIMENSIONS':
      return { ...state, dashboard: { ...state.dashboard, cyclicDimensions: action.payload } };

    case 'DRILL_DOWN': {
      const { id: drillId, field: drillField, value: drillValue } = action.payload;
      const hds = (state.dashboard.hierarchicDimensions || []).map(hd => {
        if (hd.id !== drillId) return hd;
        if (hd.currentLevel >= hd.levels.length - 1) return hd;
        return { ...hd, currentLevel: hd.currentLevel + 1, filters: [...(hd.filters || []), { field: drillField, value: String(drillValue) }] };
      });
      return { ...state, dashboard: { ...state.dashboard, hierarchicDimensions: hds } };
    }

    case 'DRILL_UP': {
      const hds2 = (state.dashboard.hierarchicDimensions || []).map(hd => {
        if (hd.id !== action.payload) return hd;
        if (hd.currentLevel <= 0) return { ...hd, currentLevel: 0, filters: [] };
        return { ...hd, currentLevel: hd.currentLevel - 1, filters: (hd.filters || []).slice(0, -1) };
      });
      return { ...state, dashboard: { ...state.dashboard, hierarchicDimensions: hds2 } };
    }

    case 'DRILL_TO_LEVEL': {
      const { id: dtlId, level: dtlLevel } = action.payload;
      const hds3 = (state.dashboard.hierarchicDimensions || []).map(hd => {
        if (hd.id !== dtlId) return hd;
        return { ...hd, currentLevel: dtlLevel, filters: (hd.filters || []).slice(0, dtlLevel) };
      });
      return { ...state, dashboard: { ...state.dashboard, hierarchicDimensions: hds3 } };
    }

    case 'CYCLE_DIMENSION': {
      const { id: cycId, direction = 1 } = action.payload;
      const cds = (state.dashboard.cyclicDimensions || []).map(cd => {
        if (cd.id !== cycId) return cd;
        const next = ((cd.activeIndex || 0) + direction + cd.fields.length) % cd.fields.length;
        return { ...cd, activeIndex: next };
      });
      return { ...state, dashboard: { ...state.dashboard, cyclicDimensions: cds } };
    }

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
      const theme = dashboard.theme || defaultTheme;
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
        dashboard: { ...dashboard, pages, currentPageId, theme },
        colStore: { dicts, tables },
      };
    }

    case 'RESTORE_STATE':
      return action.payload;

    case 'RESTORE_FILTERS':
      return { ...state, filters: action.payload };

    default:
      return state;
  }
}

const UNDO_LIMIT = 50;
const UNDOABLE_ACTIONS = new Set([
  'ADD_WIDGET', 'UPDATE_WIDGET', 'REMOVE_WIDGET', 'DUPLICATE_WIDGET',
  'MOVE_WIDGET_TO_PAGE', 'UPDATE_LAYOUT',
  'ADD_PAGE', 'REMOVE_PAGE', 'RENAME_PAGE',
  'SET_THEME', 'SET_DASHBOARD_TITLE',
  'LOAD_DATASET', 'DELETE_DATASET',
  'ADD_TRANSFORM', 'REMOVE_TRANSFORM', 'UPDATE_TRANSFORM', 'MOVE_TRANSFORM',
  'SET_DIMENSION_COLOR', 'REMOVE_DIMENSION_COLOR',
]);

const FILTER_ACTIONS = new Set(['SET_FILTER', 'REMOVE_FILTER', 'CLEAR_FILTERS']);

export function AppProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const undoStackRef = React.useRef([]);
  const redoStackRef = React.useRef([]);
  const filterUndoRef = React.useRef([]);
  const filterRedoRef = React.useRef([]);

  const dispatch = useCallback((action) => {
    // ── Developer undo/redo ──
    if (action.type === 'UNDO') {
      if (undoStackRef.current.length === 0) return;
      redoStackRef.current = [...redoStackRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current];
      rawDispatch({ type: 'RESTORE_STATE', payload: undoStackRef.current.pop() });
      return;
    }
    if (action.type === 'REDO') {
      if (redoStackRef.current.length === 0) return;
      undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current];
      rawDispatch({ type: 'RESTORE_STATE', payload: redoStackRef.current.pop() });
      return;
    }
    // ── Viewer filter undo/redo ──
    if (action.type === 'FILTER_UNDO') {
      if (filterUndoRef.current.length === 0) return;
      filterRedoRef.current = [...filterRedoRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current.filters];
      rawDispatch({ type: 'RESTORE_FILTERS', payload: filterUndoRef.current.pop() });
      return;
    }
    if (action.type === 'FILTER_REDO') {
      if (filterRedoRef.current.length === 0) return;
      filterUndoRef.current = [...filterUndoRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current.filters];
      rawDispatch({ type: 'RESTORE_FILTERS', payload: filterRedoRef.current.pop() });
      return;
    }
    // ── Track undoable actions ──
    if (UNDOABLE_ACTIONS.has(action.type)) {
      undoStackRef.current = [...undoStackRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current];
      redoStackRef.current = [];
    }
    if (FILTER_ACTIONS.has(action.type)) {
      filterUndoRef.current = [...filterUndoRef.current.slice(-(UNDO_LIMIT - 1)), stateRef.current.filters];
      filterRedoRef.current = [];
    }
    rawDispatch(action);
  }, []);

  // Ctrl+Z / Ctrl+Y handler
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;
      e.preventDefault();

      const inViewer = stateRef.current.mode === 'viewer';
      if (isUndo) dispatch({ type: inViewer ? 'FILTER_UNDO' : 'UNDO' });
      else        dispatch({ type: inViewer ? 'FILTER_REDO' : 'REDO' });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
