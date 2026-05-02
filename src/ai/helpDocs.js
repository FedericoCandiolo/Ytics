// ── Help Documentation for AI ────────────────────────────────────────────────
// Searchable plain-text help sections. Used by the lookup_help tool.

export const HELP_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    content: `Your First Dashboard in 3 Steps:
1. Upload data - Click the Data tab in the sidebar, then drag a CSV, Excel, or JSON file onto the drop zone (or create an inline table).
2. Add a chart - Switch to the Dashboard tab, then click or drag a chart type onto the canvas.
3. Map your fields - Click the widget to open its editor, pick your dataset, and assign columns to the X and Y axes.`,
  },
  {
    id: 'interface',
    title: 'The Interface',
    content: `Header Bar: Dashboard title (click to rename), Developer/Viewer toggle, Open (.ytics file), Save (export as .ytics).
Developer Mode Layout: Left sidebar (dashboard styles, chart type picker, widget list on Dashboard tab; dataset management on Data tab), Center canvas (24-column grid with free placement), Right panel (widget editor when a widget is selected).
Viewer Mode Layout: Top bar (filter controls, widget search), Full canvas (read-only presentation with interactive filtering).`,
  },
  {
    id: 'loading-data',
    title: 'Loading Data',
    content: `Supported formats: CSV (.csv, drag-and-drop, auto-detected types), Excel (.xlsx/.xls/.xlsb/.xlsm/.ods, import wizard with sheet selection), JSON (.json, arrays of objects or nested, preview wizard).
Excel Import Wizard: 1) Select sheets, 2) Configure per-sheet (name, skip rows, header row), 3) Preview first 5 rows, 4) Import.
Inline Tables: Click "+ Inline Table" to create manually. Click headers to rename. Paste from Excel/Sheets supported. Tab to navigate, Enter to move down.
Column Types: auto-detected - number, date, boolean, string. Change type by clicking the type badge in Data Preview.
Multiple Datasets: Each widget independently selects its dataset, so one dashboard can combine multiple sources.`,
  },
  {
    id: 'data-model',
    title: 'Data Model',
    content: `Switch to the Model tab to see an interactive ER diagram of all datasets and relationships.
Auto-detected relationships: matches column names across datasets.
Selection-aware coloring: click a table card to highlight it (dark blue = selected, light blue = related, gray = other).
Draggable layout: positions preserved across tabs, saved to localStorage, included in .ytics exports.
Relationship lines: curved lines with field name labels.
Data preview: click the preview button on any table card to see its first rows.`,
  },
  {
    id: 'data-transforms',
    title: 'Data Transforms',
    content: `Transforms modify a dataset in place before any widget uses it. Applied in order, top to bottom.
Filter Rows: remove rows not matching a condition (=, !=, >, <, >=, <=, contains, not contains, is null, is not null).
Rename Column: change name without altering data.
Computed Column: new column using JavaScript expression. All column names available as variables. Example: gdp_per_capita = gdp / population.
Sort: reorder rows by a column, ascending or descending.
Cast (Change Type): convert column type (string, number, date, boolean). To number strips currency symbols. To date parses ISO. To boolean recognizes "true"/"yes"/"1"/"on".`,
  },
  {
    id: 'data-pipeline',
    title: 'Interactive Pipeline',
    content: `The Pipeline tab gives a visual step-by-step view of all transforms.
Click any step to inspect intermediate data. Click Step 0 for original data.
Enable/Disable: checkbox toggle to skip a step without deleting.
Reorder: arrow buttons to move steps up/down (order matters).
Edit: inline form for modifying step parameters.
Delete: X button to remove a step.`,
  },
  {
    id: 'table-joins',
    title: 'Table Joins',
    content: `The Join tab lets you combine two tables based on a shared column.
1. Select left and right tables. 2. Pick join field (auto-detected). 3. Choose join type.
Inner: only matching rows. Left: all left rows + matching right. Right: all right rows + matching left. Full: all rows from both.
Duplicate column names are prefixed with "right_".`,
  },
  {
    id: 'building',
    title: 'Building a Dashboard',
    content: `Adding Widgets: Dashboard tab sidebar has Chart types grid with 26+ types. Click to add, or drag onto canvas for precise placement.
Moving & Resizing: drag the header to move, drag any of 8 handles to resize. 24-column grid with free placement.
Widget Actions: Maximize (full-screen), Duplicate (copy), Move to Page, Remove (delete).
Changing Chart Type: drag a chart type from sidebar onto existing widget to replace type (field mappings preserved where possible).`,
  },
  {
    id: 'chart-types',
    title: 'Chart Types Reference',
    content: `Available chart types:
- Bar Chart: categorical comparison, vertical/horizontal, stacked/grouped, multi-measure
- Box Plot: statistical distribution (quartiles, median, whiskers, outliers)
- Bubble Chart: sized circles on X/Y with optional color
- Bump Chart: rank changes over time, top-N support
- Carousel: cycles through multiple chart slides
- Combo Chart: bars + lines on dual axes
- Correlogram: correlation matrix (Pearson r, Eta, Cramer's V)
- Data Table: tabular display with conditional formatting
- Density Chart: 2D KDE with shading/contour/hexbin/histogram modes
- Funnel Chart: sequential stages with drop-off
- Geo Map: choropleth world map
- Graph Chart: force-directed node-link diagram
- Heat Map: color matrix across two dimensions
- Histogram: distribution of a numeric variable
- KPI Card: card/gauge/satellite styles
- Line Chart: trends with multi-measure, proportional spacing
- Mekko Chart: variable-width stacked bars
- Network Chart: hierarchical tree layout
- Pie/Donut: proportional slices
- Pivot Table: cross-tabulation
- Radar Chart: multi-axis spider chart
- Sankey Diagram: flow diagram
- Scatter Plot: X/Y points with connected mode, trend lines
- Straight Table: flat table with measures
- Stream Graph: flowing stacked areas
- Treemap: hierarchical rectangles
- Violin Plot: KDE + box plot
- Waffle Chart: proportional 10x10 grid
- Waterfall Chart: cumulative positive/negative values
- Word Cloud: text sized by frequency/measure`,
  },
  {
    id: 'configuring',
    title: 'Configuring Widgets',
    content: `Click any widget to open its editor. Organized into tabs:
Fields Tab: map data columns to visual channels. Aggregation options: sum, count, mean, min, max, median, std, p25/p75/p90/p95.
Aesthetics Tab: title, color scheme (inherit or override), grid lines, legend, opacity (20-100%), background color, corner radius.
Options Tab: chart-specific settings (orientation, bar mode, sort, line type, bin count, dot sizes, trend lines, connected scatter, etc.).
Colors Tab: categorical vs gradient mode, palette selection, gradient schemes, custom gradient field, dimension colors for cross-chart consistency.`,
  },
  {
    id: 'number-format',
    title: 'Number Formatting',
    content: `Formats: Auto (default), Number (1,234.50), SI (1.2k), Scientific (1.23e+3), Currency ($1,234.50), Percent (12.35%).
Per-Measure Formatting: each measure in multi-measure charts can have its own format.
Combo Chart: separate primary and secondary number format for dual axes.
Aggregation Modifiers: Distinct (unique values only), Total (grand total ignoring groups). Can combine: "distinct total count".`,
  },
  {
    id: 'multi-measure',
    title: 'Multi-Measure Mode',
    content: `Supported by Straight Table (columns), Line Chart (multiple lines), Bar Chart (stacked/grouped groups).
Adding: Fields tab > Additional measures > + Add measure. Pick field, aggregation, label, number format.
Multi-Measure vs Group Field: Group/Color splits ONE measure by dimension. Multi-measure plots DIFFERENT fields on same axis. Mutually exclusive for Line/Bar.
Line Chart X-Axis Spacing: Equally spaced (default, categorical) or Proportional to value (numeric distance).`,
  },
  {
    id: 'measure-pipeline',
    title: 'Measure Pipeline',
    content: `Transforms data before it reaches the chart, without modifying the original dataset. Per-widget in the Measures tab.
Steps: Group & Aggregate (group by columns + aggregation), Top/Bottom N (optionally per group), Filter (condition-based), Compute Column (JS expression), Sort (field + direction).
Controls: add (+), reorder (arrows), delete (X). Each step shows column/row count preview.`,
  },
  {
    id: 'colors',
    title: 'Colors & Styling',
    content: `Color Modes: Categorical (distinct color per value) or Gradient (continuous scale from numeric measure).
Palettes (15): Vivid, Spectrum, Muted, Soft, Pastel, Contrast, Duo, Bold, Blues, Greens, Reds, Purples, Oranges, Warm>Cool, Brown>Green.
Gradients (13): Blues, Greens, Reds, Purples, Oranges, Warm>Cool, Brown>Green, Viridis, Plasma, Inferno, Turbo, Spectral.
Custom gradient field: color by a different numeric column than the chart's value.
Dimension Colors: pin specific values to consistent colors across all charts. Custom hex or palette-relative.`,
  },
  {
    id: 'conditional-fmt',
    title: 'Conditional Formatting',
    content: `For Data Table and Pivot Table. Found in Colors tab.
Gradient Mode: continuous color scale from min to max. Auto text color for readability.
Rules Mode: conditions (>, >=, <, <=, ==, !=, contains) with background and text color. First matching condition wins. Multiple conditions per rule.`,
  },
  {
    id: 'themes',
    title: 'Dashboard Themes',
    content: `Global settings in Dashboard Styles sidebar section.
Settings: Font size (10-18px), Canvas color, Card color, Border radius (0-20px), Card shadow (none/sm/md/lg), Color scheme (15 palettes).
Theme Inheritance: widgets inherit from dashboard theme. Override per-widget in Aesthetics tab (color scheme, background, border radius).`,
  },
  {
    id: 'multi-page',
    title: 'Multi-Page Dashboards',
    content: `Add page: + button at end of tab bar. Switch: click page tab. Rename: double-click tab. Delete: X on tab (2+ pages needed).
Moving widgets: click the move button on widget, select destination page.`,
  },
  {
    id: 'viewer-mode',
    title: 'Viewer Mode',
    content: `Presentation mode. Read-only canvas preserving developer layout including gaps.
Interactive charts: hover for tooltips, click for cross-filtering.
Selection panel: add panes for any field, pick values to filter across all charts.
Page navigation: arrows and tab bar for multi-page dashboards.
Maximize: click expand button for full-screen view.`,
  },
  {
    id: 'filtering',
    title: 'Filtering & Cross-Filtering',
    content: `Selection Panes: click "+ Selection" in viewer top bar, choose a field, click pane to select values. Uses associative model.
Clearing: resets to "all" (pane stays visible). X button removes pane entirely. "Clear all" resets all panes.
Cross-Filtering: click any chart element to create/toggle selection. Works across widgets sharing same or related datasets.
Selection Undo/Redo: Ctrl+Z / Ctrl+Y (separate from developer undo history).`,
  },
  {
    id: 'export-import',
    title: 'Export & Import',
    content: `.ytics file (ZIP) contains: dashboard.json (full config including pages, widgets, layouts, theme, dimension colors, model positions, selection fields), data/*.csv (each dataset), README.md (summary).
Selection pane fields are preserved. Export enabled with at least one dataset or widget.
Import: select .ytics or .zip file, restores everything, switches to Viewer mode.`,
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    content: `Ctrl+Z: Developer=undo dashboard change, Viewer=undo filter change.
Ctrl+Y or Ctrl+Shift+Z: Developer=redo, Viewer=redo filter.
Mac: use Cmd instead of Ctrl. Disabled when text input is focused. Up to 50 undo states.`,
  },
  {
    id: 'ml-analytics',
    title: 'ML Analytics & Clustering',
    content: `Clustering: groups rows by numeric fields. Two algorithms:
K-Means: partitions into k clusters. K-Means++ initialization. Auto-detect k via elbow method (tests k=1-10). Best for spherical clusters.
DBSCAN: density-based, auto-discovers clusters and outliers ("Noise"). Auto-detect epsilon via k-distance knee. Best for irregular shapes.
How to: Data tab > Analytics tab > choose algorithm > select numeric fields (auto-normalized) > configure > Run.
Result: new column (_cluster) with labels like "Cluster 1", "Cluster 2", etc.
Use clusters as Color Field in scatter plots, or as category dimension in bar/pie/treemap.
Trend Lines: scatter plot and line chart. Types: Linear, Polynomial (degree 2-6), Logarithmic, Exponential. R2 shown.`,
  },
  {
    id: 'tips',
    title: 'Tips & Best Practices',
    content: `Data: clean data before upload, use clear column names, prefer tidy format (one row per observation), use inline tables for lookups, use Pipeline view to inspect transforms.
Design: start simple, use Measure Pipeline instead of modifying source, leverage theme inheritance, pin dimension colors for consistency.
Performance: 100k+ rows - pre-aggregate or filter. Keep 10-15 widgets per page.
Colors: categorical data -> categorical palette, sequential -> gradient, diverging -> Warm>Cool or Brown>Green. Muted/Contrast palettes for accessibility.`,
  },
];

// Search help sections by query (case-insensitive, matches title and content)
export function searchHelp(query) {
  if (!query?.trim()) return HELP_SECTIONS.map(s => ({ id: s.id, title: s.title }));
  const terms = query.toLowerCase().split(/\s+/);
  return HELP_SECTIONS
    .map(s => {
      const text = (s.title + ' ' + s.content).toLowerCase();
      const score = terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0);
      return { ...s, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
