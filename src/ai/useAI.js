import { useState, useCallback, useRef } from 'react';
import { loadSettings, chat } from './providers';
import { buildContext } from './context';
import { DEVELOPER_TOOLS, VIEWER_TOOLS } from './tools';
import { executeTool } from './toolExecutor';

const MAX_TOOL_ROUNDS = 5;
const GEMINI_DELAY_MS = 4000; // Gemini free tier: 15 RPM → space requests apart

export function useAI(dispatch, state) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(null);

  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort = true;
    }
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isStreaming) return;

    const settings = loadSettings();
    if (!settings.enabled) return;

    const tools = state.mode === 'developer' ? DEVELOPER_TOOLS : VIEWER_TOOLS;
    const systemPrompt = buildContext(state, settings.lightMode || false);

    // Add user message
    const userMsg = { role: 'user', content: userText };
    setMessages(prev => [...prev, userMsg]);

    setIsStreaming(true);
    const ctrl = { abort: false };
    abortRef.current = ctrl;

    // Build full conversation for the API
    let conversationMessages = [...messages, userMsg];

    try {
      let round = 0;
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        if (ctrl.abort) break;

        // Start streaming assistant response
        const assistantMsg = { role: 'assistant', content: '', toolCalls: [] };
        setMessages(prev => [...prev, assistantMsg]);

        const stream = chat(settings, conversationMessages, tools, systemPrompt);

        for await (const chunk of stream) {
          if (ctrl.abort) break;

          if (chunk.type === 'text') {
            assistantMsg.content += chunk.content;
            setMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { ...assistantMsg };
              return next;
            });
          } else if (chunk.type === 'tool_call') {
            assistantMsg.toolCalls.push({
              id: chunk.id,
              name: chunk.name,
              args: chunk.args,
            });
            setMessages(prev => {
              const next = [...prev];
              next[next.length - 1] = { ...assistantMsg };
              return next;
            });
          }
        }

        if (ctrl.abort) break;

        // If no tool calls, we're done
        if (assistantMsg.toolCalls.length === 0) break;

        // Execute tool calls and add results
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
          setMessages(prev => [...prev, toolMsg]);
        }

        conversationMessages = [...conversationMessages, ...toolResults];

        // Gemini free tier rate limiting: wait before next request
        if (settings.provider === 'gemini') {
          await new Promise(r => setTimeout(r, GEMINI_DELAY_MS));
        }
      }
    } catch (err) {
      const errorMsg = { role: 'assistant', content: `Error: ${err.message}`, isError: true };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, dispatch, state]);

  return { messages, isStreaming, sendMessage, clearChat, stop };
}
