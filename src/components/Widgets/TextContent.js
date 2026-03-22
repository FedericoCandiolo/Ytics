/**
 * Text Content Widget — renders static or dynamic text.
 * Supports plain text, Markdown, and HTML modes.
 * Dynamic measures: use {{fieldName}} or {{aggregation:fieldName}} in the text.
 */
import { useMemo } from 'react';
import { aggregate, formatValue } from '../../utils/dataUtils';

// ── Measure interpolation ────────────────────────────────────────────────────

function resolveMeasures(template, data, defaultAgg, numberFormat) {
  if (!template || !data?.length) return template || '';
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const trimmed = expr.trim();
    let agg = defaultAgg || 'sum';
    let field = trimmed;
    // Support {{aggregation:fieldName}} syntax
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const maybeAgg = trimmed.slice(0, colonIdx).toLowerCase().trim();
      const aggList = ['sum','count','mean','min','max','median','std','p25','p75','p90','p95'];
      if (aggList.includes(maybeAgg)) {
        agg = maybeAgg;
        field = trimmed.slice(colonIdx + 1).trim();
      }
    }
    // Check if field exists in data
    if (data.length > 0 && !(field in data[0])) return `{{${trimmed}}}`;
    const vals = data.map(r => +r[field] || 0);
    const result = aggregate(vals, agg);
    return formatValue(result, numberFormat);
  });
}

// ── Minimal Markdown → HTML ──────────────────────────────────────────────────

function markdownToHtml(md) {
  let html = md
    // Escape HTML entities (safety)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```...```)
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre style="background:var(--chart-grid-color,#f3f4f6);padding:8px;border-radius:4px;overflow-x:auto;font-size:0.9em"><code>${code.trim()}</code></pre>`
  );
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--chart-grid-color,#f3f4f6);padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');

  // Headers (### before ## before #)
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:12px 0 4px;font-size:1.1em">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:14px 0 4px;font-size:1.25em">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:16px 0 6px;font-size:1.5em">$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--chart-grid-color,#e5e7eb);margin:12px 0"/>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">$1</a>');

  // Unordered lists (- item)
  html = html.replace(/(?:^|\n)((?:- .+\n?)+)/g, (_, block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
    return `<ul style="margin:6px 0;padding-left:20px">${items}</ul>`;
  });

  // Ordered lists (1. item)
  html = html.replace(/(?:^|\n)((?:\d+\. .+\n?)+)/g, (_, block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol style="margin:6px 0;padding-left:20px">${items}</ol>`;
  });

  // Line breaks (double newline = paragraph, single = <br>)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br/>');
  html = `<p>${html}</p>`;
  // Clean empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TextContent({ widget, data }) {
  const content = widget.staticContent || '';
  const mode = widget.contentMode || 'plain';
  const textAlign = widget.textAlign || 'left';
  const fontSize = widget.textFontSize || 14;

  const resolved = useMemo(
    () => resolveMeasures(content, data, widget.aggregation, widget.numberFormat),
    [content, data, widget.aggregation, widget.numberFormat]
  );

  const containerStyle = {
    width: '100%',
    height: '100%',
    padding: 12,
    overflow: 'auto',
    fontFamily: 'var(--font)',
    fontSize,
    color: 'var(--text)',
    textAlign,
    lineHeight: 1.6,
    boxSizing: 'border-box',
  };

  if (!content.trim()) {
    return (
      <div style={{ ...containerStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Click to edit — add text, Markdown, or HTML content
      </div>
    );
  }

  if (mode === 'html') {
    return <div style={containerStyle} dangerouslySetInnerHTML={{ __html: resolved }} />;
  }

  if (mode === 'markdown') {
    const html = markdownToHtml(resolved);
    return <div style={containerStyle} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Plain text
  return (
    <div style={{ ...containerStyle, whiteSpace: 'pre-wrap' }}>
      {resolved}
    </div>
  );
}
