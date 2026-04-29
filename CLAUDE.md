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
- `src/components/Developer/` — Developer mode: `DeveloperMode.js`, `DashboardBuilder.js` (grid canvas + sidebar), `WidgetEditor.js` (per-widget config), `DataIntegration.js` (dataset management + data model view), `DataModel.js` (interactive SVG ER diagram), `MeasurePipeline.js` (measure/calculation pipeline).
- `src/components/Viewer/` — Viewer mode: `ViewerMode.js`, `FilterPanel.js`.
- `src/components/Widgets/` — Chart components: `BarChart`, `BoxPlot`, `BubbleChart`, `BumpChart`, `Carousel`, `ComboChart`, `Correlogram`, `DataTable`, `DensityChart`, `FunnelChart`, `GeoMap`, `HeatMap`, `Histogram`, `KPICard`, `LineChart`, `MekkoChart`, `PieChart`, `PivotTable`, `RadarChart`, `SankeyDiagram`, `ScatterPlot`, `StraightTable`, `StreamGraph`, `Treemap`, `ViolinPlot`, `WaffleChart`, `WaterfallChart`, `WidgetContainer` (wrapper), `WordCloud`. Shared helpers: `chartHelpers.js`, `useTooltip.js`.
- `src/components/` — `Header.js` (top bar), `HelpPage.js` (help/docs view).
- `src/utils/` — `colorUtils.js` (palette registry, gradient scales, color overrides), `dataUtils.js` (transforms, filters, aggregations), `exportUtils.js` (zip export/import), `columnStore.js` (in-memory columnar store).

### Key Patterns

- **Dashboard state**: `state.dashboard.pages[]` — each page has `widgets[]` and `layout[]`. Widgets reference datasets by `datasetId`.
- **Theme inheritance**: `dashboard.theme` holds global styles. Widget properties use `null` to inherit from theme (e.g., `colorScheme: null` means use `theme.colorScheme`).
- **Grid**: Uses `compactType={null}` + `preventCollision={true}` for free-placement. All 8 resize handles enabled.
- **Export/Import**: `.ytics` zip files containing `dashboard.json` (full dashboard object with pages, layout, theme, model positions) and dataset CSVs. Export is enabled whenever there are datasets or widgets (either suffices).
- **Data Model**: Interactive ER diagram in the Data tab. Relationships auto-detected by matching column names across datasets (cardinality: 1:1, 1:N, N:1, M:N). Table card positions stored in `dashboard.modelPositions` and persisted across tab switches, localStorage saves, and `.ytics` export/import. Selection-aware coloring: dark blue = selected table, light blue = directly related, gray = other.
- **Number formatting**: `NUMBER_FORMATS` registry in `chartHelpers.js` — `auto`, `number`, `si`, `scientific`, `currency`, `percent`. Applied via `formatValue(v, format)`. Per-measure `numberFormat` overrides widget-level `numberFormat`.
- **Multi-measure mode**: Charts supporting multiple measures store them in `*ChartMeasures[]` arrays (e.g., `lineChartMeasures`, `barChartMeasures`, `straightTableMeasures`). Each measure object: `{ field, aggregation, label, numberFormat }`. The primary measure uses the widget's top-level `yField`/`aggregation`/`numberFormat`.
- **Aggregation modifiers**: `distinct` (count unique values) and `total` (grand total across all groups) can be combined with aggregations. Stored as `aggregation: 'distinct_count'`, `'total_sum'`, etc.
- **Combo chart dual formatting**: `widget.numberFormat` for primary Y-axis, `widget.y2NumberFormat` for secondary Y-axis.
- **Line chart x-axis spacing**: `widget.xAxisSpacing` — `'equal'` (default, scalePoint) or `'linear'` (proportional, scaleLinear/scaleTime).
- **Correlogram**: `widget.correlogramFields[]` (array of field names, numeric or categorical). `widget.correlogramMode`: `'circles'` (default), `'scatter'` (mini plots), `'text'`. Mixed-type support: Pearson r (numeric×numeric, diverging RdBu scale), Eta η correlation ratio (numeric×categorical, sequential Oranges scale), Cramér's V via chi-squared (categorical×categorical, sequential Oranges scale). Auto-detects column types. Diagonal: histograms (numeric) or horizontal bar charts (categorical). Cell visualizations adapt per pair type: scatter → scatterplot/strip-plot/mini-heatmap; circles → sized by |value|, colored by appropriate scale. Dual legends for signed (Pearson) and unsigned (η/V) statistics.
- **Density chart**: 2D KDE via `d3.contourDensity()`. `widget.densityMode`: `'shading'` (default), `'hexbin'`, `'histogram'`. `widget.densityFilled` (boolean, default true): fill toggle — contour lines always visible in shading mode. `widget.densityColorMode`: `'auto'` (default), `'palette'`, `'analog'` (nearby hues, any N), `'complementary'` (opposite hues, any N), `'cmy'` (3 series). `widget.densityBandwidth` (smoothing, default 30), `widget.densityThresholds` (contour levels, default 10), `widget.densityShowPoints` (dot overlay). `widget.densityLegendPosition`: `'top'`, `'bottom'` (default), `'hidden'`. Multi-series uses `mix-blend-mode: multiply` for CMYK-like subtractive color mixing from white (≤3 series). Single series uses sequential gradient scale.
- **Connected scatterplot**: `widget.connectPoints` (boolean) enables lines between scatter points. `widget.connectionStrategy` controls ordering: `'x'` (by X value), `'y'` (by Y value), `'trendline'` (projection onto regression line), `'angle'` (greedy minimum turning angle), `'field'` (by `widget.connectionOrderField`, e.g. date). Per-category lines when `colorField` is set. `widget.connectionWidth` and `widget.connectionOpacity` for styling.

### Commands

- `npm start` — Dev server on port 3000
- `npm run build` — Production build
- `npm test` — Run tests
