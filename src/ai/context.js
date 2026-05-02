// ── Context Builder ──────────────────────────────────────────────────────────
// Builds system prompts and context from app state for developer/viewer modes.
// Two modes: "full" (default) and "light" (minimal tokens for free tiers).

const RESPONSE_RULES = `
Response rules:
- Reply in markdown. Use **bold**, lists, and headers for readability.
- Never output XML, HTML tags, or raw structured data in your text. Tool calls handle structured actions.
- After performing actions via tools, briefly confirm what you did in 1-2 sentences.
- Do not echo widget IDs or dataset IDs to the user — refer to things by their name/title.
- Keep responses short and conversational.`;

function getCurrentPageWidgets(state) {
  const page = state.dashboard.pages.find(p => p.id === state.dashboard.currentPageId)
    || state.dashboard.pages[0];
  return page?.widgets || [];
}

// ── Full context (default) ──────────────────────────────────────────────────

function buildDeveloperFull(state) {
  return `You are an AI assistant for Ytics, a dashboard builder.
You help users create and configure data visualizations.
You can add widgets, update their configuration, and suggest chart types.
Always use tool calls to make changes — never just describe what to do.
${RESPONSE_RULES}

Available chart types: bar, line, scatter, pie, histogram, combo, kpi, heatmap, treemap, funnel, radar, boxplot, violin, waterfall, waffle, wordcloud, sankey, bubble, bump, stream, correlogram, density, mekko, geo, pivot, straighttable, table, carousel, text, image, embed.

Common widget properties you can set with update_widget:
- title, type, xField, yField, colorField, groupField, valueField, labelField
- aggregation (sum, avg, count, min, max, median)
- colorScheme (vivid, pastel, warm, cool, neon, earth, ocean, sunset, monochrome, d3cat10, d3cat20, tableau10, tableau20)
- sortBy (value, label, original), sortOrder (asc, desc)
- showGrid, showLegend, showRegression, regressionType (linear, polynomial, logarithmic, exponential)
- useLogScale, orientation (vertical, horizontal)
- numberFormat (auto, number, si, scientific, currency, percent)
- barMode (stacked, grouped), stackMode (none, stacked, percent)
- showTrendLine, lineType (linear, step, monotone, natural, basis)

${state.datasets.length > 0 ? `## Datasets
${state.datasets.map(d =>
  `### ${d.name} (id: ${d.id})
Columns: ${Object.entries(d.columnTypes).map(([name, type]) => `${name} (${type})`).join(', ')}
Rows: ${d.data.length}`
).join('\n\n')}` : 'No datasets loaded yet.'}

## Current Dashboard
Title: ${state.dashboard.title || '(untitled)'}
Pages: ${state.dashboard.pages.length}
Current page widgets: ${getCurrentPageWidgets(state).map(w =>
  `${w.id}: "${w.title}" (${w.type}${w.xField ? ', x=' + w.xField : ''}${w.yField ? ', y=' + w.yField : ''}${w.valueField ? ', val=' + w.valueField : ''})`
).join('; ') || 'none'}`;
}

function buildViewerFull(state) {
  return `You are a data analyst assistant for Ytics.
You help users understand their data by answering questions, finding patterns, and filtering the dashboard.
Use the query_data tool to examine data before answering questions. Be specific and cite numbers.
Use the describe_data tool to get statistical summaries.
Use the set_selection tool to filter the dashboard when the user asks to focus on specific values.
${RESPONSE_RULES}

When presenting data results:
- Format numbers with appropriate precision (e.g., 7.9B instead of 7888000000).
- Use markdown tables for tabular results.
- Highlight key findings with **bold**.

${state.datasets.length > 0 ? `## Datasets
${state.datasets.map(d => {
  const sample = d.data.slice(0, 3);
  return `### ${d.name} (id: ${d.id})
Columns: ${Object.entries(d.columnTypes).map(([name, type]) => `${name} (${type})`).join(', ')}
Rows: ${d.data.length}
Sample: ${JSON.stringify(sample)}`;
}).join('\n\n')}` : 'No datasets loaded.'}

## Active Selections
${Object.entries(state.selections || {}).map(([field, values]) =>
  values.length > 0 ? `${field}: ${values.join(', ')}` : `${field}: all`
).join('\n') || 'None'}`;
}

// ── Light context (minimal tokens) ──────────────────────────────────────────

function buildDeveloperLight(state) {
  const ds = state.datasets.map(d =>
    `${d.name}(${d.id}): ${Object.keys(d.columnTypes).join(', ')} [${d.data.length}r]`
  ).join('\n') || 'No data.';

  const widgets = getCurrentPageWidgets(state);
  const wList = widgets.length > 0
    ? widgets.map(w => `${w.id}:${w.type}`).join(', ')
    : 'none';

  return `Ytics dashboard builder AI. Use tool calls. Reply in markdown. Be concise. Never output XML/HTML.
Charts: bar,line,scatter,pie,histogram,combo,kpi,heatmap,treemap,funnel,radar,boxplot,violin,waterfall,waffle,wordcloud,sankey,bubble,bump,stream,correlogram,density,mekko,geo,pivot,straighttable,table,text.
Datasets:\n${ds}
Widgets: ${wList}`;
}

function buildViewerLight(state) {
  const ds = state.datasets.map(d =>
    `${d.name}(${d.id}): ${Object.keys(d.columnTypes).join(', ')} [${d.data.length}r]`
  ).join('\n') || 'No data.';

  const sel = Object.entries(state.selections || {})
    .filter(([, v]) => v?.length > 0)
    .map(([f, v]) => `${f}:${v.length}sel`)
    .join(', ');

  return `Data analyst AI for Ytics. Use query_data/describe_data tools to examine data before answering. Be specific, cite numbers. Use set_selection to filter. Reply in markdown. Never output XML/HTML. Format large numbers readably.
Datasets:\n${ds}${sel ? `\nSelections: ${sel}` : ''}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function buildContext(state, lightMode = false) {
  if (state.mode === 'developer') {
    return lightMode ? buildDeveloperLight(state) : buildDeveloperFull(state);
  }
  return lightMode ? buildViewerLight(state) : buildViewerFull(state);
}
