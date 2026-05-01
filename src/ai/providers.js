// ── AI Provider Abstraction ──────────────────────────────────────────────────
// Unified interface for Ollama (local), Gemini, Claude, and OpenAI.
// All adapters expose: chat(messages, tools, options) -> AsyncGenerator<chunk>
// Chunk types: { type: 'text', content } | { type: 'tool_call', id, name, args } | { type: 'done' }

const SETTINGS_KEY = 'ytics_ai_settings';

export const PROVIDERS = {
  ollama:  { name: 'Ollama (Local)',  needsKey: false, defaultModel: 'llama3.1:8b', defaultEndpoint: 'http://localhost:11434' },
  gemini:  { name: 'Google Gemini',   needsKey: true,  defaultModel: 'gemini-2.0-flash', defaultEndpoint: 'https://generativelanguage.googleapis.com' },
  claude:  { name: 'Anthropic Claude',needsKey: true,  defaultModel: 'claude-sonnet-4-20250514', defaultEndpoint: 'https://api.anthropic.com' },
  openai:  { name: 'OpenAI',          needsKey: true,  defaultModel: 'gpt-4o-mini', defaultEndpoint: 'https://api.openai.com' },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { provider: 'ollama', apiKey: '', model: '', endpoint: '', enabled: true, lightMode: false };
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getEffectiveModel(settings) {
  return settings.model || PROVIDERS[settings.provider]?.defaultModel || '';
}

export function getEffectiveEndpoint(settings) {
  return settings.endpoint || PROVIDERS[settings.provider]?.defaultEndpoint || '';
}

// ── Shared SSE line parser ──────────────────────────────────────────────────
async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try { yield JSON.parse(data); } catch { /* skip malformed */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Convert tools to OpenAI format (used by Ollama + OpenAI) ────────────────
function toOpenAITools(tools) {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// ── Ollama / OpenAI-compatible adapter ──────────────────────────────────────
async function* chatOpenAICompat(endpoint, apiKey, model, messages, tools, systemPrompt) {
  const url = `${endpoint}/v1/chat/completions`;
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  msgs.push(...messages);

  const body = { model, messages: msgs, stream: true };
  const oaiTools = toOpenAITools(tools);
  if (oaiTools) body.tools = oaiTools;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${err}`);
  }

  const pendingToolCalls = new Map(); // index -> { id, name, argsStr }

  for await (const chunk of readSSE(res)) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: 'text', content: delta.content };
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!pendingToolCalls.has(idx)) {
          pendingToolCalls.set(idx, { id: tc.id || `call_${idx}`, name: '', argsStr: '' });
        }
        const pending = pendingToolCalls.get(idx);
        if (tc.id) pending.id = tc.id;
        if (tc.function?.name) pending.name += tc.function.name;
        if (tc.function?.arguments) pending.argsStr += tc.function.arguments;
      }
    }
  }

  // Emit completed tool calls
  for (const [, tc] of pendingToolCalls) {
    let args = {};
    try { args = JSON.parse(tc.argsStr); } catch { /* skip */ }
    yield { type: 'tool_call', id: tc.id, name: tc.name, args };
  }

  yield { type: 'done' };
}

// ── Claude adapter ──────────────────────────────────────────────────────────
function toClaudeTools(tools) {
  if (!tools?.length) return undefined;
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function toClaudeMessages(messages) {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      return { role: 'assistant', content };
    }
    return { role: m.role, content: m.content };
  });
}

async function* chatClaude(endpoint, apiKey, model, messages, tools, systemPrompt) {
  const url = `${endpoint}/v1/messages`;
  const body = {
    model,
    max_tokens: 4096,
    stream: true,
    messages: toClaudeMessages(messages),
  };
  if (systemPrompt) body.system = systemPrompt;
  const ct = toClaudeTools(tools);
  if (ct) body.tools = ct;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${err}`);
  }

  let currentToolId = null;
  let currentToolName = '';
  let currentToolArgs = '';

  for await (const event of readSSE(res)) {
    const type = event.type;

    if (type === 'content_block_start') {
      const block = event.content_block;
      if (block?.type === 'tool_use') {
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolArgs = '';
      }
    } else if (type === 'content_block_delta') {
      const delta = event.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        yield { type: 'text', content: delta.text };
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        currentToolArgs += delta.partial_json;
      }
    } else if (type === 'content_block_stop') {
      if (currentToolId) {
        let args = {};
        try { args = JSON.parse(currentToolArgs); } catch { /* skip */ }
        yield { type: 'tool_call', id: currentToolId, name: currentToolName, args };
        currentToolId = null;
      }
    } else if (type === 'message_stop') {
      break;
    }
  }

  yield { type: 'done' };
}

