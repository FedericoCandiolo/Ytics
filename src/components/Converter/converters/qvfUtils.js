import JSZip from 'jszip';
import { v4 as uuid } from 'uuid';

// ── QlikSense JSON chart type → Ytics type ───────────────────────────────────
const CHART_TYPE_MAP = {
  barchart:            'bar',
  linechart:           'line',
  piechart:            'pie',
  scatterplot:         'scatter',
  combochart:          'combo',
  table:               'table',
  'pivot-table':       'pivot',
  treemap:             'treemap',
  kpi:                 'kpi',
  histogram:           'histogram',
  boxplot:             'boxplot',
  waterfallchart:      'waterfall',
  mekko:               'mekko',
  'barplusminuschart': 'bar',
  bullet:              'bar',
  gauge:               'kpi',
  distributionplot:    'violin',
  'bar-plus-minus':    'bar',
  map:                 'geo',
  heatmap:             'heatmap',
  funnel:              'funnel',
  'filterpane':        null,
  'listbox':           null,
  'text-image':        null,
  'button':            null,
  'container':         null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseExpression(expr) {
  if (!expr || typeof expr !== 'string') return { aggregation: 'sum', field: '', label: '' };
  const trimmed = expr.trim();
  const m = trimmed.match(/^(Sum|Count|Avg|Max|Min|Median|Mode|Stdev|Variance)\s*\(\s*(DISTINCT\s+)?([^)]+)\s*\)/i);
  if (m) {
    const aggRaw = m[1].toLowerCase();
    const distinct = !!m[2];
    const field = m[3].trim().replace(/^["'`\[\]]|["'`\[\]]$/g, '');
    const agg = distinct ? 'count_distinct'
      : (aggRaw === 'median' || aggRaw === 'mode' || aggRaw === 'stdev' || aggRaw === 'variance' ? 'avg' : aggRaw);
    return { aggregation: agg, field, label: '' };
  }
  const label = trimmed.substring(0, 60);
  const field = trimmed.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30) || 'measure';
  return { aggregation: 'sum', field, label };
}

function toLayout(bounds, id) {
  const qCols = 24, ytCols = 12;
  const scale = ytCols / qCols;
  const bx = bounds.x ?? bounds.left ?? 0;
  const by = bounds.y ?? bounds.top ?? 0;
  const bw = bounds.width ?? bounds.col ?? bounds.w ?? 6;
  const bh = bounds.height ?? bounds.row ?? bounds.h ?? 4;
  const x = Math.min(Math.round(bx * scale), ytCols - 1);
  const w = Math.max(2, Math.min(Math.round(bw * scale), ytCols - x));
  const y = Math.round(by);
  const h = Math.max(2, Math.round(bh));
  return { i: id, x, y, w, h };
}

function buildWidget(obj, cellBounds) {
  const vizType = obj.visualization || obj.qInfo?.qType;
  if (!vizType) return null;
  const ytType = CHART_TYPE_MAP[vizType];
  if (ytType === null || !ytType) return null;

  const hcd = obj.qHyperCubeDef || obj.hypercubeDef || {};
  const dims = hcd.qDimensions || [];
  const meas = hcd.qMeasures || [];

  const dim0 = dims[0]?.qDef?.qFieldDefs?.[0] ?? dims[0]?.qDef?.qFieldDef ?? '';
  const dim1 = dims[1]?.qDef?.qFieldDefs?.[0] ?? dims[1]?.qDef?.qFieldDef ?? '';
  const expr0 = meas[0]?.qDef?.qDef ?? '';
  const expr1 = meas[1]?.qDef?.qDef ?? '';
  const label0 = meas[0]?.qDef?.qLabel ?? meas[0]?.qDef?.qLabelExpression ?? '';
  const { aggregation, field: yField, label: exprLabel0 } = parseExpression(expr0);
  const { field: yField2 } = parseExpression(expr1);

  const id = uuid();
  const widget = {
    id, type: ytType,
    title: (obj.title ?? obj.qMetaDef?.title ?? '').trim(),
    datasetId: null,
    xField: dim0 || undefined,
    yField: yField || undefined,
    aggregation,
    colorField: dim1 || undefined,
    _sourceViz: vizType,
    _measureLabel: label0 || exprLabel0 || undefined,
  };

  switch (ytType) {
    case 'kpi':
      widget.measure = yField; delete widget.xField; break;
    case 'pie':
      widget.colorField = dim0; widget.xField = undefined; break;
    case 'scatter':
      if (meas.length >= 2) { widget.xField = yField; widget.yField = yField2; widget.colorField = dim0 || undefined; }
      break;
    case 'table': case 'pivot': {
      const cols = [
        ...dims.map(d => d.qDef?.qFieldDefs?.[0] ?? d.qDef?.qFieldDef).filter(Boolean),
        ...meas.map(m => { const { field } = parseExpression(m.qDef?.qDef ?? ''); return field; }).filter(Boolean),
      ];
      widget.straightTableColumns = cols.length ? cols : undefined;
      break;
    }
    default: break;
  }

  return { widget, layout: toLayout(cellBounds, id) };
}

function collectObjects(node, registry, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) { node.forEach(item => collectObjects(item, registry, depth + 1)); return; }
  if (node.qInfo?.qId) registry[node.qInfo.qId] = node;
  for (const val of Object.values(node)) collectObjects(val, registry, depth + 1);
}

