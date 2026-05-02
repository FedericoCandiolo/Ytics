import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useAI } from '../../ai/useAI';
import { loadSettings } from '../../ai/providers';
import AISettings from './AISettings';
import MarkdownRenderer from './MarkdownRenderer';

function ToolCallCard({ tc }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="ai-tool-call" onClick={() => setExpanded(v => !v)}>
      <div className="ai-tool-call-header">
        <span className="ai-tool-call-icon">&#9881;</span>
        <span className="ai-tool-call-name">{tc.name}</span>
        <span className="ai-tool-call-toggle">{expanded ? '&#9662;' : '&#9656;'}</span>
      </div>
      {expanded && (
        <pre className="ai-tool-call-args">{JSON.stringify(tc.args, null, 2)}</pre>
      )}
    </div>
  );
}

function ToolResultCard({ msg }) {
  const [expanded, setExpanded] = useState(false);
  let parsed;
  try { parsed = JSON.parse(msg.content); } catch { parsed = msg.content; }
  const summary = parsed?.message || parsed?.error || (parsed?.success ? 'Done' : 'Result');

  return (
    <div className="ai-tool-result" onClick={() => setExpanded(v => !v)}>
      <div className="ai-tool-result-header">
        <span style={{ fontSize: 11 }}>{parsed?.error ? '!' : '>'}</span>
        <span>{summary}</span>
        <span className="ai-tool-call-toggle">{expanded ? '&#9662;' : '&#9656;'}</span>
      </div>
      {expanded && (
        <pre className="ai-tool-call-args">{JSON.stringify(parsed, null, 2)}</pre>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  if (msg.role === 'user') {
    return <div className="ai-msg ai-msg-user"><div className="ai-msg-content">{msg.content}</div></div>;
  }
  if (msg.role === 'tool') {
    return <div className="ai-msg ai-msg-tool"><ToolResultCard msg={msg} /></div>;
  }
  // assistant
  return (
    <div className={`ai-msg ai-msg-assistant ${msg.isError ? 'ai-msg-error' : ''}`}>
      {msg.toolCalls?.length > 0 && (
        <div className="ai-tool-calls">
          {msg.toolCalls.map((tc, i) => <ToolCallCard key={tc.id || i} tc={tc} />)}
        </div>
      )}
      {msg.content && (
        <div className="ai-msg-content">
          <MarkdownRenderer content={msg.content} />
        </div>
      )}
    </div>
  );
}

function ConversationList({ conversations, activeId, onSwitch, onNew, onDelete, onExport, onClose }) {
  return (
    <div className="ai-history">
      <div className="ai-history-header">
        <span style={{ fontWeight: 600, fontSize: 13 }}>Conversations</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>&#10005;</button>
      </div>
      <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 8 }} onClick={onNew}>
        + New chat
      </button>
      <div className="ai-history-list">
        {conversations.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            No conversations yet
          </div>
        )}
        {conversations.map(c => (
          <div
            key={c.id}
            className={`ai-history-item ${c.id === activeId ? 'ai-history-item--active' : ''}`}
            onClick={() => onSwitch(c.id)}
          >
            <div className="ai-history-item-title">{c.title}</div>
            <div className="ai-history-item-meta">
              {c.mode === 'developer' ? 'Builder' : 'Analyst'} &middot; {new Date(c.updatedAt).toLocaleDateString()}
            </div>
            <div className="ai-history-item-actions" onClick={e => e.stopPropagation()}>
              <button className="btn btn-ghost btn-sm" onClick={() => onExport(c.id)} title="Download as markdown" style={{ fontSize: 11, padding: '2px 4px' }}>
                &#8595;
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => onDelete(c.id)} title="Delete" style={{ fontSize: 11, padding: '2px 4px', color: 'var(--danger, #ef4444)' }}>
                &#10005;
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AIChatPanel({ onClose }) {
  const { state, dispatch } = useApp();
  const {
    messages, isStreaming, sendMessage, clearChat, stop,
    conversations, activeId, newChat, switchChat, deleteChat, exportMarkdown,
  } = useAI(dispatch, state);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const settings = loadSettings();
  const providerName = { ollama: 'Ollama', gemini: 'Gemini', claude: 'Claude', openai: 'OpenAI' }[settings.provider] || settings.provider;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="ai-panel">
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <span style={{ fontSize: 15, fontWeight: 600 }}>AI Assistant</span>
          <span className="ai-panel-mode">{state.mode === 'developer' ? 'Builder' : 'Analyst'}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(v => !v)} title="History">
            &#9776;
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} title="Settings">
            &#9881;
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close">
            &#10005;
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="ai-panel-status">
        <span className={`ai-status-dot ${settings.enabled ? 'ai-status-on' : 'ai-status-off'}`} />
        <span style={{ fontSize: 11 }}>{providerName}</span>
        {activeId && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            {conversations.find(c => c.id === activeId)?.title}
          </span>
        )}
      </div>

      {/* History sidebar overlay */}
      {showHistory && (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSwitch={(id) => { switchChat(id); setShowHistory(false); }}
          onNew={() => { newChat(); setShowHistory(false); }}
          onDelete={deleteChat}
          onExport={exportMarkdown}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* Messages */}
      <div className="ai-panel-messages">
        {messages.length === 0 && (
          <div className="ai-panel-empty">
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>&#10024;</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              {state.mode === 'developer' ? 'Build your dashboard faster' : 'Ask questions about your data'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {state.mode === 'developer'
                ? 'Try: "Create a bar chart of sales by region"'
                : 'Try: "What are the top 5 products by revenue?"'}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {isStreaming && (
          <div className="ai-streaming-indicator">
            <span className="ai-dot-pulse" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form className="ai-panel-input" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="ai-input-field"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={!settings.enabled}
        />
        <div className="ai-input-actions">
          {isStreaming ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={stop}>Stop</button>
          ) : (
            <button type="submit" className="btn btn-primary btn-sm" disabled={!input.trim() || !settings.enabled}>
              Send
            </button>
          )}
          {messages.length > 0 && !isStreaming && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => newChat()} title="New chat">
                +
              </button>
              {activeId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportMarkdown(activeId)} title="Download chat as markdown">
                  &#8595;
                </button>
              )}
            </>
          )}
        </div>
      </form>

      {/* Settings modal */}
      {showSettings && <AISettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
