# ytics

A React 19 dashboard builder for data analytics and visualization. Build interactive dashboards with drag-and-drop widgets, connect datasets, and share via exportable `.ytics` files.

## Features

- **Developer Mode** — Design dashboards with a drag-and-drop grid canvas, per-widget configuration, and dataset management
- **Viewer Mode** — Interact with dashboards using cross-filtering, global filters, and responsive layouts
- **30+ Widget Types** — Bar, Line, Scatter, Pie, Histogram, Combo, Bubble, Bump, Stream, Violin, Box Plot, Radar, Sankey, Funnel, Waterfall, Waffle, Mekko, Treemap, HeatMap, GeoMap, Word Cloud, KPI Card (gauge & satellite), Data Table, Straight Table, Pivot Table, Carousel
- **Theming** — Dashboard-level themes with per-widget overrides, categorical palettes, gradient color modes, and invert options
- **Export/Import** — `.ytics` zip files containing dashboard configuration and dataset CSVs
- **Multi-page dashboards** — Organize widgets across multiple pages

## Tech Stack

- React 19 (Create React App)
- react-grid-layout (free-placement grid with collision prevention)
- D3.js (all chart rendering)
- uuid (ID generation)
- Pure JavaScript with JSX (no TypeScript)

## Getting Started

```bash
npm install
npm start
```

Opens the app at [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm test` | Run tests |

## Project Structure

```
src/
├── context/AppContext.js        # Central state (useReducer)
├── components/
│   ├── Developer/               # Dashboard builder UI
│   │   ├── DashboardBuilder.js  # Grid canvas + sidebar
│   │   ├── WidgetEditor.js      # Per-widget config panel
│   │   ├── DataIntegration.js   # Dataset management
│   │   └── MeasurePipeline.js   # Measure/calculation pipeline
│   ├── Viewer/                  # Read-only dashboard view
│   │   ├── ViewerMode.js
│   │   └── FilterPanel.js
│   ├── Widgets/                 # All chart components
│   │   ├── chartHelpers.js      # Shared chart utilities
│   │   ├── useTooltip.js        # Shared tooltip hook
│   │   └── WidgetContainer.js   # Widget wrapper
│   ├── Header.js
│   └── HelpPage.js
└── utils/
    ├── colorUtils.js            # Palette registry & gradient scales
    ├── dataUtils.js             # Transforms, filters, aggregations
    ├── exportUtils.js           # .ytics zip export/import
    └── columnStore.js           # In-memory columnar store
```