// ── QlikView binary format parser ────────────────────────────────────────────
// QlikView's QVF is NOT a zip — it's a proprietary container.
// Chart type and caption are in an embedded XML section; dimensions/measures
// are in binary and cannot be extracted. We create typed placeholder widgets.

// Map QlikView Spanish type names (lowercased substring match) → Ytics type
const QV_TYPE_KEYWORDS = [
  ['indicador',   'kpicard'],
  ['barras',      'bar'],
  ['neas',        'line'],    // "líneas" (handles accent variations)
  ['tarta',       'pie'],
  ['mekko',       'mekko'],
  ['rejilla',     'heatmap'],
  ['combinado',   'combo'],
  ['dispersi',    'scatter'], // "Dispersión"
  ['pivotante',   'pivottable'],
  ['simple',      'straighttable'],
  ['cuadro de tabla', 'straighttable'],
  // skip — not chart widgets:
  ['lista',       null],
  ['estad',       null],
  ['selecci',     null],
  ['entrada',     null],
  ['deslizador',  null],
  ['contenedor',  null],
];

function qvTypeToYtics(rawType) {
  const lower = rawType.toLowerCase();
  for (const [key, val] of QV_TYPE_KEYWORDS) {
    if (lower.includes(key)) return val;
  }
  return 'bar';
}

// Parse the embedded XML section to extract SheetObject metadata and Sheet structure
function parseQVXml(text) {
  const objects = {}; // { id → { yticsType, caption, qlikType } }
  const sheets  = []; // [ { id, name, childIds[] } ]
  let m;

  const soRx = /<SheetObject>\s*<ObjectId>([^<]+)<\/ObjectId>\s*<Caption>([^<]*)<\/Caption>\s*<Type>([^<]+)<\/Type>/g;
  while ((m = soRx.exec(text)) !== null) {
    const id       = m[1].replace(/Document\\/g, '').trim();
    const caption  = m[2].trim();
    const qlikType = m[3].trim();
    objects[id] = { yticsType: qvTypeToYtics(qlikType), caption, qlikType };
  }

  const shRx = /<Sheet>\s*<SheetId>([^<]+)<\/SheetId>\s*<Title>([^<]*)<\/Title>\s*<ChildObjects>([\s\S]*?)<\/ChildObjects>/g;
  while ((m = shRx.exec(text)) !== null) {
    const id       = m[1].replace(/Document\\/g, '').trim();
    const name     = m[2].trim() || id;
    const childIds = [...m[3].matchAll(/<ObjectId>([^<]+)<\/ObjectId>/g)]
      .map(x => x[1].replace(/Document\\/g, '').trim());
    sheets.push({ id, name, childIds });
  }

  return { objects, sheets };
}

function decodeBase64Segments(text) {
  // Strip everything that isn't a base64 char (including the \x01\x00\x00\x00 separators
  // and any binary junk captured before hitting a closing " in the binary)
  const clean = text.replace(/[^A-Za-z0-9+/]/g, ''); // strip = too, re-add correct padding
  if (!clean.length) return '';
  // atob requires length to be a multiple of 4; add minimal padding
  const pad = (4 - clean.length % 4) % 4;
  try {
    return atob(clean + '='.repeat(pad));
  } catch {
    return '';
  }
}

