import { useState, useMemo } from 'react';

// ── Table of Contents structure ──────────────────────────────────────────────
const TOC = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'interface', label: 'The Interface' },
  { id: 'loading-data', label: 'Loading Data' },
  { id: 'data-transforms', label: 'Data Transforms' },
  { id: 'building', label: 'Building a Dashboard' },
  { id: 'chart-types', label: 'Chart Types Reference' },
  { id: 'configuring', label: 'Configuring Widgets' },
  { id: 'measure-pipeline', label: 'Measure Pipeline' },
  { id: 'colors', label: 'Colors & Styling' },
  { id: 'conditional-fmt', label: 'Conditional Formatting' },
  { id: 'themes', label: 'Dashboard Themes' },
  { id: 'multi-page', label: 'Multi-Page Dashboards' },
  { id: 'viewer-mode', label: 'Viewer Mode' },
  { id: 'filtering', label: 'Filtering & Cross-Filtering' },
  { id: 'export-import', label: 'Export & Import' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
  { id: 'tips', label: 'Tips & Best Practices' },
];

// ── Reusable components ──────────────────────────────────────────────────────
function Section({ id, title, children }) {
  return (
    <section id={id} className="help-section">
      <h2 className="help-h2">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ title, children }) {
  return (
    <div className="help-sub">
      <h3 className="help-h3">{title}</h3>
      {children}
    </div>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="help-table-wrap">
      <table className="help-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kbd({ children }) {
  return <kbd className="help-kbd">{children}</kbd>;
}

function Tip({ children }) {
  return <div className="help-tip">{children}</div>;
}

// ── Main HelpPage component ──────────────────────────────────────────────────
export default function HelpPage({ onClose }) {
  const [activeSection, setActiveSection] = useState(null);
  const [search, setSearch] = useState('');

  const filteredTOC = useMemo(() => {
    if (!search.trim()) return TOC;
    const q = search.toLowerCase();
    return TOC.filter(t => t.label.toLowerCase().includes(q));
  }, [search]);

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="help-overlay">
      <div className="help-container">
        {/* Sidebar / TOC */}
        <nav className="help-nav">
          <div className="help-nav-header">
            <h1 className="help-nav-title">Ytics User Guide</h1>
            <input
              className="help-search"
              placeholder="Search sections..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <ul className="help-toc">
            {filteredTOC.map(item => (
              <li key={item.id}>
                <button
                  className={`help-toc-btn ${activeSection === item.id ? 'help-toc-btn--active' : ''}`}
                  onClick={() => scrollTo(item.id)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="help-content">
          <button className="help-close" onClick={onClose} title="Close help">
            &times;
          </button>

          <div className="help-hero">
            <h1>Ytics User Guide</h1>
            <p>
              Everything you need to build interactive dashboards, transform your data,
              and create compelling visualizations — all in the browser.
            </p>
            <p style={{ marginTop: 8, fontSize: 13 }}>
              Also available as standalone pages:{' '}
              <a href="/user-guide.html" target="_blank" rel="noopener noreferrer">Full User Guide</a>{' | '}
              <a href="/measures-guide.html" target="_blank" rel="noopener noreferrer">Measures Guide</a>
            </p>
          </div>

          {/* ── 1. Getting Started ──────────────────────────────────────── */}
          <Section id="getting-started" title="1. Getting Started">
            <Sub title="Your First Dashboard in 3 Steps">
              <ol className="help-ol">
                <li><strong>Upload data</strong> — Click the <em>Data</em> tab in the sidebar, then drag a CSV file onto the drop zone.</li>
                <li><strong>Add a chart</strong> — Switch to the <em>Dashboard</em> tab, then click or drag a chart type (e.g., Bar Chart) onto the canvas.</li>
                <li><strong>Map your fields</strong> — Click the widget to open its editor, pick your dataset, and assign columns to the X and Y axes.</li>
              </ol>
              <Tip>That's it — your first visualization is live. Everything else is refinement.</Tip>
            </Sub>
          </Section>

          {/* ── 2. The Interface ────────────────────────────────────────── */}
          <Section id="interface" title="2. The Interface">
            <Sub title="Header Bar">
              <Table
                headers={['Element', 'Description']}
                rows={[
                  ['Dashboard title', 'Click the title text to rename your dashboard.'],
                  ['Developer / Viewer', 'Toggle between build mode and presentation mode.'],
                  ['Import', 'Load a .ytics file (restores dashboard + data).'],
                  ['Export', 'Save your dashboard as a .ytics file.'],
                ]}
              />
            </Sub>
            <Sub title="Developer Mode Layout">
              <ul className="help-ul">
                <li><strong>Left sidebar</strong> — Dashboard styles, chart type picker, and widget list (Dashboard tab) or dataset management (Data tab).</li>
                <li><strong>Center canvas</strong> — Your dashboard grid. Drag, resize, and arrange widgets freely.</li>
                <li><strong>Right panel</strong> — Widget editor (appears when a widget is selected).</li>
              </ul>
            </Sub>
            <Sub title="Viewer Mode Layout">
              <ul className="help-ul">
                <li><strong>Top bar</strong> — Filter controls, edit button, and export button.</li>
                <li><strong>Full canvas</strong> — Read-only presentation of your dashboard with interactive filtering.</li>
              </ul>
            </Sub>
          </Section>

          {/* ── 3. Loading Data ─────────────────────────────────────────── */}
          <Section id="loading-data" title="3. Loading Data">
            <Sub title="Uploading CSV Files">
              <ol className="help-ol">
                <li>Click the <strong>Data</strong> tab in the developer sidebar.</li>
                <li>Drag one or more <code>.csv</code> files onto the upload area — or click to browse.</li>
                <li>Ytics parses your file and auto-detects column types:</li>
              </ol>
              <Table
                headers={['Type', 'Description']}
                rows={[
                  ['number', 'Numeric values (integers and decimals).'],
                  ['date', 'Recognizable date strings.'],
                  ['string', 'Everything else (text, categories).'],
                ]}
              />
            </Sub>
            <Sub title="Dataset Management">
              <ul className="help-ul">
                <li>Each uploaded file appears as a named dataset in the left panel.</li>
                <li>Click a dataset to select it and preview its contents (first 200 rows).</li>
                <li>Column headers display type badges. A summary line shows total rows and columns.</li>
                <li>Click <strong>&times;</strong> to delete a dataset.</li>
              </ul>
            </Sub>
            <Sub title="Multiple Datasets">
              <p>
                You can load as many datasets as you need. Each widget independently selects which dataset
                it visualizes, so a single dashboard can combine data from multiple sources.
              </p>
            </Sub>
          </Section>

          {/* ── 4. Data Transforms ──────────────────────────────────────── */}
          <Section id="data-transforms" title="4. Data Transforms">
            <p>Transforms modify a dataset in place before any widget uses it. They are applied in order, top to bottom.</p>
            <Sub title="Filter Rows">
              <p>Remove rows that don't match a condition.</p>
              <Table
                headers={['Setting', 'Options']}
                rows={[
                  ['Field', 'The column to check.'],
                  ['Operator', '=, !=, >, <, >=, <=, contains, not contains, is null, is not null'],
                  ['Value', 'The comparison value (omitted for null checks).'],
                ]}
              />
            </Sub>
            <Sub title="Rename Column">
              <p>Change a column's name without altering its data. Select the column and type the new name.</p>
            </Sub>
            <Sub title="Computed Column">
              <p>Create a new column using a JavaScript expression. All existing column names are available as variables.</p>
              <Tip>Example: Name: <code>gdp_per_capita</code>, Expression: <code>gdp / population</code></Tip>
            </Sub>
            <Sub title="Sort">
              <p>Reorder all rows by a column, ascending or descending.</p>
            </Sub>
          </Section>

          {/* ── 5. Building a Dashboard ─────────────────────────────────── */}
          <Section id="building" title="5. Building a Dashboard">
            <Sub title="Adding Widgets">
              <p>In the <strong>Dashboard</strong> tab of the sidebar, you'll find the <strong>Chart types</strong> grid with 26 visualization types sorted alphabetically.</p>
              <ul className="help-ul">
                <li><strong>Click</strong> a chart type button to add it to the canvas.</li>
                <li><strong>Drag</strong> a chart type onto the canvas to place it precisely.</li>
              </ul>
            </Sub>
            <Sub title="Moving & Resizing">
              <ul className="help-ul">
                <li><strong>Drag</strong> the widget header bar to move it.</li>
                <li><strong>Resize</strong> by dragging any of the 8 handles (corners and edges).</li>
                <li>The canvas uses a <strong>24-column grid</strong> with free placement — widgets can be positioned anywhere.</li>
              </ul>
            </Sub>
            <Sub title="Widget Actions">
              <Table
                headers={['Button', 'Action']}
                rows={[
                  ['\u2922', 'Maximize — Full-screen view of the widget.'],
                  ['\u29C9', 'Duplicate — Create a copy of the widget and its configuration.'],
                  ['\u21F1', 'Move to Page — Move the widget to a different page.'],
                  ['\u2715', 'Remove — Delete the widget.'],
                ]}
              />
            </Sub>
            <Sub title="Changing Chart Type">
              <p>Drag a chart type from the sidebar onto an existing widget to replace its type. Ytics preserves your field mappings where possible.</p>
            </Sub>
          </Section>

          {/* ── 6. Chart Types Reference ────────────────────────────────── */}
          <Section id="chart-types" title="6. Chart Types Reference">
            <div className="help-chart-grid">
              <ChartCard icon="📊" name="Bar Chart"
                desc="Compares categorical values with vertical or horizontal bars."
                fields="Category (X), Numeric (Y). Optional: Group field for stacked/grouped."
                options="Orientation, bar mode, sort by/order."
                gradient="Bar value" />
              <ChartCard icon="📦" name="Box Plot"
                desc="Statistical distribution: quartiles, median, mean, whiskers, outliers."
                fields="Category (X), Numeric (Y)."
                options="Grid, legend, opacity."
                gradient="Median per category" />
              <ChartCard icon="🫧" name="Bubble Chart"
                desc="Sized circles on X/Y axes with optional color encoding."
                fields="X (category or numeric), Y (numeric), Size (numeric). Optional: Color field."
                options="Min/max dot size, opacity."
                gradient="Bubble value" />
              <ChartCard icon="🏅" name="Bump Chart"
                desc="Tracks rank changes across time or ordered categories."
                fields="X (time), Series (color), Value (numeric)."
                options="Top N (fades lines entering/leaving top ranks), grid, legend, opacity."
                gradient="Series total value" />
              <ChartCard icon="📊📈" name="Combo Chart"
                desc="Overlays bars and lines on the same axes for dual-measure comparison."
                fields="X (category), Y1 (bars), Y2 (line). Optional: Color field."
                options="Bar mode, line type, dual-axis."
                gradient="Bar or line value" />
              <ChartCard icon="🎠" name="Carousel"
                desc="Cycles through multiple chart slides on the same dataset."
                fields="Configure each slide independently."
                options="Auto-play toggle, interval (1–30s)."
                gradient="Per-slide (inherited)" />
              <ChartCard icon="🔢" name="Data Table"
                desc="Tabular display with conditional formatting."
                fields="All columns shown by default."
                options="Conditional formatting (gradient or rules)."
                gradient="N/A — uses conditional formatting" />
              <ChartCard icon="🔽" name="Funnel Chart"
                desc="Visualizes sequential stages showing drop-off between steps."
                fields="Label (category), Value (numeric)."
                options="Sort by, opacity."
                gradient="Stage value" />
              <ChartCard icon="🌍" name="Geo Map"
                desc="Choropleth world map colored by a numeric value per country."
                fields="Geography (country name), Value (numeric)."
                options="Projection: Natural Earth, Mercator, Equal Earth, Orthographic."
                gradient="Country value (always sequential)" />
              <ChartCard icon="🌡" name="Heat Map"
                desc="Color matrix showing intensity across two categorical dimensions."
                fields="X (row), Y (column), Value (numeric)."
                options="Aggregation, legend."
                gradient="Cell value (always sequential)" />
              <ChartCard icon="▬" name="Histogram"
                desc="Distribution of a single numeric variable with statistical annotations."
                fields="X (numeric)."
                options="Number of bins (1–100)."
                gradient="Bin count" />
              <ChartCard icon="🎯" name="KPI Card"
                desc="Key performance indicator with three styles: card, gauge (speedometer), and satellite (circular progress)."
                fields="Value (numeric). Optional: Target field."
                options="Style (card/gauge/satellite), format (number/currency/percent), gauge min/max, gauge segments with auto-colors from palette."
                gradient="Gauge arc or satellite rings" />
              <ChartCard icon="📈" name="Line Chart"
                desc="Plots trends over a continuous or categorical X-axis."
                fields="X, Y (numeric). Optional: Color field for multi-series."
                options="Line type (6 curves), points, area, stack mode."
                gradient="Series total" />
              <ChartCard icon="▰▱" name="Mekko Chart"
                desc="Variable-width stacked bars showing two dimensions of proportion."
                fields="X (category), Y (numeric), Color (series)."
                options="Aggregation, legend, opacity."
                gradient="Segment value" />
              <ChartCard icon="🥧" name="Pie / Donut"
                desc="Proportional slices of a whole."
                fields="Label (category), Value (numeric)."
                options="Inner radius (0%=pie, 1–100%=donut), sort by value."
                gradient="Slice value" />
              <ChartCard icon="⊞" name="Pivot Table"
                desc="Cross-tabulation with row and column dimensions."
                fields="Value (numeric). Optional: Row fields, Column fields."
                options="Aggregation, conditional formatting."
                gradient="N/A — uses conditional formatting" />
              <ChartCard icon="🕸" name="Radar Chart"
                desc="Multi-axis spider/web chart comparing entities across dimensions."
                fields="Axis (3+ categories), Value (numeric). Optional: Color field."
                options="Grid, legend, opacity."
                gradient="Series total value" />
              <ChartCard icon="🔀" name="Sankey Diagram"
                desc="Flow diagram showing connections between source and target nodes."
                fields="Source, Target, Value (numeric)."
                options="Legend, opacity."
                gradient="Max flow per node" />
              <ChartCard icon="📋" name="Straight Table"
                desc="Simple flat data table with sorting and optional conditional formatting."
                fields="All columns shown by default."
                options="Conditional formatting (gradient or rules)."
                gradient="N/A — uses conditional formatting" />
              <ChartCard icon="⬤" name="Scatter Plot"
                desc="Individual data points on X/Y coordinates with optional size encoding."
                fields="X (numeric), Y (numeric). Optional: Color, Size fields."
                options="Dot size min/max (4–20px)."
                gradient="Y value or custom field" />
              <ChartCard icon="〰" name="Stream Graph"
                desc="Flowing stacked areas showing composition over time."
                fields="X (time), Series (color), Value (numeric)."
                options="Legend, opacity."
                gradient="Series total" />
              <ChartCard icon="⬛" name="Treemap"
                desc="Hierarchical rectangles sized by value."
                fields="Label (category), Value (numeric). Optional: Group field."
                options="Aggregation, opacity."
                gradient="Leaf node value" />
              <ChartCard icon="🎻" name="Violin Plot"
                desc="Distribution shape (KDE) with embedded box plot per category."
                fields="Category (X), Numeric (Y)."
                options="Grid, legend, opacity."
                gradient="Median per category" />
              <ChartCard icon="🧇" name="Waffle Chart"
                desc="Proportional 10x10 grid showing category shares."
                fields="Label (category), Value (numeric)."
                options="Legend, opacity."
                gradient="Category value" />
              <ChartCard icon="💧" name="Waterfall Chart"
                desc="Shows cumulative effect of sequential positive and negative values."
                fields="X (category), Y (numeric)."
                options="Sort, aggregation, opacity."
                gradient="Bar value" />
              <ChartCard icon="☁" name="Word Cloud"
                desc="Displays text sized by frequency or a numeric measure."
                fields="Label (text), Value (numeric)."
                options="Aggregation, opacity."
                gradient="Word value" />
            </div>
          </Section>

          {/* ── 7. Configuring Widgets ──────────────────────────────────── */}
          <Section id="configuring" title="7. Configuring Widgets">
            <p>Click any widget on the canvas to open its editor panel. The editor is organized into tabs.</p>
            <Sub title="Fields Tab">
              <p>Map your data columns to the chart's visual channels. Fields marked with <span style={{ color: 'var(--danger)' }}>*</span> are required.</p>
              <p><strong>Aggregation</strong> determines how multiple values for the same category are combined:</p>
              <Table
                headers={['Aggregation', 'Description']}
                rows={[
                  ['sum', 'Total of all values (default).'],
                  ['count', 'Number of records.'],
                  ['mean', 'Average value.'],
                  ['min / max', 'Smallest / largest value.'],
                  ['median', 'Middle value (50th percentile).'],
                  ['std', 'Standard deviation.'],
                  ['p25 / p75 / p90 / p95', 'Percentiles.'],
                ]}
              />
            </Sub>
            <Sub title="Aesthetics Tab">
              <Table
                headers={['Setting', 'Description']}
                rows={[
                  ['Title', 'The widget\'s display name.'],
                  ['Color scheme', 'Override the dashboard palette or inherit from theme.'],
                  ['Show grid lines', 'Toggle background grid.'],
                  ['Show legend', 'Toggle the color legend.'],
                  ['Opacity', 'Transparency slider from 20% to 100%.'],
                  ['Background color', 'Use theme default or pick a custom card background.'],
                  ['Corner radius', 'Inherit from theme or set custom (0–20px).'],
                ]}
              />
            </Sub>
            <Sub title="Options Tab">
              <p>Chart-specific settings vary by type. Examples:</p>
              <ul className="help-ul">
                <li><strong>Bar Chart</strong>: Orientation, bar mode, sort by, sort order.</li>
                <li><strong>Bump Chart</strong>: Top N (limits visible ranks; lines entering/leaving fade out).</li>
                <li><strong>Combo Chart</strong>: Bar mode, line type, dual-axis configuration.</li>
                <li><strong>Geo Map</strong>: Map projection (Natural Earth, Mercator, Equal Earth, Orthographic).</li>
                <li><strong>Histogram</strong>: Number of bins.</li>
                <li><strong>KPI Card</strong>: Style (card/gauge/satellite), format, gauge min/max, gauge segments with auto-palette colors, invert gradient.</li>
                <li><strong>Line Chart</strong>: Line type (6 curves), points, area, stack mode.</li>
                <li><strong>Pie Chart</strong>: Inner radius (donut hole size).</li>
                <li><strong>Scatter / Bubble</strong>: Dot size min/max.</li>
                <li><strong>Carousel</strong>: Auto-play toggle, interval.</li>
              </ul>
            </Sub>
          </Section>

          {/* ── 8. Measure Pipeline ─────────────────────────────────────── */}
          <Section id="measure-pipeline" title="8. Measure Pipeline">
            <p>
              The measure pipeline transforms data <em>before</em> it reaches the chart, without modifying the original dataset.
              Open a widget's editor and go to the <strong>Measures</strong> tab to configure.
            </p>
            <Tip>
              For a comprehensive walkthrough with examples, see the{' '}
              <a href="/measures-guide.html" target="_blank" rel="noopener noreferrer">Measures Guide</a>.
            </Tip>
            <Sub title="Group & Aggregate">
              <p>Groups rows by one or more columns and applies aggregation functions (sum, count, mean, min, max, median, std, percentiles).</p>
              <Tip>Example: Group by <code>country</code>, aggregate <code>revenue</code> as sum and <code>orders</code> as count.</Tip>
            </Sub>
            <Sub title="Top / Bottom N">
              <p>Keeps only the top or bottom N rows, optionally per group.</p>
              <Tip>Example: Top 10 countries by revenue.</Tip>
            </Sub>
            <Sub title="Filter">
              <p>Removes rows that don't match a condition (same operators as data transforms).</p>
            </Sub>
            <Sub title="Compute Column">
              <p>Creates a new calculated column using a JavaScript expression.</p>
              <Tip>Example: <code>profit_margin = (revenue - cost) / revenue * 100</code></Tip>
            </Sub>
            <Sub title="Sort">
              <p>Reorders rows by a field, ascending or descending.</p>
            </Sub>
            <Sub title="Pipeline Controls">
              <ul className="help-ul">
                <li><strong>Add step</strong>: Click <code>+</code> for the step type you need.</li>
                <li><strong>Reorder</strong>: Use the arrow buttons to move steps up or down.</li>
                <li><strong>Delete</strong>: Click <strong>&times;</strong> to remove a step.</li>
                <li><strong>Preview</strong>: Each step shows an output indicator with column and row counts.</li>
              </ul>
            </Sub>
          </Section>

          {/* ── 9. Colors & Styling ─────────────────────────────────────── */}
          <Section id="colors" title="9. Colors & Styling">
            <Sub title="Color Modes">
              <p>Every chart supports two color modes, selectable in the <strong>Colors</strong> tab:</p>
              <ul className="help-ul">
                <li><strong>Categorical</strong> (default) — Each dimension value gets a distinct color from the palette.</li>
                <li><strong>Gradient</strong> — Values are mapped to a continuous color gradient based on a numeric measure.</li>
              </ul>
            </Sub>
            <Sub title="Color Palettes (15)">
              <Table
                headers={['Palette', 'Style']}
                rows={[
                  ['Vivid', 'Bold, high-contrast colors (Tableau10).'],
                  ['Spectrum', 'Classic D3 color set (Category10).'],
                  ['Muted', 'Desaturated, gentle tones (Set2).'],
                  ['Soft', 'Light pastel-like variety (Set3).'],
                  ['Pastel', 'Very soft pastels (Pastel1).'],
                  ['Contrast', 'Deep saturated tones (Dark2).'],
                  ['Duo', 'Pairs of light/dark variants (Paired).'],
                  ['Bold', 'Strong accent colors (Accent).'],
                  ['Blues / Greens / Reds / Purples / Oranges', 'Sequential 9-step single-hue ramps.'],
                  ['Warm \u2192 Cool', 'Diverging: Red \u2192 Yellow \u2192 Blue.'],
                  ['Brown \u2192 Green', 'Diverging: Brown \u2192 Green.'],
                ]}
              />
            </Sub>
            <Sub title="Palette-Linked Gradients">
              <p>When you switch to gradient mode, Ytics automatically selects a gradient that matches your palette:</p>
              <Table
                headers={['Palette', 'Default Gradient']}
                rows={[
                  ['Vivid', 'Turbo'],
                  ['Spectrum', 'Spectral'],
                  ['Muted', 'Viridis'],
                  ['Soft', 'Plasma'],
                  ['Pastel', 'Blues'],
                  ['Contrast', 'Inferno'],
                  ['Duo', 'Warm \u2192 Cool'],
                  ['Bold', 'Turbo'],
                ]}
              />
              <p>Sequential and diverging palettes map to their matching gradient. You can override by checking <strong>"Override gradient"</strong> in the Colors tab. Use <strong>"Invert gradient"</strong> to reverse the color direction.</p>
            </Sub>
            <Sub title="Gradient Schemes (13)">
              <Table
                headers={['Gradient', 'Description']}
                rows={[
                  ['Blues / Greens / Reds / Purples / Oranges', 'Light \u2192 dark single-hue.'],
                  ['Warm \u2192 Cool', 'Red \u2192 Yellow \u2192 Blue (diverging).'],
                  ['Brown \u2192 Green', 'Brown \u2192 Green (diverging).'],
                  ['Viridis', 'Purple \u2192 teal \u2192 yellow.'],
                  ['Plasma', 'Purple \u2192 pink \u2192 yellow.'],
                  ['Inferno', 'Black \u2192 red \u2192 yellow.'],
                  ['Turbo', 'Blue \u2192 green \u2192 yellow \u2192 red.'],
                  ['Spectral', 'Red \u2192 yellow \u2192 blue (diverging).'],
                ]}
              />
            </Sub>
            <Sub title="Custom Gradient Field">
              <p>
                By default, the gradient is driven by the chart's primary value field. You can select a different
                numeric column under <strong>Color by field</strong> to drive the color independently.
              </p>
              <Tip>Example: A bar chart showing revenue per country, colored by population.</Tip>
            </Sub>
            <Sub title="Dimension Colors (Cross-Chart Consistency)">
              <p>
                Pin specific dimension values to consistent colors across all charts on the dashboard.
                Found in the <strong>Colors</strong> tab under <strong>Dimension Colors</strong>:
              </p>
              <ul className="help-ul">
                <li><strong>Custom hex color</strong> — Stays fixed regardless of palette changes.</li>
                <li><strong>Palette-relative color</strong> — Picks a palette index; updates when palette changes.</li>
                <li><strong>Reset</strong> — Reverts to automatic assignment.</li>
              </ul>
              <Tip>Example: Pin "Argentina" to light blue (#74b9ff) so it appears the same in every chart.</Tip>
              <p>Dimension colors are stored at the <strong>dashboard level</strong> and apply across all widgets.</p>
            </Sub>
          </Section>

          {/* ── 10. Conditional Formatting ──────────────────────────────── */}
          <Section id="conditional-fmt" title="10. Conditional Formatting">
            <p>Available for <strong>Data Table</strong> and <strong>Pivot Table</strong> widgets. Found in the Colors tab.</p>
            <Sub title="Gradient Mode">
              <p>Colors cells on a continuous scale from the column's minimum to maximum value. Select a gradient scheme. Text color adjusts automatically for readability.</p>
            </Sub>
            <Sub title="Rules Mode">
              <p>Color cells based on specific conditions:</p>
              <Table
                headers={['Setting', 'Description']}
                rows={[
                  ['Operator', '>, >=, <, <=, ==, !=, contains'],
                  ['Value', 'The comparison target.'],
                  ['Background color', 'Cell background when condition is met.'],
                  ['Text color', 'Cell text color when condition is met.'],
                ]}
              />
              <p>Multiple conditions can be added per rule; the first matching condition wins.</p>
              <Tip>Example: Color the "Revenue" column with a Blues gradient. Or color "Status" — green for "Active", red for "Inactive".</Tip>
            </Sub>
          </Section>

          {/* ── 11. Dashboard Themes ────────────────────────────────────── */}
          <Section id="themes" title="11. Dashboard Themes">
            <p>Global visual settings found in the <strong>Dashboard Styles</strong> section of the developer sidebar.</p>
            <Table
              headers={['Setting', 'Options', 'Default']}
              rows={[
                ['Font size', '10–18px slider', '13px'],
                ['Canvas color', 'Color picker', '#f1f5f9'],
                ['Card color', 'Color picker', '#ffffff'],
                ['Border radius', '0–20px slider', '8px'],
                ['Card shadow', 'None, Small, Medium, Large', 'Medium'],
                ['Color scheme', 'Any of the 15 palettes', 'Vivid'],
              ]}
            />
            <Sub title="Theme Inheritance">
              <p>Widgets inherit from the dashboard theme by default. Override per-widget in the Aesthetics tab:</p>
              <ul className="help-ul">
                <li><strong>Color scheme</strong> — Specific palette or "Inherit from theme".</li>
                <li><strong>Background color</strong> — Theme card color or custom.</li>
                <li><strong>Border radius</strong> — Theme radius or custom value.</li>
              </ul>
            </Sub>
          </Section>

          {/* ── 12. Multi-Page ──────────────────────────────────────────── */}
          <Section id="multi-page" title="12. Multi-Page Dashboards">
            <p>Organize complex dashboards into multiple pages, like tabs in a spreadsheet.</p>
            <Table
              headers={['Action', 'How']}
              rows={[
                ['Add page', 'Click the + button at the end of the tab bar.'],
                ['Switch page', 'Click any page tab.'],
                ['Rename page', 'Double-click a page tab and type the new name.'],
                ['Delete page', 'Click the \u00d7 on a page tab (available with 2+ pages).'],
              ]}
            />
            <Sub title="Moving Widgets Between Pages">
              <ol className="help-ol">
                <li>Click the <strong>{'\u21F1'}</strong> button on a widget.</li>
                <li>Select the destination page from the dropdown.</li>
                <li>The widget moves to the target page.</li>
              </ol>
            </Sub>
          </Section>

          {/* ── 13. Viewer Mode ─────────────────────────────────────────── */}
          <Section id="viewer-mode" title="13. Viewer Mode">
            <p>Switch by clicking <strong>Viewer</strong> in the header. This is the presentation mode.</p>
            <ul className="help-ul">
              <li><strong>Read-only canvas</strong> — Widgets display but cannot be moved or edited.</li>
              <li><strong>Interactive charts</strong> — Hover for tooltips, click for cross-filtering.</li>
              <li><strong>Filter panel</strong> — Add, modify, and remove data filters.</li>
              <li><strong>Page navigation</strong> — Arrow buttons and tab bar for multi-page dashboards.</li>
              <li><strong>Maximize</strong> — Click {'\u2922'} on any widget for a full-screen view.</li>
            </ul>
          </Section>

          {/* ── 14. Filtering ───────────────────────────────────────────── */}
          <Section id="filtering" title="14. Filtering & Cross-Filtering">
            <Sub title="Adding Filters">
              <ol className="help-ol">
                <li>Click <strong>+ Filter</strong> in the viewer top bar.</li>
                <li>If there are multiple datasets, select one.</li>
                <li>Choose a field to filter on.</li>
              </ol>
              <p><strong>Categorical filter</strong> (string fields): Multi-select checkboxes with search, "All visible", "All", and "None" buttons.</p>
              <p><strong>Range filter</strong> (numeric fields): Min/Max inputs with a "Reset to full range" button.</p>
            </Sub>
            <Sub title="Cross-Filtering">
              <p>
                Click on any chart element (bar, slice, dot, region...) to create or toggle a filter.
                Cross-filters work across all widgets sharing the same dataset.
              </p>
              <Tip>Click "Argentina" on a bar chart — all other charts using the same dataset instantly filter to Argentina. Click again to remove.</Tip>
            </Sub>
            <Sub title="Filter Undo / Redo">
              <p>
                <Kbd>Ctrl+Z</Kbd> undoes the last filter change. <Kbd>Ctrl+Y</Kbd> redoes it.
                Filter history is separate from developer-mode undo history.
              </p>
            </Sub>
          </Section>

          {/* ── 15. Export & Import ──────────────────────────────────────── */}
          <Section id="export-import" title="15. Export & Import">
            <Sub title="Exporting">
              <p>Click <strong>Export</strong> in the header. Ytics saves a <code>.ytics</code> file (ZIP archive) containing:</p>
              <Table
                headers={['File', 'Contents']}
                rows={[
                  ['dashboard.json', 'Full configuration: pages, widgets, layouts, theme, dimension colors.'],
                  ['data/*.csv', 'A CSV export of each dataset.'],
                  ['README.md', 'A human-readable summary.'],
                ]}
              />
            </Sub>
            <Sub title="Importing">
              <p>Click <strong>Import</strong> in the header and select a <code>.ytics</code> or <code>.zip</code> file. Ytics reconstructs datasets, restores the dashboard state, and switches to Viewer mode.</p>
            </Sub>
          </Section>

          {/* ── 16. Keyboard Shortcuts ──────────────────────────────────── */}
          <Section id="shortcuts" title="16. Keyboard Shortcuts">
            <Table
              headers={['Shortcut', 'Mode', 'Action']}
              rows={[
                [<><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd></>, 'Developer', 'Undo the last dashboard change.'],
                [<><Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd></>, 'Developer', 'Redo a reverted change.'],
                [<><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd></>, 'Developer', 'Redo (alternative).'],
                [<><Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd></>, 'Viewer', 'Undo the last filter change.'],
                [<><Kbd>Ctrl</Kbd>+<Kbd>Y</Kbd></>, 'Viewer', 'Redo filter change.'],
              ]}
            />
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              On macOS, use <Kbd>Cmd</Kbd> instead of <Kbd>Ctrl</Kbd>. Shortcuts are disabled when a text input is focused.
              Undo/redo tracks up to 50 states.
            </p>
          </Section>

          {/* ── 17. Tips & Best Practices ───────────────────────────────── */}
          <Section id="tips" title="17. Tips & Best Practices">
            <Sub title="Data Preparation">
              <ul className="help-ul">
                <li><strong>Clean your CSVs</strong> before uploading — mixed text and numbers in a column may be treated as strings.</li>
                <li><strong>Use clear column names</strong> — They appear as axis labels, legend text, and field selectors.</li>
                <li><strong>Prefer tidy data</strong> — One row per observation, one column per variable. Use the Measure Pipeline for reshaping.</li>
              </ul>
            </Sub>
            <Sub title="Dashboard Design">
              <ul className="help-ul">
                <li><strong>Start simple</strong> — Add one chart, get the data mapping right, then expand.</li>
                <li><strong>Use the Measure Pipeline</strong> instead of modifying source data — pipelines are per-widget.</li>
                <li><strong>Leverage theme inheritance</strong> — Set palette and styles at the theme level; override only when needed.</li>
                <li><strong>Pin dimension colors</strong> for key values so they're consistent across every chart.</li>
              </ul>
            </Sub>
            <Sub title="Performance">
              <ul className="help-ul">
                <li><strong>Large datasets</strong> (100k+ rows): Pre-aggregate in the Measure Pipeline or filter to relevant subsets.</li>
                <li><strong>Many widgets</strong>: Keep 10–15 per page for comfortable performance.</li>
              </ul>
            </Sub>
            <Sub title="Color Best Practices">
              <ul className="help-ul">
                <li><strong>Categorical data</strong> → Use a categorical palette (Vivid, Spectrum, Muted).</li>
                <li><strong>Sequential/ranked data</strong> → Use gradient mode with a single-hue gradient (Blues, Greens).</li>
                <li><strong>Diverging data</strong> (profit/loss) → Use Warm→Cool or Brown→Green.</li>
                <li><strong>Accessibility</strong> — Muted and Contrast palettes work well for color-blind viewers.</li>
              </ul>
            </Sub>
          </Section>

          <div className="help-footer">
            Ytics — Dashboard builder for data analytics and visualization.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chart card for the reference grid ────────────────────────────────────────
function ChartCard({ icon, name, desc, fields, options, gradient }) {
  return (
    <div className="help-chart-card">
      <div className="help-chart-card-header">
        <span className="help-chart-card-icon">{icon}</span>
        <strong>{name}</strong>
      </div>
      <p className="help-chart-card-desc">{desc}</p>
      <div className="help-chart-card-detail"><span>Fields:</span> {fields}</div>
      <div className="help-chart-card-detail"><span>Options:</span> {options}</div>
      <div className="help-chart-card-detail"><span>Gradient:</span> {gradient}</div>
    </div>
  );
}
