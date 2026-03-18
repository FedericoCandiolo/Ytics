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
- `src/components/Developer/` — Developer mode: `DeveloperMode.js`, `DashboardBuilder.js` (grid canvas + sidebar), `WidgetEditor.js` (per-widget config), `DataIntegration.js` (dataset management).
- `src/components/Viewer/` — Viewer mode: `ViewerMode.js`, `FilterPanel.js`.
- `src/components/Widgets/` — Chart components: `BarChart`, `LineChart`, `ScatterPlot`, `PieChart`, `Histogram`, `DataTable`, `Treemap`, `HeatMap`, `BumpChart`, `StreamGraph`, `ViolinPlot`, `Carousel`, `WidgetContainer` (wrapper).
- `src/utils/` — `colorUtils.js` (palette registry), `dataUtils.js` (transforms, filters, aggregations), `exportUtils.js` (zip export/import), `columnStore.js` (in-memory columnar store).

### Key Patterns

- **Dashboard state**: `state.dashboard.pages[]` — each page has `widgets[]` and `layout[]`. Widgets reference datasets by `datasetId`.
- **Theme inheritance**: `dashboard.theme` holds global styles. Widget properties use `null` to inherit from theme (e.g., `colorScheme: null` means use `theme.colorScheme`).
- **Grid**: Uses `compactType={null}` + `preventCollision={true}` for free-placement. All 8 resize handles enabled.
- **Export/Import**: `.ytics` zip files containing `dashboard.json` (full dashboard object with pages, layout, theme) and dataset CSVs.

### Commands

- `npm start` — Dev server on port 3000
- `npm run build` — Production build
- `npm test` — Run tests