function parseQVFBinary(buffer) {
  // Decode as latin-1 to read all bytes without corruption
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);

  const warnings = [];
  warnings.push('QlikView binary format: chart types, titles and pages were extracted from the embedded XML. Dimensions and measures are stored in binary — connect a dataset and configure fields in Ytics after import.');

  // ── 1. Extract chart object IDs from SecurityMeta base64 (reliable source) ─
  const chartIds = new Set();
  const secMetaPattern = /SecurityMetaAsBase64":"([^"]{40,})/g;
  let m;
  while ((m = secMetaPattern.exec(text)) !== null) {
    const decoded = decodeBase64Segments(m[1]);
    const idMatch = decoded.match(/"id":"([^"]+)"/);
    if (idMatch) chartIds.add(idMatch[1]);
  }

  // Bare-ID fallback only when SecurityMeta yielded nothing
  if (chartIds.size === 0) {
    const asciiRuns = [...text.matchAll(/[ -~]{6,}/g)].map(x => x[0]).join('\n');
    const bareIds = [...new Set([...asciiRuns.matchAll(/\b(CH\d{2,4})\b/g)].map(x => x[1]))];
    bareIds.forEach(id => chartIds.add(id));
  }

  // Filter SecurityMeta IDs to valid patterns
  chartIds.forEach(id => { if (!/^[A-Z]{1,3}\d{1,4}$/i.test(id)) chartIds.delete(id); });

  // ── 2. Parse XML section for chart types and captions ────────────────────
  const { objects: objectMap, sheets: xmlSheets } = parseQVXml(text);

  // Add XML-sourced CH/TB IDs that have a known ytics type (XML is the definitive object list)
  for (const [id, info] of Object.entries(objectMap)) {
    if (info.yticsType !== null && /^(CH|TB)\d+/i.test(id)) chartIds.add(id);
  }

  const chartIdsArr = [...chartIds];

  // ── 3. Extract data model from embedded SQL script ────────────────────────
  const dataModel = {};
  const selectPattern = /SELECT\s+([\s\S]+?)\s+FROM\s+"?(\w+)"?/g;
  while ((m = selectPattern.exec(text)) !== null) {
    const fieldsRaw = m[1];
    const tableName = m[2];
    if (!tableName || tableName.length > 60) continue;
    const fields = fieldsRaw
      .split(',')
      .map(f => f.trim().replace(/[^A-Za-z0-9_áéíóúÁÉÍÓÚñÑ]/g, '').trim())
      .filter(f => f.length > 0 && f.length < 50 && /^[A-Za-z_]/.test(f));
    if (fields.length > 0 && !dataModel[tableName]) dataModel[tableName] = fields;
  }
  const loadPattern = /LOAD\s+([\s\S]+?)\s+RESIDENT\s+(\w+)/g;
  while ((m = loadPattern.exec(text)) !== null) {
    const fieldsRaw = m[1];
    const tableName = m[2];
    const fields = fieldsRaw
      .split(',')
      .map(f => f.trim().split(/\s+as\s+/i).pop().replace(/[^A-Za-z0-9_]/g, '').trim())
      .filter(f => f.length > 0 && f.length < 50 && /^[A-Za-z_]/.test(f));
    if (fields.length > 0 && !dataModel[tableName]) dataModel[tableName] = fields;
  }

  // ── 4. Try to find app title ──────────────────────────────────────────────
  const appTitle = [...text.matchAll(/Document\s+(\w[\w\s]{2,40})/g)]
    .map(x => x[1].trim()).find(t => t && t.length < 50) || '';

  // ── 5. Build pages from XML sheets, distribute charts proportionally ──────
  // Sort chart IDs numerically so they appear in natural order
  const sortedChartIds = chartIdsArr.slice().sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });

  // Determine which CH IDs are directly listed in a specific sheet (not via containers)
  const directlyAssigned = new Map(); // chartId → sheetIndex
  xmlSheets.forEach((sheet, si) => {
    sheet.childIds.forEach(cid => {
      if (/^(CH|TB)\d+/.test(cid)) directlyAssigned.set(cid, si);
    });
  });

  // Separate directly assigned from unassigned
  const unassigned = sortedChartIds.filter(cid => !directlyAssigned.has(cid));

  // Distribute unassigned charts across sheets proportionally
  const sheetsWithContainers = xmlSheets.filter((_, si) =>
    !xmlSheets[si].childIds.some(cid => /^(CH|TB)\d+/.test(cid))
  );
  const unassignedPerSheet = sheetsWithContainers.length > 0
    ? Math.ceil(unassigned.length / sheetsWithContainers.length)
    : unassigned.length;

  let unassignedIdx = 0;
  const sheetCharts = xmlSheets.map((sheet, si) => {
    // Direct children that are chart objects
    const direct = sheet.childIds.filter(cid => /^(CH|TB)\d+/.test(cid));
    if (direct.length > 0) return direct;
    // Proportional slice of unassigned charts
    const slice = unassigned.slice(unassignedIdx, unassignedIdx + unassignedPerSheet);
    unassignedIdx += unassignedPerSheet;
    return slice;
  });

  // Build pages (skip empty ones unless no sheets parsed)
  const makeWidget = (cid, col, row) => {
    const info = objectMap[cid];
    const id = uuid();
    return {
      widget: {
        id,
        type: info?.yticsType || 'bar',
        title: info?.caption || cid,
        datasetId: null,
        aggregation: 'sum',
        _sourceViz: info?.qlikType || 'binary (QlikView)',
        _sourceId: cid,
        _placeholder: true,
      },
      layout: { i: id, x: col * 6, y: row * 4, w: 6, h: 4 },
    };
  };

  let pages = [];
  if (xmlSheets.length > 0 && sortedChartIds.length > 0) {
    xmlSheets.forEach((sheet, si) => {
      const ids = sheetCharts[si].filter(cid => sortedChartIds.includes(cid));
      if (ids.length === 0) return;
      const widgets = [], layout = [];
      ids.forEach((cid, i) => {
        const { widget, layout: lay } = makeWidget(cid, i % 2, Math.floor(i / 2));
        widgets.push(widget);
        layout.push(lay);
      });
      pages.push({ id: uuid(), name: sheet.name, widgets, layout });
    });
  }

  // Fallback: single page with all charts
  if (pages.length === 0 && sortedChartIds.length > 0) {
    const widgets = [], layout = [];
    sortedChartIds.forEach((cid, i) => {
      const { widget, layout: lay } = makeWidget(cid, i % 2, Math.floor(i / 2));
      widgets.push(widget);
      layout.push(lay);
    });
    pages.push({ id: uuid(), name: 'Imported', widgets, layout });
  }

  const totalWidgets = pages.reduce((s, p) => s + p.widgets.length, 0);

  return {
    appTitle,
    pages,
    warnings,
    dataModel,
    stats: {
      files: 1,
      jsonFiles: 0,
      objects: sortedChartIds.length,
      sheets: xmlSheets.length,
      pages: pages.length,
      widgets: totalWidgets,
    },
    isBinaryFormat: true,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function parseQVF(file) {
  const buffer = await file.arrayBuffer();

  // Check if it's a ZIP (magic bytes 50 4B 03 04)
  const magic = new Uint8Array(buffer, 0, 4);
  const isZip = magic[0] === 0x50 && magic[1] === 0x4B && magic[2] === 0x03 && magic[3] === 0x04;

  if (isZip) {
    return parseQVFZip(buffer);
  } else {
    return parseQVFBinary(buffer);
  }
}

// ── QlikSense ZIP-based QVF parser ───────────────────────────────────────────

async function parseQVFZip(buffer) {
  const blob = new Blob([buffer]);
  const zip = await JSZip.loadAsync(blob);
  const fileNames = Object.keys(zip.files).filter(n => !zip.files[n].dir);

  const jsonDocs = {};
  for (const name of fileNames) {
    try {
      const text = await zip.files[name].async('text');
      const t = text.trim();
      if (!t.startsWith('{') && !t.startsWith('[')) continue;
      jsonDocs[name] = JSON.parse(t);
    } catch { /* not JSON */ }
  }

  if (Object.keys(jsonDocs).length === 0) {
    throw new Error('No JSON content found inside the ZIP. The file may use an unsupported format.');
  }

  const registry = {};
  for (const doc of Object.values(jsonDocs)) collectObjects(doc, registry);

  let sheets = Object.values(registry).filter(o =>
    o.qInfo?.qType === 'sheet' || o.visualization === 'sheet'
  );
  if (sheets.length === 0) {
    for (const doc of Object.values(jsonDocs)) {
      const candidates = doc.sheets || doc.qSheets || doc.layout?.sheets;
      if (Array.isArray(candidates)) candidates.forEach(s => sheets.push(s));
    }
  }

  const warnings = [];
  const appTitle = (() => {
    for (const doc of Object.values(jsonDocs)) {
      const t = doc.qMetaDef?.title || doc.qMetaDef?.name || doc.title || doc.name;
      if (t && typeof t === 'string' && t.trim()) return t.trim();
    }
    return '';
  })();

  const pages = sheets.map(sheet => {
    const sheetName = sheet.qMetaDef?.title ?? sheet.qMetaDef?.name ?? sheet.title ?? 'Sheet';
    const cells = sheet.cells ?? sheet.qChildList?.qItems?.map(i => i.qData ?? i) ?? [];
    const pageWidgets = [];
    const pageLayout = [];
    const skipped = [];

    for (const cell of cells) {
      const refId = cell.name ?? cell.qInfo?.qId ?? cell.id;
      const childObj = (refId && registry[refId]) ? registry[refId] : cell;
      const result = buildWidget(childObj, cell.bounds ?? cell.qBounds ?? {});
      if (!result) {
        const vizType = childObj.visualization || childObj.qInfo?.qType || 'unknown';
        if (CHART_TYPE_MAP[vizType] !== null) skipped.push(vizType);
        continue;
      }
      pageWidgets.push(result.widget);
      pageLayout.push(result.layout);
    }
    if (skipped.length > 0) {
      warnings.push(`"${sheetName}": skipped ${skipped.length} unsupported objects (${[...new Set(skipped)].join(', ')})`);
    }
    return { id: uuid(), name: sheetName, widgets: pageWidgets, layout: pageLayout };
  });

  if (pages.length === 0) {
    const vizObjects = Object.values(registry).filter(o => {
      const v = o.visualization || o.qInfo?.qType;
      return v && CHART_TYPE_MAP[v] !== undefined && CHART_TYPE_MAP[v] !== null;
    });
    if (vizObjects.length > 0) {
      const pageWidgets = [];
      const pageLayout = [];
      vizObjects.forEach((obj, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const result = buildWidget(obj, { x: col * 12, y: row * 4, width: 12, height: 4 });
        if (!result) return;
        pageWidgets.push(result.widget);
        pageLayout.push(result.layout);
      });
      if (pageWidgets.length > 0) pages.push({ id: uuid(), name: 'Imported', widgets: pageWidgets, layout: pageLayout });
    }
  }

  if (pages.length === 0) {
    warnings.push('No sheets or visualizations could be extracted from this QVF.');
  }

  const totalWidgets = pages.reduce((s, p) => s + p.widgets.length, 0);
  return {
    appTitle,
    pages,
    warnings,
    dataModel: {},
    isBinaryFormat: false,
    stats: {
      files: fileNames.length,
      jsonFiles: Object.keys(jsonDocs).length,
      objects: Object.keys(registry).length,
      sheets: sheets.length,
      pages: pages.length,
      widgets: totalWidgets,
    },
  };
}

// ── Build Ytics blob ──────────────────────────────────────────────────────────

export async function buildYticsBlob(parsed) {
  const { appTitle, pages } = parsed;
  const pageId = pages[0]?.id ?? uuid();
  const dashboard = {
    title: appTitle || 'Imported Dashboard',
    pages,
    currentPageId: pageId,
    theme: {
      fontFamily: 'Inter, sans-serif',
      fontSize: 13,
      canvasColor: '#f0f4f8',
      cardColor: '#ffffff',
      cardRadius: 8,
      cardShadow: 'md',
      accentColor: '#3b82f6',
      colorScheme: 'vivid',
    },
    dimensionColors: {},
    consistentColorFields: [],
    fieldSynonyms: {},
    advancedStats: false,
    bookmarks: [],
    modelPositions: null,
    hierarchicDimensions: [],
    cyclicDimensions: [],
  };
  const { generateDashboardBlob } = await import('../../../utils/exportUtils');
  return generateDashboardBlob([], dashboard, {});
}