// ── Gemini adapter ──────────────────────────────────────────────────────────
function toGeminiContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      contents.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: m.toolName || 'tool',
            response: typeof m.content === 'string' ? JSON.parse(m.content || '{}') : m.content,
          },
        }],
      });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
      }
      contents.push({ role: 'model', parts });
    } else {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    }
  }
  return contents;
}

function toGeminiTools(tools) {
  if (!tools?.length) return undefined;
  return [{ functionDeclarations: tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  })) }];
}

async function* chatGemini(endpoint, apiKey, model, messages, tools, systemPrompt) {
  const url = `${endpoint}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const body = {
    contents: toGeminiContents(messages),
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const gt = toGeminiTools(tools);
  if (gt) body.tools = gt;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    if (res.status === 429) {
      // Parse retry delay from Gemini's response
      let retrySec = 30;
      try {
        const errJson = JSON.parse(errText);
        const retryInfo = errJson.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) retrySec = parseInt(retryInfo.retryDelay) || 30;
      } catch { /* use default */ }
      throw new Error(`Gemini rate limit reached. Please wait ~${retrySec}s and try again. If this persists, your daily free quota may be exhausted — try again tomorrow or switch to a different model/provider.`);
    }
    throw new Error(`${res.status}: ${errText}`);
  }

  for await (const chunk of readSSE(res)) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.text) {
        yield { type: 'text', content: part.text };
      } else if (part.functionCall) {
        yield {
          type: 'tool_call',
          id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        };
      }
    }
  }

  yield { type: 'done' };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a chat generator for the configured provider.
 * @param {object} settings - from loadSettings()
 * @param {Array} messages - [{ role, content, toolCalls?, toolCallId? }]
 * @param {Array} tools - [{ name, description, parameters }]
 * @param {string} systemPrompt
 * @returns {AsyncGenerator<{type: 'text'|'tool_call'|'done', ...}>}
 */
export function chat(settings, messages, tools, systemPrompt) {
  const endpoint = getEffectiveEndpoint(settings);
  const model = getEffectiveModel(settings);
  const apiKey = settings.apiKey || '';

  switch (settings.provider) {
    case 'claude':
      return chatClaude(endpoint, apiKey, model, messages, tools, systemPrompt);
    case 'gemini':
      return chatGemini(endpoint, apiKey, model, messages, tools, systemPrompt);
    case 'openai':
      return chatOpenAICompat(endpoint, apiKey, model, messages, tools, systemPrompt);
    case 'ollama':
    default:
      return chatOpenAICompat(endpoint, null, model, messages, tools, systemPrompt);
  }
}

/**
 * Test connection to the configured provider. Returns { ok, models?, error? }
 */
export async function testConnection(settings) {
  const endpoint = getEffectiveEndpoint(settings);
  const apiKey = settings.apiKey || '';

  try {
    switch (settings.provider) {
      case 'ollama': {
        const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        return { ok: true, models: (data.models || []).map(m => m.name) };
      }
      case 'gemini': {
        const res = await fetch(`${endpoint}/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        return { ok: true, models: (data.models || []).filter(m => m.name.includes('gemini')).map(m => m.name.replace('models/', '')) };
      }
      case 'claude': {
        // Claude doesn't have a models list endpoint, just verify auth
        const res = await fetch(`${endpoint}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401) throw new Error('Invalid API key');
        return { ok: true, models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'] };
      }
      case 'openai': {
        const res = await fetch(`${endpoint}/v1/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        const models = (data.data || []).map(m => m.id).filter(id => id.includes('gpt')).sort();
        return { ok: true, models };
      }
      default:
        return { ok: false, error: 'Unknown provider' };
    }
  } catch (err) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
}
