# Ytics User Guide

**Ytics** is an interactive dashboard builder for data analytics and visualization. Upload your data, build multi-page dashboards with 18 chart types, apply transforms and filters, customize colors and styles, and share your work as portable `.ytics` files.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [The Interface](#2-the-interface)
3. [Loading Data](#3-loading-data)
4. [Data Transforms](#4-data-transforms)
5. [Building a Dashboard](#5-building-a-dashboard)
6. [Chart Types Reference](#6-chart-types-reference)
7. [Configuring Widgets](#7-configuring-widgets)
8. [Measure Pipeline](#8-measure-pipeline)
9. [Colors and Styling](#9-colors-and-styling)
10. [Conditional Formatting](#10-conditional-formatting)
11. [Dashboard Themes](#11-dashboard-themes)
12. [Multi-Page Dashboards](#12-multi-page-dashboards)
13. [Viewer Mode](#13-viewer-mode)
14. [Filtering and Cross-Filtering](#14-filtering-and-cross-filtering)
15. [Export and Import](#15-export-and-import)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Tips and Best Practices](#17-tips-and-best-practices)

---

## 1. Getting Started

### Launching Ytics

```bash
npm start
```

Open your browser at `http://localhost:3000`. You will see the Ytics interface in **Developer mode** — the workspace where you build dashboards.

### Your First Dashboard in 3 Steps

1. **Upload data** — Click the **Data** tab in the sidebar, then drag a CSV file onto the drop zone.
2. **Add a chart** — Switch to the **Dashboard** tab, then click or drag a chart type (e.g., Bar Chart) onto the canvas.
3. **Map your fields** — Click the widget to open its editor, pick your dataset, and assign columns to the X and Y axes.

That's it — your first visualization is live.

---

## 2. The Interface

### Header Bar

| Element | Description |
|---|---|
| **Dashboard title** | Click the title text to rename your dashboard. |
| **Developer / Viewer** | Toggle between build mode and presentation mode. |
| **Import** | Load a `.ytics` file (restores dashboard + data). |
| **Export** | Save your dashboard as a `.ytics` file. |

### Developer Mode Layout

- **Left sidebar** — Dashboard styles, chart type picker, and widget list (Dashboard tab) or dataset management (Data tab).
- **Center canvas** — Your dashboard grid. Drag, resize, and arrange widgets freely.
- **Right panel** — Widget editor (appears when a widget is selected).

### Viewer Mode Layout

- **Top bar** — Filter controls, edit button, and export button.
- **Full canvas** — Read-only presentation of your dashboard with interactive filtering.

---

## 3. Loading Data

### Uploading CSV Files

1. Click the **Data** tab in the developer sidebar.
2. Drag one or more `.csv` files onto the upload area — or click to browse.
3. Ytics parses your file and auto-detects column types:
   - **number** — Numeric values (integers and decimals).
   - **date** — Recognizable date strings.
   - **string** — Everything else (text, categories).

### Dataset Management

- Each uploaded file appears as a named dataset in the left panel.
- Click a dataset to select it and preview its contents.
- The preview shows the first 200 rows with column headers and type badges.
- A summary line displays the total row and column counts.
- Click the **×** button to delete a dataset.

### Multiple Datasets

You can load as many datasets as you need. Each widget independently selects which dataset it visualizes, so a single dashboard can combine data from multiple sources.

---

## 4. Data Transforms

Transforms modify a dataset in place before any widget uses it. They are applied in order, top to bottom.

### Adding Transforms

In the Data tab, with a dataset selected, use the **Add Transform** form on the right side.

### Transform Types

#### Filter Rows
Remove rows that don't match a condition.
- **Field**: The column to check.
- **Operator**: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `not contains`, `is null`, `is not null`.
- **Value**: The comparison value (omitted for null checks).

*Example: Keep only rows where `country = "Argentina"`.*

#### Rename Column
Change a column's name without altering its data.
- **Column**: The column to rename.
- **New name**: The desired name.

*Example: Rename `pop_est` to `Population`.*

#### Computed Column
Create a new column using a JavaScript expression. All existing column names are available as variables.
- **New column name**: The name for the calculated column.
- **Expression**: A JavaScript expression referencing column names.

*Example: Name: `gdp_per_capita`, Expression: `gdp / population`.*

#### Sort
Reorder all rows by a column.
- **Field**: The column to sort by.
- **Direction**: Ascending or descending.

### Managing Transforms
- Transforms are listed in order with type badges and descriptions.
- Click **×** on any transform to remove it.
- Transforms are saved with the dashboard when you export.

---

## 5. Building a Dashboard

### Adding Widgets

In the **Dashboard** tab of the sidebar, you'll find the **Chart types** grid with 18 visualization types, sorted alphabetically:

| Icon | Type |
|---|---|
| 📊 | Bar Chart |
| 📦 | Box Plot |
| 🏅 | Bump Chart |
| 🎠 | Carousel |
| 🔢 | Data Table |
| 🌍 | Geo Map |
| 🌡 | Heat Map |
| ▬ | Histogram |
| 📈 | Line Chart |
| 🥧 | Pie / Donut |
| ⊞ | Pivot Table |
| 🕸 | Radar Chart |
| 🔀 | Sankey |
| ⬤ | Scatter |
| 〰 | Stream Graph |
| ⬛ | Treemap |
| 🎻 | Violin Plot |
| 🧇 | Waffle Chart |

**Two ways to add:**
- **Click** a chart type button to add it to the canvas.
- **Drag** a chart type onto the canvas to place it precisely.

### Moving and Resizing

- **Drag** the widget header bar to move it.
- **Resize** by dragging any of the 8 handles (corners and edges).
- The canvas uses a **24-column grid** with free placement — widgets can be positioned anywhere without auto-compacting.

### Widget Actions

Click the action buttons in a widget's top-right corner:

| Button | Action |
|---|---|
| ⤢ | **Maximize** — Full-screen view of the widget. |
| ⧉ | **Duplicate** — Create a copy of the widget and its configuration. |
| ⇱ | **Move to Page** — Move the widget to a different page (multi-page dashboards). |
| ✕ | **Remove** — Delete the widget (with confirmation). |

### Changing Chart Type

Drag a chart type from the sidebar onto an existing widget to replace its type. Ytics will ask for confirmation and preserve your field mappings where possible.

---

## 6. Chart Types Reference

### Bar Chart
Compares categorical values with vertical or horizontal bars.

- **Required fields**: Category (X), Numeric (Y).
- **Optional**: Group field (enables grouped or stacked bars).
- **Options**: Orientation (vertical/horizontal), bar mode (stacked/grouped), sort by (value/label), sort order (ascending/descending).
- **Color modes**: Categorical (one color per category), Gradient (color intensity by value).

### Box Plot
Displays statistical distribution for each category: quartiles, median, mean, whiskers, and outliers.

- **Required fields**: Category (X), Numeric (Y).
- **Shows**: Median line, mean diamond, IQR box, whiskers (1.5× IQR), outlier circles.
- **Color modes**: Categorical or gradient (by median value).

### Bump Chart
Tracks rank changes across time or ordered categories.

- **Required fields**: X (time/category), Series (color field), Value (numeric — rank is derived automatically).
- **Shows**: Lines connecting rank positions, dots at each data point, final-rank labels.
- **Color modes**: Categorical or gradient (by series total value).

### Carousel
A container that cycles through multiple chart slides.

- **Configuration**: Add slides in the editor, each with its own chart type and field mapping.
- **Controls**: Previous/next arrows, dot indicators, click-to-jump.
- **Auto-play**: Optional automatic slide cycling with configurable interval (1–30 seconds).
- **Supported slide types**: Bar, Line, Scatter, Pie, Histogram, Data Table, Treemap, Heat Map, Bump Chart, Stream Graph, Violin Plot.

### Data Table
Tabular display of raw or aggregated data with conditional formatting.

- **Features**: Column sorting, scrollable rows, formatted numeric values.
- **Conditional formatting**: Per-column gradient coloring or rule-based cell styling (see [Conditional Formatting](#10-conditional-formatting)).

### Geo Map
Choropleth world map colored by a numeric value per country.

- **Required fields**: Geography (country name), Value (numeric).
- **Projections**: Natural Earth (default), Mercator, Equal Earth, Orthographic.
- **Color**: Sequential gradient linked to the dashboard palette. Includes a legend bar showing the value range.
- **Matching**: Handles common country name aliases (e.g., "USA" → "United States of America", "UK" → "United Kingdom").

### Heat Map
Color matrix showing intensity across two categorical dimensions.

- **Required fields**: X (row category), Y (column category), Value (numeric intensity).
- **Color**: Sequential gradient with a legend bar. Automatically uses the palette-linked gradient.

### Histogram
Distribution of a single numeric variable, with statistical annotations.

- **Required field**: X (numeric).
- **Options**: Number of bins (1–100, default 20).
- **Shows**: Bin bars, mean line (blue dashed), median line (green dashed), normal distribution curve, statistics panel (n, μ, σ).
- **Color modes**: Single primary color or gradient (color intensity by bin count).

### Line Chart
Plots trends over a continuous or categorical X-axis.

- **Required fields**: X, Y (numeric).
- **Optional**: Color field (for multi-series lines).
- **Options**:
  - **Line type**: Linear, Monotone, Step, Step Before, Step After, Cardinal.
  - **Show points**: Toggle data point markers.
  - **Show area**: Fill the area under the line.
  - **Stack mode** (multi-series + area): None, Stacked, Percent (100% stacked).
- **Features**: Hover crosshair with multi-series tooltip, animated line drawing.
- **Auto-detects X-axis type**: Numeric, date, or categorical.
- **Color modes**: Categorical or gradient (by series total).

### Pie / Donut
Proportional slices of a whole.

- **Required fields**: Label (category), Value (numeric).
- **Options**:
  - **Inner radius**: 0% = full pie, 1–100% = donut with adjustable hole size.
  - **Sort by value**: Arrange slices largest-first.
- **Features**: Percentage labels on larger slices, center total for donut mode, hover expansion.
- **Color modes**: Categorical or gradient (by slice value).

### Pivot Table
Cross-tabulation of data with row and column dimensions.

- **Required field**: Value (numeric).
- **Optional**: Row fields (one or more), Column fields (one or more).
- **Aggregation**: Same options as other charts (sum, count, mean, etc.).
- **Conditional formatting**: Same as Data Table.

### Radar Chart
Multi-axis spider/web chart comparing entities across dimensions.

- **Required fields**: Axis (categories forming the polygon axes), Value (numeric).
- **Optional**: Color field (for overlaying multiple series).
- **Features**: Grid circles with value labels, series polygons with fill and stroke.
- **Note**: Requires at least 3 axis categories.
- **Color modes**: Categorical or gradient (by series total value).

### Sankey Diagram
Flow diagram showing connections between source and target nodes.

- **Required fields**: Source, Target, Value (numeric flow amount).
- **Features**: Proportional link widths, node labels, hover tooltips with inflow/outflow.
- **Color modes**: Categorical (by node) or gradient (by max flow volume).

### Scatter Plot
Plots individual data points on X/Y coordinates.

- **Required fields**: X (numeric), Y (numeric).
- **Optional**: Color field (categorical grouping), Size field (numeric — bubble chart).
- **Options**: Dot size min/max (4–20px).
- **Features**: Regression line (auto-calculated), size encoding for bubble charts.
- **Color modes**: Categorical, single-color (no color field), or gradient (by Y or custom numeric field).

### Stream Graph
Flowing stacked areas showing composition over time.

- **Required fields**: X (time/category), Series (color field), Value (numeric).
- **Features**: Smooth curves with wiggle offset for aesthetic flow, series labels at widest point, hover-to-highlight.
- **Color modes**: Categorical or gradient (by series total).

### Treemap
Hierarchical rectangles sized by value.

- **Required fields**: Label (category), Value (numeric).
- **Optional**: Group field (adds a parent level for nested hierarchy).
- **Features**: Labels on large-enough rectangles, parent group headers, animated reveal.
- **Color modes**: Categorical (by group or label) or gradient (by leaf node value).

### Violin Plot
Distribution shape (kernel density) with embedded box plot for each category.

- **Required fields**: Category (X), Numeric (Y).
- **Shows**: KDE-smoothed density shape, IQR box overlay, median line, whiskers.
- **Tooltip**: n, Mean, Median, Std dev, Q1, Q3, IQR.
- **Color modes**: Categorical or gradient (by median value).

### Waffle Chart
Proportional grid of 100 squares (10×10) showing category shares.

- **Required fields**: Label (category), Value (numeric).
- **Features**: Bottom-up fill, hover per cell, legend with percentages.
- **Color modes**: Categorical or gradient (by category value).

---

## 7. Configuring Widgets

Click any widget on the canvas to open its editor panel on the right. The editor is organized into tabs.

### Fields Tab

Map your data columns to the chart's visual channels.

- **Field selectors** show a dropdown of available columns, filtered by type (e.g., numeric fields only for Y-axis).
- Fields marked with a red **\*** are required.
- Select `— none —` to clear a field.

**Aggregation** determines how multiple values for the same category are combined:

| Aggregation | Description |
|---|---|
| `sum` | Total of all values (default). |
| `count` | Number of records. |
| `mean` | Average value. |
| `min` | Smallest value. |
| `max` | Largest value. |
| `median` | Middle value (50th percentile). |
| `std` | Standard deviation. |
| `p25` | 25th percentile. |
| `p75` | 75th percentile. |
| `p90` | 90th percentile. |
| `p95` | 95th percentile. |

### Measures Tab

Available when a measure pipeline is configured. Opens the pipeline editor — see [Measure Pipeline](#8-measure-pipeline).

### Colors Tab

All color configuration for the widget — see [Colors and Styling](#9-colors-and-styling).

### Aesthetics Tab

| Setting | Description |
|---|---|
| **Title** | The widget's display name. |
| **Color scheme** | Override the dashboard palette for this widget, or inherit from the theme. |
| **Show grid lines** | Toggle background grid. |
| **Show legend** | Toggle the color legend. |
| **Opacity** | Transparency slider from 20% to 100%. |
| **Background color** | Use the theme default or pick a custom card background. |
| **Corner radius** | Inherit from theme or set a custom value (0–20px). |

### Options Tab

Chart-specific settings. Examples:

- **Bar Chart**: Orientation, bar mode, sort by, sort order.
- **Line Chart**: Line type, show points, show area, stack mode.
- **Pie Chart**: Inner radius (donut hole size).
- **Histogram**: Number of bins.
- **Scatter Plot**: Dot size min/max.
- **Geo Map**: Map projection.
- **Carousel**: Auto-play toggle, interval.

---

## 8. Measure Pipeline

The measure pipeline is a powerful feature that lets you transform data before it reaches the chart, without modifying the original dataset.

### Accessing the Pipeline

1. Open a widget's editor.
2. Go to the **Fields** or **Measures** tab.
3. Click the **Measure Pipeline** button.

### Pipeline Steps

Steps execute top-to-bottom. Each step receives the output of the previous step.

#### Group & Aggregate
Groups rows by one or more columns and applies aggregation functions.

- **Group by**: Select one or more columns to group on.
- **Aggregations**: Add multiple aggregations, each with:
  - **Function**: sum, count, mean, min, max, median, std, p25, p75, p90, p95.
  - **Field**: The column to aggregate (not needed for `count`).
  - **Output name** (optional): Custom name for the resulting column.
- The output indicator shows the resulting columns and row count.

*Example: Group by `country`, aggregate `revenue` as sum and `orders` as count.*

#### Top / Bottom N
Keeps only the top or bottom N rows.

- **N**: Number of rows to keep.
- **Order by**: The numeric column to rank by.
- **Direction**: Top (highest first) or Bottom (lowest first).
- **Per group** (optional): Apply the top-N within each group rather than globally.

*Example: Top 10 countries by revenue.*

#### Filter
Removes rows that don't match a condition.

- **Column**: The field to check.
- **Operator**: =, !=, >, <, >=, <=, contains, not contains, is null, is not null.
- **Value**: The comparison target.

*Example: Keep rows where `year >= 2020`.*

#### Compute Column
Creates a new calculated column.

- **Name**: The new column's name.
- **Expression**: A JavaScript expression using existing column names as variables.

*Example: `profit_margin = (revenue - cost) / revenue * 100`.*

#### Sort
Reorders rows.

- **Field**: The column to sort by.
- **Direction**: Ascending or descending.

### Pipeline UI Controls

- **Add step**: Click the `+` button for the step type you need.
- **Reorder**: Use the ↑/↓ buttons on each step to move it up or down.
- **Delete**: Click **×** to remove a step.
- **Preview**: Each step shows an output indicator with column count and row count. Click to preview a sample of the output.

---

## 9. Colors and Styling

### Color Mode

Every chart supports two color modes, selectable in the **Colors** tab:

#### Categorical Mode (default)
Each dimension value (e.g., each country, each product category) gets a distinct color from the palette. This is the standard approach for most charts.

#### Gradient Mode
Values are mapped to a continuous color gradient based on a numeric measure. Instead of distinct colors, you see a smooth spectrum from low to high values.

**What the gradient maps to depends on the chart type:**

| Chart Type | Gradient Basis |
|---|---|
| Bar Chart | Bar value (Y field) |
| Pie / Donut | Slice value |
| Treemap | Leaf node value |
| Waffle Chart | Category value |
| Histogram | Bin count |
| Box Plot | Median per category |
| Violin Plot | Median per category |
| Scatter Plot | Y value (or custom field) |
| Line Chart | Series total |
| Bump Chart | Series total |
| Stream Graph | Series total |
| Radar Chart | Series total |
| Sankey | Max flow (inflow or outflow) per node |
| Heat Map | Cell value (always sequential) |
| Geo Map | Country value (always sequential) |

### Palette-Linked Gradients

When you switch to gradient mode, Ytics automatically selects a gradient that matches your current color palette:

| Palette | Default Gradient |
|---|---|
| Vivid | Turbo |
| Spectrum | Spectral |
| Muted | Viridis |
| Soft | Plasma |
| Pastel | Blues |
| Contrast | Inferno |
| Duo | Warm → Cool |
| Bold | Turbo |
| Blues | Blues |
| Greens | Greens |
| Reds | Reds |
| Purples | Purples |
| Oranges | Oranges |
| Warm → Cool | Warm → Cool |
| Brown → Green | Brown → Green |

**Override the gradient**: Check "Override gradient" in the Colors tab to pick a different gradient scheme independently of the palette.

### Custom Gradient Field

By default, the gradient is driven by the chart's primary value field. You can select a different numeric column under **Color by field** in the Colors tab to drive the color independently of the displayed value.

*Example: A bar chart showing revenue per country, but colored by population.*

### Available Gradient Schemes (13)

| Key | Description |
|---|---|
| Blues | Light → dark blue |
| Greens | Light → dark green |
| Reds | Light → dark red |
| Purples | Light → dark purple |
| Oranges | Light → dark orange |
| Warm → Cool | Red → Yellow → Blue (diverging) |
| Brown → Green | Brown → Green (diverging) |
| Viridis | Purple → teal → yellow |
| Plasma | Purple → pink → yellow |
| Inferno | Black → red → yellow |
| Turbo | Blue → green → yellow → red |
| Spectral | Red → yellow → blue (diverging) |

### Color Palettes (15)

Palettes are used in categorical mode. Each palette is a curated set of distinct colors.

**Categorical Palettes (8):**

| Palette | Style |
|---|---|
| Vivid | Tableau10 — bold, high-contrast colors |
| Spectrum | Category10 — classic D3 color set |
| Muted | Set2 — desaturated, gentle tones |
| Soft | Set3 — light pastel-like variety |
| Pastel | Pastel1 — very soft pastels |
| Contrast | Dark2 — deep saturated tones |
| Duo | Paired — pairs of light/dark variants |
| Bold | Accent — strong accent colors |

**Sequential Palettes (5):**
Blues, Greens, Reds, Purples, Oranges — 9-step single-hue ramps, also usable as categorical palettes.

**Diverging Palettes (2):**
Warm → Cool (Red-Yellow-Blue), Brown → Green — 9-step diverging ramps.

### Dimension Colors (Cross-Chart Consistency)

Pin specific dimension values to consistent colors across all visualizations on the dashboard.

Found in the **Colors** tab under **Dimension Colors**:

1. The section lists all unique values from the chart's category dimension.
2. For each value, you can:
   - **Set a custom hex color** using the color picker — this color stays fixed regardless of palette changes.
   - **Set a palette-relative color** by choosing an index in the current palette — the color updates when the palette changes.
3. Click **Reset** to remove a dimension color override and revert to automatic assignment.

*Example: Pin "Argentina" to light blue (#74b9ff) so it appears the same shade in every chart, even when other charts use different palettes.*

Dimension colors are stored at the **dashboard level**, so they apply across all widgets.

---

## 10. Conditional Formatting

Available for **Data Table** and **Pivot Table** widgets. Found in the Colors tab.

### Adding Rules

Click **+ Add formatting** to create a new rule, then configure:

1. **Column**: Which column the formatting applies to.
2. **Mode**:

#### Gradient Mode
Colors cells on a continuous scale based on the column's numeric range.
- Select a gradient scheme (same 13 options as chart gradients).
- Cells are colored from the column's minimum to maximum value.
- Text color automatically adjusts (black or white) for readability.

#### Rules Mode
Color cells based on specific conditions.
- **Add conditions** with:
  - **Operator**: `>`, `>=`, `<`, `<=`, `==`, `!=`, `contains`.
  - **Value**: The comparison target.
  - **Background color**: The cell's background when the condition is met.
  - **Text color**: The cell's text color when the condition is met.
- Multiple conditions can be added per rule; the first matching condition wins.

*Example: Color the "Status" column — green background for "Active", red for "Inactive".*

*Example: Color the "Revenue" column with a Blues gradient so low values are light and high values are dark.*

---

## 11. Dashboard Themes

Global visual settings that apply to all widgets (unless overridden per-widget).

### Theme Settings

Found in the **Dashboard Styles** section of the developer sidebar:

| Setting | Options | Default |
|---|---|---|
| **Font size** | 10–18px slider | 13px |
| **Canvas color** | Color picker | `#f1f5f9` |
| **Card color** | Color picker | `#ffffff` |
| **Border radius** | 0–20px slider | 8px |
| **Card shadow** | None, Small, Medium, Large | Medium |
| **Color scheme** | Any of the 15 palettes | Vivid |

### Theme Inheritance

Widgets inherit from the dashboard theme by default. You can override per-widget in the Aesthetics tab:

- **Color scheme** — Set to a specific palette or leave as "Inherit from theme".
- **Background color** — Use the theme card color or pick a custom one.
- **Border radius** — Use the theme radius or set a custom value.
- **Opacity** — Per-widget (no theme-level setting).

---

## 12. Multi-Page Dashboards

Organize complex dashboards into multiple pages, like tabs in a spreadsheet.

### Managing Pages

The page navigation bar appears at the bottom of the canvas.

| Action | How |
|---|---|
| **Add page** | Click the **+** button at the end of the tab bar. |
| **Switch page** | Click any page tab. |
| **Rename page** | Double-click a page tab and type the new name. |
| **Delete page** | Click the **×** on a page tab (only available when there are 2+ pages). |

### Moving Widgets Between Pages

1. Click the **⇱** button on a widget (only visible when multiple pages exist).
2. Select the destination page from the dropdown.
3. The widget is moved to the target page, removed from the current one.

### Duplicating Widgets Across Pages

1. Duplicate the widget on the current page (⧉ button).
2. Move the duplicate to a different page.

---

## 13. Viewer Mode

Switch to Viewer mode by clicking **👁 Viewer** in the header. This is the presentation mode for consumers of your dashboard.

### Features

- **Read-only canvas** — Widgets display but cannot be moved, resized, or edited.
- **Interactive charts** — Hover for tooltips, click for cross-filtering.
- **Filter panel** — Add, modify, and remove data filters.
- **Page navigation** — Arrow buttons and tab bar for multi-page dashboards.
- **Export** — Download the current dashboard as a `.ytics` file.
- **Edit button** — Switch back to Developer mode.

### Maximizing Widgets

Click the **⤢** maximize button on any widget for a full-screen view. Click outside or press the **×** to return.

---

## 14. Filtering and Cross-Filtering

### Adding Filters (Viewer Mode)

1. Click **+ Filter** in the top bar.
2. If there are multiple datasets, select one.
3. Choose a field to filter on.
4. Configure the filter:

**Categorical Filter** (for string fields):
- Checkboxes for each unique value.
- **Search** to narrow the list.
- **All visible** — Select all values matching the search.
- **All** / **None** — Select or deselect everything.

**Range Filter** (for numeric fields):
- **Min** and **Max** input boxes.
- **Reset to full range** button to clear constraints.

### Filter Pills

Active filters appear as pills in the top bar. Each pill shows:
- The field name.
- A summary (e.g., "3 selected" or "10 – 500").
- Click **×** to remove the filter.

### Cross-Filtering

Click on any chart element (a bar, a pie slice, a scatter point, a map region, etc.) to create or toggle a filter based on that value. Cross-filters work across all widgets that share the same dataset.

*Example: Click "Argentina" on a bar chart. All other charts using the same dataset instantly filter to show Argentina's data only. Click again to remove the filter.*

### Filter Undo/Redo

- **Ctrl+Z** / **Cmd+Z** — Undo the last filter change.
- **Ctrl+Y** / **Cmd+Y** or **Ctrl+Shift+Z** / **Cmd+Shift+Z** — Redo.

Filter history is separate from developer-mode undo history.

---

## 15. Export and Import

### Exporting

Click **⬇ Export** in the header (or in the Viewer mode top bar).

Ytics saves a `.ytics` file — a ZIP archive containing:

| File | Contents |
|---|---|
| `dashboard.json` | Full dashboard configuration: pages, widgets, layouts, theme, dimension colors. |
| `data/*.csv` | A CSV export of each dataset. |
| `README.md` | A human-readable summary of the dashboard. |

The export includes everything needed to fully restore the dashboard on any Ytics instance.

### Importing

Click **⬆ Import** in the header and select a `.ytics` file (or a `.zip` file).

Ytics will:
1. Parse the dashboard configuration.
2. Reconstruct all datasets from the embedded CSVs.
3. Restore the complete dashboard state.
4. Switch to Viewer mode.

---

## 16. Keyboard Shortcuts

| Shortcut | Mode | Action |
|---|---|---|
| **Ctrl+Z** / **Cmd+Z** | Developer | Undo the last dashboard change. |
| **Ctrl+Y** / **Cmd+Y** | Developer | Redo a reverted change. |
| **Ctrl+Shift+Z** / **Cmd+Shift+Z** | Developer | Redo (alternative). |
| **Ctrl+Z** / **Cmd+Z** | Viewer | Undo the last filter change. |
| **Ctrl+Y** / **Cmd+Y** | Viewer | Redo filter change. |

Undo/redo operates independently in each mode — developer mode tracks dashboard edits (up to 50 states), while viewer mode tracks filter changes.

> **Note**: Shortcuts are disabled when a text input, dropdown, or textarea is focused.

---

## 17. Tips and Best Practices

### Data Preparation

- **Clean your CSVs** before uploading — Ytics auto-detects types, but messy data (mixed text and numbers in a "numeric" column) may be treated as strings.
- **Use clear column names** — They appear as axis labels, legend text, and field selectors throughout the UI.
- **Prefer tidy data** — One row per observation, one column per variable. Use the Measure Pipeline for reshaping when needed.

### Dashboard Design

- **Start simple** — Add one chart, get the data mapping right, then expand.
- **Use the Measure Pipeline** instead of modifying your source data — pipelines are per-widget and don't alter the dataset for other widgets.
- **Leverage theme inheritance** — Set your palette and card styles at the theme level; override per-widget only when necessary.
- **Pin dimension colors** for key values (brands, countries, product lines) so they're consistent across every chart.

### Performance

- **Large datasets**: Ytics runs entirely in the browser. For very large files (100k+ rows), consider pre-aggregating in the Measure Pipeline (Group & Aggregate) or filtering to relevant subsets.
- **Many widgets**: Each widget independently renders its chart. Keep the number of simultaneous widgets per page reasonable (10–15 is comfortable).

### Color Best Practices

- **Categorical data** → Use a categorical palette (Vivid, Spectrum, Muted, etc.).
- **Sequential/ranked data** → Use gradient mode with a single-hue gradient (Blues, Greens).
- **Diverging data** (e.g., profit/loss, above/below average) → Use Warm → Cool or Brown → Green gradients.
- **Accessibility** — The Muted and Contrast palettes work well for color-blind viewers.

### Sharing Dashboards

- Export as `.ytics` to share complete dashboards with data included.
- Recipients import the file and get an identical dashboard — no setup required.
- Dashboard titles help recipients understand what they're looking at — name them descriptively.

---

*Built with React, D3.js, and react-grid-layout.*
