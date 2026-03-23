# CLAUDE.md

## Permissions

Claude has full access to read, write, and execute any file or command in this project without confirmation. This includes:

- Reading and editing all source files
- Creating and deleting files
- Running shell commands (npm, git, node, etc.)
- Installing and removing npm packages
- Running the dev server, build, and tests
- Git operations (commit, branch, push, pull)

## Project Overview

**ytics** — A React 19 dashboard builder for data analytics and visualization.

### Tech Stack

- React 19 (Create React App)
- react-grid-layout v2.2.2 (use `react-grid-layout/legacy` for v1-compatible props API with `WidthProvider`)
- D3.js for chart rendering (via `d3` package)
- uuid for ID generation
- No TypeScript — pure JavaScript with JSX

### Architecture

- `src/context/AppContext.js` — Central state via `useReducer`. Exports `AppProvider`, `useApp`, `defaultTheme`.
- `src/components/Developer/` — Developer mode: `DeveloperMode.js`, `DashboardBuilder.js` (grid canvas + sidebar), `WidgetEditor.js` (per-widget config), `DataIntegration.js` (dataset management), `MeasurePipeline.js` (measure/calculation pipeline).
- `src/components/Viewer/` — Viewer mode: `ViewerMode.js`, `FilterPanel.js`.
- `src/components/Widgets/` — Chart components: `BarChart`, `BoxPlot`, `BubbleChart`, `BumpChart`, `Carousel`, `ComboChart`, `DataTable`, `FunnelChart`, `GeoMap`, `HeatMap`, `Histogram`, `KPICard`, `LineChart`, `MekkoChart`, `PieChart`, `PivotTable`, `RadarChart`, `SankeyDiagram`, `ScatterPlot`, `StraightTable`, `StreamGraph`, `Treemap`, `ViolinPlot`, `WaffleChart`, `WaterfallChart`, `WidgetContainer` (wrapper), `WordCloud`. Shared helpers: `chartHelpers.js`, `useTooltip.js`.
- `src/components/` — `Header.js` (top bar), `HelpPage.js` (help/docs view).
- `src/utils/` — `colorUtils.js` (palette registry, gradient scales, color overrides), `dataUtils.js` (transforms, filters, aggregations), `exportUtils.js` (zip export/import), `columnStore.js` (in-memory columnar store).

### Key Patterns

- **Dashboard state**: `state.dashboard.pages[]` — each page has `widgets[]` and `layout[]`. Widgets reference datasets by `datasetId`.
- **Theme inheritance**: `dashboard.theme` holds global styles. Widget properties use `null` to inherit from theme (e.g., `colorScheme: null` means use `theme.colorScheme`).
- **Grid**: Uses `compactType={null}` + `preventCollision={true}` for free-placement. All 8 resize handles enabled.
- **Export/Import**: `.ytics` zip files containing `dashboard.json` (full dashboard object with pages, layout, theme) and dataset CSVs.
- **Number formatting**: `NUMBER_FORMATS` registry in `chartHelpers.js` — `auto`, `number`, `si`, `scientific`, `currency`, `percent`. Applied via `formatValue(v, format)`. Per-measure `numberFormat` overrides widget-level `numberFormat`.
- **Multi-measure mode**: Charts supporting multiple measures store them in `*ChartMeasures[]` arrays (e.g., `lineChartMeasures`, `barChartMeasures`, `straightTableMeasures`). Each measure object: `{ field, aggregation, label, numberFormat }`. The primary measure uses the widget's top-level `yField`/`aggregation`/`numberFormat`.
- **Aggregation modifiers**: `distinct` (count unique values) and `total` (grand total across all groups) can be combined with aggregations. Stored as `aggregation: 'distinct_count'`, `'total_sum'`, etc.
- **Combo chart dual formatting**: `widget.numberFormat` for primary Y-axis, `widget.y2NumberFormat` for secondary Y-axis.
- **Line chart x-axis spacing**: `widget.xAxisSpacing` — `'equal'` (default, scalePoint) or `'linear'` (proportional, scaleLinear/scaleTime).

### Commands

- `npm start` — Dev server on port 3000
- `npm run build` — Production build
- `npm test` — Run tests
