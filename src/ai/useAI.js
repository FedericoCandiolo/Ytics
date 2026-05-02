import { useState, useCallback, useRef, useEffect } from 'react';
import { loadSettings, chat } from './providers';
import { buildContext } from './context';
import { DEVELOPER_TOOLS, VIEWER_TOOLS } from './tools';
import { executeTool } from './toolExecutor';

const MAX_TOOL_ROUNDS = 5;
const GEMINI_DELAY_MS = 4000;
const HISTORY_KEY = 'ytics_ai_history';
const MAX_CONVERSATIONS = 50;

// ── Conversation persistence ────────────────────────────────────────────────

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveHistory(conversations) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
  } catch { /* quota exceeded — trim */ }
}

function makeConversation(mode) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: 'New chat',
    mode,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function titleFromFirstMessage(text) {
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > 40 ? clean.slice(0, 40) + '...' : clean;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAI(dispatch, state) {
  const [conversations, setConversations] = useState(loadHistory);
  const [activeId, setActiveId] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(null);

  const active = conversations.find(c => c.id === activeId) || null;
  const messages = active?.messages || [];

  // Persist conversations on change
  useEffect(() => {
    saveHistory(conversations);
  }, [conversations]);

  const updateConversation = useCallback((id, updater) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, ...updater(c), updatedAt: Date.now() } : c));
  }, []);

  const newChat = useCallback(() => {
    const conv = makeConversation(state.mode);
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
  }, [state.mode]);

  const switchChat = useCallback((id) => {
    setActiveId(id);
  }, []);

  const deleteChat = useCallback((id) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const clearChat = useCallback(() => {
    if (activeId) {
      updateConversation(activeId, () => ({ messages: [], title: 'New chat' }));
    }
  }, [activeId, updateConversation]);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort = true;
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isStreaming) return;

    const settings = loadSettings();
    if (!settings.enabled) return;

    // Auto-create conversation if none active
    let convId = activeId;
    if (!convId) {
      const conv = makeConversation(state.mode);
      setConversations(prev => [conv, ...prev]);
      setActiveId(conv.id);
      convId = conv.id;
    }

    const tools = state.mode === 'developer' ? DEVELOPER_TOOLS : VIEWER_TOOLS;
    const systemPrompt = buildContext(state, settings.lightMode || false);

    const userMsg = { role: 'user', content: userText };

    // Update title from first user message
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const isFirst = c.messages.filter(m => m.role === 'user').length === 0;
      return {
        ...c,
        messages: [...c.messages, userMsg],
        title: isFirst ? titleFromFirstMessage(userText) : c.title,
        updatedAt: Date.now(),
      };
    }));

    setIsStreaming(true);
    const ctrl = { abort: false };
    abortRef.current = ctrl;

    // Get current messages for API context
    const currentMessages = [...(conversations.find(c => c.id === convId)?.messages || []), userMsg];
    let conversationMessages = currentMessages;

    try {
      let round = 0;
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        if (ctrl.abort) break;

        const assistantMsg = { role: 'assistant', content: '', toolCalls: [] };

        updateConversation(convId, c => ({ messages: [...c.messages, assistantMsg] }));

        const stream = chat(settings, conversationMessages, tools, systemPrompt);

        for await (const chunk of stream) {
          if (ctrl.abort) break;

          if (chunk.type === 'text') {
            assistantMsg.content += chunk.content;
            updateConversation(convId, c => {
              const msgs = [...c.messages];
              msgs[msgs.length - 1] = { ...assistantMsg };
              return { messages: msgs };
            });
          } else if (chunk.type === 'tool_call') {
            assistantMsg.toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
            updateConversation(convId, c => {
              const msgs = [...c.messages];
              msgs[msgs.length - 1] = { ...assistantMsg };
              return { messages: msgs };
            });
          }
        }

        if (ctrl.abort) break;
        if (assistantMsg.toolCalls.length === 0) break;

        conversationMessages = [...conversationMessages, assistantMsg];
        const toolResults = [];

        for (const tc of assistantMsg.toolCalls) {
          const result = executeTool(tc, dispatch, state);
          const toolMsg = {
            role: 'tool',
            toolCallId: tc.id,
            toolName: tc.name,
            content: JSON.stringify(result),
          };
          toolResults.push(toolMsg);
          updateConversation(convId, c => ({ messages: [...c.messages, toolMsg] }));
        }

        conversationMessages = [...conversationMessages, ...toolResults];

        if (settings.provider === 'gemini') {
          await new Promise(r => setTimeout(r, GEMINI_DELAY_MS));
        }
      }
    } catch (err) {
      const errorMsg = { role: 'assistant', content: `Error: ${err.message}`, isError: true };
      updateConversation(convId, c => ({ messages: [...c.messages, errorMsg] }));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [conversations, activeId, isStreaming, dispatch, state, updateConversation]);

  // Export conversation as markdown
  const exportMarkdown = useCallback((id) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    let md = `# ${conv.title}\n\n`;
    md += `*${conv.mode === 'developer' ? 'Developer' : 'Viewer'} mode — ${new Date(conv.createdAt).toLocaleString()}*\n\n---\n\n`;

    for (const msg of conv.messages) {
      if (msg.role === 'user') {
        md += `## You\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## AI\n\n`;
        if (msg.toolCalls?.length > 0) {
          for (const tc of msg.toolCalls) {
            md += `> **Tool:** \`${tc.name}\`\n`;
            md += `> \`\`\`json\n> ${JSON.stringify(tc.args, null, 2).split('\n').join('\n> ')}\n> \`\`\`\n\n`;
          }
        }
        if (msg.content) md += `${msg.content}\n\n`;
      } else if (msg.role === 'tool') {
        let parsed;
        try { parsed = JSON.parse(msg.content); } catch { parsed = msg.content; }
        const summary = parsed?.message || parsed?.error || 'Result';
        md += `> **Result:** ${summary}\n\n`;
      }
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'chat'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [conversations]);

  return {
    messages,
    isStreaming,
    sendMessage,
    clearChat,
    stop,
    conversations,
    activeId,
    newChat,
    switchChat,
    deleteChat,
    exportMarkdown,
  };
}
