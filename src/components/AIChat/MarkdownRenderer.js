// ── Lightweight Markdown to React renderer ──────────────────────────────────
// Supports: headers, bold, italic, code blocks, inline code, lists, tables, line breaks.
// No external dependencies.

import React from 'react';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseInline(text) {
  const parts = [];
  let i = 0;

  while (i < text.length) {
    // Inline code
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        parts.push(<code key={i} className="ai-md-code">{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    // Bold **text** or __text__
    if ((text[i] === '*' && text[i + 1] === '*') || (text[i] === '_' && text[i + 1] === '_')) {
      const marker = text.slice(i, i + 2);
      const end = text.indexOf(marker, i + 2);
      if (end !== -1) {
        parts.push(<strong key={i}>{parseInline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    }
    // Italic *text* or _text_ (single)
    if ((text[i] === '*' || text[i] === '_') && text[i + 1] !== text[i]) {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end !== -1 && end > i + 1) {
        parts.push(<em key={i}>{parseInline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    }
    // Accumulate plain text
    let j = i + 1;
    while (j < text.length && text[j] !== '`' && text[j] !== '*' && text[j] !== '_') j++;
    parts.push(text.slice(i, j));
    i = j;
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="ai-md-codeblock">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const Tag = `h${level + 2}`; // h3-h6 (keep small in chat)
      elements.push(<Tag key={elements.length} className="ai-md-header">{parseInline(headerMatch[2])}</Tag>);
      i++;
      continue;
    }

    // Table (detect by | at start)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const cells = lines[i].trim().slice(1, -1).split('|').map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      // Filter out separator rows (----)
      const dataRows = tableRows.filter(row => !row.every(c => /^[-:]+$/.test(c)));
      if (dataRows.length > 0) {
        const header = dataRows[0];
        const body = dataRows.slice(1);
        elements.push(
          <div key={elements.length} className="ai-md-table-wrap">
            <table className="ai-md-table">
              <thead>
                <tr>{header.map((c, j) => <th key={j}>{parseInline(c)}</th>)}</tr>
              </thead>
              {body.length > 0 && (
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri}>{row.map((c, ci) => <td key={ci}>{parseInline(c)}</td>)}</tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        );
      }
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={elements.length} className="ai-md-list">
          {items.map((item, j) => <li key={j}>{parseInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s/, ''));
        i++;
      }
      elements.push(
        <ol key={elements.length} className="ai-md-list">
          {items.map((item, j) => <li key={j}>{parseInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      elements.push(<hr key={elements.length} className="ai-md-hr" />);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^#{1,4}\s/.test(lines[i]) && !/^[\s]*[-*+]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i]) && !lines[i].trimStart().startsWith('```') && !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|'))) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(<p key={elements.length} className="ai-md-para">{parseInline(paraLines.join(' '))}</p>);
    }
  }

  return <div className="ai-md">{elements}</div>;
}
