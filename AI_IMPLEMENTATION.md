# AI Integration Implementation Guide

This document is the complete specification for adding AI assistant capabilities to Ytics.
It is designed to survive context compaction and guide implementation across multiple sessions.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Structure](#2-file-structure)
3. [Phase 1: Provider Abstraction](#3-phase-1-provider-abstraction)
4. [Phase 2: Settings & API Key Management](#4-phase-2-settings--api-key-management)
5. [Phase 3: Context Builder](#5-phase-3-context-builder)
6. [Phase 4: Developer Tools](#6-phase-4-developer-tools)
7. [Phase 5: Chat Panel UI](#7-phase-5-chat-panel-ui)
8. [Phase 6: Viewer Tools](#8-phase-6-viewer-tools)
9. [Phase 7: Integration with App](#9-phase-7-integration-with-app)
10. [State Shape Reference](#10-state-shape-reference)
11. [Existing Codebase Reference](#11-existing-codebase-reference)

---

## 1. Architecture Overview

```
User message
    |
    v
ChatPanel (UI) ---> useAI hook ---> AIProvider.chat(messages, tools, context)
    ^                                       |
    |                                       v
    |                              ProviderAdapter
    |                              +-- OllamaAdapter    (local, free, default)
    |                              +-- GeminiAdapter     (free tier, API key)
    |                              +-- ClaudeAdapter     (paid, API key)
    |                              +-- OpenAIAdapter     (paid, API key)
    |                                       |
    |                                       v
    |                              Tool calls returned
    |                                       |
    |                                       v
    +--- toolExecutor(toolCall, dispatch, state) ---> dispatches actions / returns data
```

### Two modes, two tool sets

- **Developer Assistant**: AI dispatches Redux-style actions to build/modify the dashboard.
  Tools: `add_widget`, `update_widget`, `remove_widget`, `suggest_charts`, `set_title`, `add_transform`.
  Context: dataset schemas only (no raw data).

- **Viewer Analyst**: AI answers data questions, can create ephemeral visualizations.
  Tools: `query_data`, `aggregate_data`, `create_insight_chart`, `describe_data`, `set_selection`.
  Context: dataset schemas + sample rows + active selections.

### Provider requirements

All providers must support:
- Streaming text responses
- Tool/function calling (structured output)
- System messages

| Provider | Endpoint | Auth | Free? | Tool calling |
|----------|----------|------|-------|-------------|
| Ollama   | `http://localhost:11434/v1/chat/completions` | None | Yes | Yes (0.5+) |
| Gemini   | `https://generativelanguage.googleapis.com/v1beta/` | API key | 15 RPM free | Yes |
| Claude   | `https://api.anthropic.com/v1/messages` | API key | No | Yes |
| OpenAI   | `https://api.openai.com/v1/chat/completions` | API key | No | Yes |

---

## 2. File Structure

```
src/ai/
  providers.js       -- Provider abstraction + all 4 adapters
  tools.js           -- Tool definitions for developer + viewer modes
  toolExecutor.js    -- Executes tool calls against app state/dispatch
  context.js         -- Builds system prompt + context from app state
  useAI.js           -- React hook: manages messages, streaming, tool loop

src/components/
  AIChat/
    AIChatPanel.js   -- Slide-out side panel with message list + input
    AIMessage.js     -- Single message bubble (user/assistant/tool-result)
    AISettings.js    -- Provider config modal (provider picker, API key, model)
    AIInsightChart.js -- Renders ephemeral mini-charts from viewer tool results
```

---

## 3. Phase 1: Provider Abstraction

### File: `src/ai/providers.js`

```js
// Shape of a provider adapter:
// {
//   name: string,
//   chat(messages, tools, options) -> AsyncGenerator<{ type: 'text'|'tool_call', ... }>
//   testConnection() -> Promise<boolean>
// }
```

#### Ollama Adapter (default, no auth)

- Endpoint: `http://localhost:11434/v1/chat/completions` (OpenAI-compatible)
- Default model: `llama3.1:8b` (user-configurable)
- Streaming: SSE via `fetch` with `stream: true`
- Tool calling: OpenAI-compatible format
- Connection test: `GET http://localhost:11434/api/tags`
- CORS: Ollama allows localhost by default
- No API key needed

```js
// Request format (OpenAI-compatible):
{
  model: 'llama3.1:8b',
  messages: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }],
  tools: [{ type: 'function', function: { name, description, parameters } }],
  stream: true
}
```

#### Gemini Adapter

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`
- Default model: `gemini-2.0-flash`
- Auth: `?key=API_KEY` query param
- Free tier: 15 requests/minute, 1M tokens/day
- Tool calling: Gemini native format (different from OpenAI)
- Messages format conversion needed: Gemini uses `contents` with `parts`

```js
// Gemini request format:
{
  contents: [{ role: 'user', parts: [{ text: '...' }] }],
  tools: [{ functionDeclarations: [{ name, description, parameters }] }],
  systemInstruction: { parts: [{ text: '...' }] }
}
// Gemini tool call response:
// candidates[0].content.parts[0].functionCall = { name, args }
```

#### Claude Adapter

- Endpoint: `https://api.anthropic.com/v1/messages`
- Default model: `claude-sonnet-4-20250514`
- Auth: `x-api-key` header + `anthropic-version: 2023-06-01`
- Streaming: SSE with `stream: true`
- **CORS issue**: Anthropic API does not allow browser-origin requests.
  Solution: Use a lightweight CORS proxy, OR make requests via a service worker,
  OR document that Claude requires a proxy setup.
  Simplest: include a note that Claude needs `anthropic-dangerous-direct-browser-access: true` header
  (Anthropic allows this for development with the header).
- Tool calling: Anthropic native format

```js
// Claude request format:
{
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  system: '...',
  messages: [{ role: 'user', content: '...' }],
  tools: [{ name, description, input_schema: { type: 'object', properties, required } }],
  stream: true
}
// Headers:
// x-api-key: API_KEY
// anthropic-version: 2023-06-01
// anthropic-dangerous-direct-browser-access: true
// content-type: application/json
```

#### OpenAI Adapter

- Endpoint: `https://api.openai.com/v1/chat/completions`
- Default model: `gpt-4o-mini`
- Auth: `Authorization: Bearer API_KEY`
- Same format as Ollama (OpenAI-compatible)
- Can reuse Ollama adapter with different endpoint/auth

### Unified streaming interface

All adapters yield chunks via async generator:

```js
async function* chat(messages, tools, options) {
  // ... provider-specific fetch + SSE parsing ...
  yield { type: 'text', content: 'partial text...' };
  yield { type: 'tool_call', id: 'call_123', name: 'add_widget', args: { type: 'bar', ... } };
  yield { type: 'done' };
}
```

### Connection testing

```js
async function testConnection() {
  // Ollama: GET /api/tags (returns model list)
  // Gemini: GET /v1beta/models?key=KEY (returns model list)
  // Claude: POST /v1/messages with minimal prompt
  // OpenAI: GET /v1/models
  return { ok: true, models: ['llama3.1:8b', ...] };
}
```

---

## 4. Phase 2: Settings & API Key Management

### File: `src/components/AIChat/AISettings.js`

Modal with:
- **Provider selector**: Radio buttons for Ollama / Gemini / Claude / OpenAI
- **Connection status**: Green/red dot, auto-tested on mount
- **API key input**: Password field (only for Gemini/Claude/OpenAI). Show/hide toggle.
- **Model selector**: Dropdown populated from `testConnection()` result, or manual text input
- **Custom endpoint**: Text field (for Ollama on non-default port, or OpenAI-compatible providers)

### Storage

```js
// localStorage key: 'ytics_ai_settings'
{
  provider: 'ollama',           // 'ollama' | 'gemini' | 'claude' | 'openai'
  apiKey: '',                   // encrypted or plain (localStorage only, never sent to our servers)
  model: 'llama3.1:8b',
  endpoint: '',                 // custom endpoint override (empty = use default)
  enabled: true,                // global on/off toggle
}
```

API keys stored in localStorage. Never included in `.ytics` exports.
Never sent anywhere except the configured provider endpoint.

### Auto-detection on first load

```js
// On app mount, try Ollama at localhost:11434
// If reachable: set provider='ollama', show "AI ready" indicator
// If not: show "Configure AI" in settings, no error
```

---

## 5. Phase 3: Context Builder

### File: `src/ai/context.js`

Builds a compact system prompt + context object from app state.

#### Developer mode context

```js
function buildDeveloperContext(state) {
  return {
    systemPrompt: `You are an AI assistant for Ytics, a dashboard builder.
You help users create and configure data visualizations.
You can add widgets, update their configuration, and suggest chart types.
Always use tool calls to make changes — never just describe what to do.
Be concise in your text responses.`,

    context: `
## Datasets
${state.datasets.map(d => `
### ${d.name} (id: ${d.id})
Columns: ${Object.entries(d.columnTypes).map(([name, type]) => `${name} (${type})`).join(', ')}
Rows: ${d.data.length}
`).join('\n')}

## Current Dashboard
Title: ${state.dashboard.title || '(untitled)'}
Pages: ${state.dashboard.pages.length}
Current page widgets: ${getCurrentPageWidgets(state).map(w =>
  `${w.title} (${w.type}, x=${w.xField}, y=${w.yField})`
).join('; ') || 'none'}

## Available chart types
bar, line, scatter, pie, histogram, combo, kpi, heatmap, treemap,
funnel, radar, boxplot, violin, waterfall, waffle, wordcloud, sankey,
bubble, bump, stream, correlogram, density, mekko, geo, pivot,
straighttable, table, carousel, graph, network, text, image, embed
`
  };
}
```

#### Viewer mode context

```js
function buildViewerContext(state) {
  return {
    systemPrompt: `You are a data analyst assistant for Ytics.
You help users understand their data by answering questions, finding patterns,
and creating simple visualizations. Use the query_data tool to examine data
before answering questions. Be specific and cite numbers.`,

    context: `
## Datasets
${state.datasets.map(d => `
### ${d.name} (id: ${d.id})
Columns: ${Object.entries(d.columnTypes).map(([name, type]) => `${name} (${type})`).join(', ')}
Rows: ${d.data.length}
Sample (first 5 rows): ${JSON.stringify(d.data.slice(0, 5))}
`).join('\n')}

## Active Selections
${Object.entries(state.selections || {}).map(([field, values]) =>
  values.length > 0 ? `${field}: ${values.join(', ')}` : `${field}: all`
).join('\n') || 'None'}
`
  };
}
```

**Key design choice**: Developer context sends NO raw data (just schemas). Viewer context sends
5 sample rows to help the AI understand data shape, but relies on `query_data` tool for actual analysis.

---

## 6. Phase 4: Developer Tools

### File: `src/ai/tools.js`

Tool definitions follow OpenAI function calling format (most universal):

```js
export const DEVELOPER_TOOLS = [
  {
    type: 'function',
    function: {
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
            description: 'Chart type'
          },
          title: { type: 'string', description: 'Widget title' },
          datasetId: { type: 'string', description: 'Dataset ID to use. Omit to use first dataset.' },
          xField: { type: 'string', description: 'X-axis / dimension field name' },
          yField: { type: 'string', description: 'Y-axis / measure field name' },
          valueField: { type: 'string', description: 'Value field (for KPI, geo, etc.)' },
          colorField: { type: 'string', description: 'Color/series breakdown field' },
          aggregation: {
            type: 'string',
            enum: ['sum', 'avg', 'count', 'min', 'max', 'median'],
            description: 'Aggregation function (default: sum)'
          },
        },
        required: ['type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_widget',
      description: 'Update properties of an existing widget by its ID.',
      parameters: {
        type: 'object',
        properties: {
          widgetId: { type: 'string', description: 'The widget ID to update' },
          updates: {
            type: 'object',
            description: 'Key-value pairs of properties to update. Common: title, xField, yField, colorField, aggregation, type, colorScheme, showGrid, showLegend, numberFormat, sortBy, sortOrder, showRegression, regressionType, useLogScale, orientation'
          }
        },
        required: ['widgetId', 'updates']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_widget',
      description: 'Remove a widget from the dashboard.',
      parameters: {
        type: 'object',
        properties: {
          widgetId: { type: 'string', description: 'The widget ID to remove' }
        },
        required: ['widgetId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_dashboard_title',
      description: 'Set the dashboard title.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'suggest_charts',
      description: 'Analyze a dataset schema and suggest appropriate chart configurations. Call this when the user asks "what charts should I make?" or similar. Returns suggestions as text, does not create widgets.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string', description: 'Dataset to analyze. Omit for first dataset.' }
        }
      }
    }
  }
];
```

### File: `src/ai/toolExecutor.js`

```js
export function executeTool(toolCall, dispatch, state) {
  const { name, args } = toolCall;

  switch (name) {
    case 'add_widget': {
      const payload = { type: args.type, title: args.title || `${args.type} Chart` };
      // Map common fields
      if (args.xField) payload.xField = args.xField;
      if (args.yField) payload.yField = args.yField;
      if (args.valueField) payload.valueField = args.valueField;
      if (args.colorField) payload.colorField = args.colorField;
      if (args.aggregation) payload.aggregation = args.aggregation;
      if (args.datasetId) payload.datasetId = args.datasetId;
      dispatch({ type: 'ADD_WIDGET', payload });
      return { success: true, message: `Added ${args.type} chart "${payload.title}"` };
    }

    case 'update_widget':
      dispatch({ type: 'UPDATE_WIDGET', payload: { id: args.widgetId, updates: args.updates } });
      return { success: true, message: `Updated widget ${args.widgetId}` };

    case 'remove_widget':
      dispatch({ type: 'REMOVE_WIDGET', payload: args.widgetId });
      return { success: true, message: `Removed widget ${args.widgetId}` };

    case 'set_dashboard_title':
      dispatch({ type: 'SET_DASHBOARD_TITLE', payload: args.title });
      return { success: true, message: `Title set to "${args.title}"` };

    case 'suggest_charts': {
      const ds = state.datasets.find(d => d.id === args.datasetId) || state.datasets[0];
      if (!ds) return { error: 'No dataset found' };
      // Return schema info for the AI to reason about
      return {
        datasetName: ds.name,
        columns: Object.entries(ds.columnTypes).map(([name, type]) => ({ name, type })),
        rowCount: ds.data.length,
        message: 'Analyze these columns and suggest chart configurations.'
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
```

---

## 7. Phase 5: Chat Panel UI

### File: `src/components/AIChat/AIChatPanel.js`

Side panel that slides in from the right. Visible in both Developer and Viewer modes.

#### Layout structure

```
+------------------------------------------+
| AI Assistant                    [gear] [X]|
+------------------------------------------+
| [status: Ollama connected / Configure...] |
+------------------------------------------+
|                                          |
| User: Create a bar chart of sales by     |
|       region                             |
|                                          |
| AI: [tool: add_widget] Added bar chart   |
|     "Sales by Region"                    |
|     I created a bar chart with Region    |
|     on the X axis and Sales on Y.        |
|                                          |
| User: Make it horizontal                 |
|                                          |
| AI: [tool: update_widget] Updated        |
|     Done! The chart is now horizontal.   |
|                                          |
+------------------------------------------+
| [Type a message...]            [Send]    |
+------------------------------------------+
```

#### Key UI behaviors

- **Toggle button**: In Header.js, add an AI button (brain icon or sparkle) that toggles panel
- **Panel width**: 380px, slides from right, overlays the canvas (doesn't push it)
- **Messages**: Scrollable list. User messages right-aligned, AI messages left-aligned.
- **Tool calls**: Shown as small collapsible cards within AI messages (e.g., "Added bar chart")
- **Streaming**: Text appears incrementally as it streams
- **Settings gear**: Opens AISettings modal
- **Connection status**: Small indicator showing provider name + status
- **Clear chat**: Button to reset conversation
- **Context-aware**: Automatically switches tool set based on current mode (developer/viewer)

#### State management

Chat state is local to the component (useState), NOT in AppContext:

```js
const [messages, setMessages] = useState([]);
// message shape: { role: 'user'|'assistant'|'tool', content: string, toolCalls?: [], toolResults?: [] }
const [isStreaming, setIsStreaming] = useState(false);
const [isOpen, setIsOpen] = useState(false);
```

### File: `src/ai/useAI.js`

Custom hook that handles the chat loop:

```js
function useAI(dispatch, state) {
  // 1. Load provider settings from localStorage
  // 2. Create provider adapter
  // 3. Expose: sendMessage(text), messages, isStreaming, clearChat

  async function sendMessage(userText) {
    // a. Add user message to history
    // b. Build context (developer or viewer based on state.mode)
    // c. Call provider.chat(messages, tools, options)
    // d. Stream response text to UI
    // e. If tool calls received:
    //    - Execute each tool via toolExecutor
    //    - Add tool results to message history
    //    - Call provider.chat again with tool results (agentic loop)
    //    - Repeat until no more tool calls
    // f. Mark streaming complete
  }
}
```

#### Agentic tool loop

```
User: "Create 3 charts for my sales data"
  -> AI returns: tool_call(add_widget bar), tool_call(add_widget line), tool_call(add_widget pie)
  -> Execute all 3 tools
  -> Send tool results back to AI
  -> AI responds: "I've created 3 charts: a bar chart showing..."
```

---

## 8. Phase 6: Viewer Tools

```js
export const VIEWER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_data',
      description: 'Query a dataset. Runs locally — data never leaves the browser. Use this to answer questions about the data.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string', description: 'Dataset ID. Omit for first dataset.' },
          fields: {
            type: 'array', items: { type: 'string' },
            description: 'Fields to include in results'
          },
          filter: {
            type: 'object',
            description: 'Filter conditions: { field: { op: "eq"|"gt"|"lt"|"gte"|"lte"|"contains"|"in", value: any } }'
          },
          groupBy: { type: 'string', description: 'Field to group by' },
          aggregation: {
            type: 'object',
            description: 'Aggregations: { fieldName: "sum"|"avg"|"count"|"min"|"max" }'
          },
          sortBy: { type: 'string', description: 'Field to sort by' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number', description: 'Max rows to return (default: 20)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'describe_data',
      description: 'Get statistical summary of a dataset or specific fields. Returns count, mean, median, min, max, std, unique values for each field.',
      parameters: {
        type: 'object',
        properties: {
          datasetId: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields. Omit for all.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_selection',
      description: 'Set a selection/filter on a field. This filters all charts in the dashboard.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Field name to filter' },
          values: {
            type: 'array', items: { type: 'string' },
            description: 'Values to select. Empty array = clear (show all).'
          }
        },
        required: ['field', 'values']
      }
    }
  }
];
```

#### Viewer tool executor additions

```js
case 'query_data': {
  const ds = findDataset(state, args.datasetId);
  if (!ds) return { error: 'Dataset not found' };
  let rows = [...ds.data];
  // Apply filters
  if (args.filter) {
    for (const [field, cond] of Object.entries(args.filter)) {
      rows = rows.filter(row => applyCondition(row[field], cond));
    }
  }
  // Apply groupBy + aggregation
  if (args.groupBy && args.aggregation) {
    rows = groupAndAggregate(rows, args.groupBy, args.aggregation);
  }
  // Sort
  if (args.sortBy) {
    rows.sort((a, b) => compare(a[args.sortBy], b[args.sortBy], args.sortOrder));
  }
  // Limit
  rows = rows.slice(0, args.limit || 20);
  // Select fields
  if (args.fields) {
    rows = rows.map(r => pick(r, args.fields));
  }
  return { rows, totalMatched: rows.length };
}

case 'describe_data': {
  const ds = findDataset(state, args.datasetId);
  if (!ds) return { error: 'Dataset not found' };
  const fields = args.fields || Object.keys(ds.columnTypes);
  const summary = {};
  for (const f of fields) {
    const vals = ds.data.map(r => r[f]).filter(v => v != null);
    if (ds.columnTypes[f] === 'number') {
      const nums = vals.map(Number).filter(n => !isNaN(n));
      summary[f] = {
        type: 'number', count: nums.length,
        min: Math.min(...nums), max: Math.max(...nums),
        mean: nums.reduce((a,b) => a+b, 0) / nums.length,
        // median, std...
      };
    } else {
      const unique = [...new Set(vals.map(String))];
      summary[f] = {
        type: ds.columnTypes[f], count: vals.length,
        unique: unique.length,
        topValues: countTop(vals, 5),
      };
    }
  }
  return summary;
}

case 'set_selection':
  dispatch({ type: 'SET_SELECTION', payload: { field: args.field, values: args.values } });
  return { success: true, message: `Selection set on ${args.field}` };
```

---

## 9. Phase 7: Integration with App

### Changes to existing files

#### `src/App.js`
- Import `AIChatPanel`
- Add state: `const [aiOpen, setAiOpen] = useState(false)`
- Pass `onAIToggle` to `Header`
- Render `{aiOpen && <AIChatPanel onClose={() => setAiOpen(false)} />}`

#### `src/components/Header.js`
- Add AI toggle button in the header bar (sparkle/brain icon)
- Show connection status dot (green if connected)

#### `src/App.css`
- Add styles for `.ai-chat-panel` (side panel)
- Add styles for `.ai-message`, `.ai-message--user`, `.ai-message--assistant`
- Add styles for `.ai-tool-card` (collapsed tool call display)
- Add styles for `.ai-settings-modal`

### CSS for the side panel

```css
.ai-chat-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 400px;
  height: 100vh;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 20px rgba(0,0,0,0.08);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  animation: slideInRight 0.2s ease-out;
}
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

---

## 10. State Shape Reference

### AI Settings (localStorage: `ytics_ai_settings`)

```js
{
  provider: 'ollama',
  apiKey: '',
  model: 'llama3.1:8b',
  endpoint: '',
  enabled: true,
}
```

### Chat messages (component-local state)

```js
[
  { id: 'msg_1', role: 'user', content: 'Create a bar chart of sales by region' },
  { id: 'msg_2', role: 'assistant', content: 'I\'ll create that for you.',
    toolCalls: [{ id: 'tc_1', name: 'add_widget', args: { type: 'bar', xField: 'Region', yField: 'Sales' } }]
  },
  { id: 'msg_3', role: 'tool', toolCallId: 'tc_1', content: '{"success": true, "message": "Added bar chart"}' },
  { id: 'msg_4', role: 'assistant', content: 'Done! I created a bar chart showing Sales by Region.' },
]
```

---

## 11. Existing Codebase Reference

### Dispatch actions the AI can use

```js
// ADD_WIDGET — adds widget to current page
dispatch({ type: 'ADD_WIDGET', payload: { type: 'bar', title: 'My Chart', xField: 'Category', yField: 'Value' } });
// Widget gets default 12x5 grid size, placed at first available slot.
// Sets editingWidgetId to new widget.

// UPDATE_WIDGET — update any widget properties
dispatch({ type: 'UPDATE_WIDGET', payload: { id: 'widget-uuid', updates: { colorField: 'Region', aggregation: 'avg' } } });

// REMOVE_WIDGET
dispatch({ type: 'REMOVE_WIDGET', payload: 'widget-uuid' });

// SET_DASHBOARD_TITLE
dispatch({ type: 'SET_DASHBOARD_TITLE', payload: 'My Dashboard' });

// SET_SELECTION (viewer)
dispatch({ type: 'SET_SELECTION', payload: { field: 'Country', values: ['Argentina', 'Brazil'] } });

// CLEAR_SELECTION
dispatch({ type: 'CLEAR_SELECTION', payload: 'Country' });
```

### Widget type -> required fields mapping

| Type | Required | Common optional |
|------|----------|----------------|
| bar | xField, yField | colorField, aggregation, orientation, sortBy |
| line | xField, yField | colorField, showArea, showPoints, curveType |
| scatter | xField, yField | colorField, sizeField, showRegression |
| pie | xField, valueField | innerRadius (donut), showSliceValues |
| histogram | xField | bins |
| kpi | valueField | aggregation, numberFormat |
| heatmap | xField, yField, valueField | |
| geo | geoField | valueField OR colorField, geoColorMode |
| table | - | (shows all data) |
| straighttable | - | straightTableMeasures |
| treemap | xField, valueField | colorField |
| funnel | xField, valueField | |
| radar | xField, yField | |
| boxplot | xField, yField | |
| violin | xField, yField | |
| waterfall | xField, yField | |
| combo | xField, yField | y2Field, comboMeasures |
| sankey | sourceField, targetField, valueField | |
| wordcloud | xField | valueField |
| bubble | xField, yField, sizeField | |
| correlogram | correlogramFields[] | correlogramMode |

### Dataset shape

```js
{
  id: 'uuid',
  name: 'sales.csv',
  data: [{ Country: 'Argentina', Sales: 100, Year: 2024 }, ...],
  originalData: [...],  // before transforms
  columnTypes: { Country: 'string', Sales: 'number', Year: 'number' },
  transforms: [],
}
```

### App state accessed via useApp()

```js
const { state, dispatch } = useApp();
// state.mode: 'developer' | 'viewer'
// state.datasets: Dataset[]
// state.dashboard: { title, pages, currentPageId, theme, ... }
// state.dashboard.pages[i]: { id, name, widgets: Widget[], layout: LayoutItem[] }
// state.selections: { [field]: string[] }
// state.colStore: { dicts, tables } (columnar store for associative model)
```

---

## Implementation Order

1. **Phase 1**: `src/ai/providers.js` — All 4 adapters with streaming + tool calling
2. **Phase 2**: `src/components/AIChat/AISettings.js` — Settings modal
3. **Phase 3**: `src/ai/context.js` — Context builder
4. **Phase 4**: `src/ai/tools.js` + `src/ai/toolExecutor.js` — Developer tools first
5. **Phase 5**: `src/components/AIChat/AIChatPanel.js` + `src/ai/useAI.js` — Chat UI + hook
6. **Phase 6**: Add viewer tools to `tools.js` + `toolExecutor.js`
7. **Phase 7**: Wire into `App.js` + `Header.js`, add CSS

Each phase is independently testable. Phase 1-5 gives a working developer assistant.
Phase 6 extends it to viewer mode. Phase 7 is final integration.

---

## Testing Strategy

- **Ollama**: Install Ollama, pull `llama3.1:8b`, run `ollama serve`. Test locally.
- **Gemini**: Get free API key from Google AI Studio. Test with `gemini-2.0-flash`.
- **Claude/OpenAI**: Need API keys with credits.
- **Unit**: Test tool execution independently of AI (mock tool calls, verify dispatches).
- **Integration**: Send a known prompt, verify tool calls are made correctly.
