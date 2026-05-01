// ── AI Tool Definitions ──────────────────────────────────────────────────────
// Internal format: { name, description, parameters }
// Converted to provider-specific format by each adapter.

export const DEVELOPER_TOOLS = [
  {
    name: 'add_widget',
    description: 'Add a new chart/widget to the current dashboard page.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['bar', 'line', 'scatter', 'pie', 'histogram', 'combo', 'kpi',
                 'heatmap', 'treemap', 'funnel', 'radar', 'boxplot', 'violin',
                 'waterfall', 'waffle', 'wordcloud', 'sankey', 'bubble', 'bump',
                 'stream', 'correlogram', 'density', 'mekko', 'geo', 'pivot',
                 'straighttable', 'table', 'text'],
          description: 'Chart type',
        },
        title: { type: 'string', description: 'Widget title' },
        datasetId: { type: 'string', description: 'Dataset ID. Omit to use first dataset.' },
        xField: { type: 'string', description: 'X-axis / dimension field' },
        yField: { type: 'string', description: 'Y-axis / measure field' },
        valueField: { type: 'string', description: 'Value field (for KPI, treemap, etc.)' },
        labelField: { type: 'string', description: 'Label field (for pie, treemap, etc.)' },
        colorField: { type: 'string', description: 'Color/series breakdown field' },
        sourceField: { type: 'string', description: 'Source field (for sankey, graph)' },
        targetField: { type: 'string', description: 'Target field (for sankey, graph)' },
        aggregation: {
          type: 'string',
          enum: ['sum', 'avg', 'count', 'min', 'max', 'median'],
          description: 'Aggregation function (default: sum)',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'update_widget',
    description: 'Update properties of an existing widget by its ID.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'The widget ID to update' },
        updates: {
          type: 'object',
          description: 'Key-value pairs to update. Common: title, xField, yField, colorField, aggregation, type, colorScheme, showGrid, showLegend, numberFormat, sortBy, sortOrder, orientation, useLogScale, showRegression, regressionType',
        },
      },
      required: ['widgetId', 'updates'],
    },
  },
  {
    name: 'remove_widget',
    description: 'Remove a widget from the dashboard.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'The widget ID to remove' },
      },
      required: ['widgetId'],
    },
  },
  {
    name: 'set_dashboard_title',
    description: 'Set the dashboard title.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'suggest_charts',
    description: 'Analyze a dataset and suggest appropriate chart configurations. Returns schema info for you to reason about. Does not create widgets.',
    parameters: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset to analyze. Omit for first.' },
      },
    },
  },
];

export const VIEWER_TOOLS = [
  {
    name: 'query_data',
    description: 'Query a dataset. Runs locally — data never leaves the browser. Use to answer questions about the data.',
    parameters: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset ID. Omit for first.' },
        fields: {
          type: 'array', items: { type: 'string' },
          description: 'Fields to include in results',
        },
        filter: {
          type: 'object',
          description: 'Filter: { fieldName: { op: "eq"|"gt"|"lt"|"gte"|"lte"|"contains"|"in", value: any } }',
        },
        groupBy: { type: 'string', description: 'Field to group by' },
        aggregation: {
          type: 'object',
          description: 'Aggregations per field: { fieldName: "sum"|"avg"|"count"|"min"|"max" }',
        },
        sortBy: { type: 'string', description: 'Field to sort by' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number', description: 'Max rows (default: 20)' },
      },
    },
  },
  {
    name: 'describe_data',
    description: 'Get statistical summary of a dataset. Returns count, mean, median, min, max, unique values per field.',
    parameters: {
      type: 'object',
      properties: {
        datasetId: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Fields to describe. Omit for all.' },
      },
    },
  },
  {
    name: 'set_selection',
    description: 'Set a selection/filter on a field. Filters all charts in the dashboard.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Field name to filter' },
        values: {
          type: 'array', items: { type: 'string' },
          description: 'Values to select. Empty array = clear (show all).',
        },
      },
      required: ['field', 'values'],
    },
  },
];
