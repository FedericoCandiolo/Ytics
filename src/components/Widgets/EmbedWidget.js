/**
 * Embed Widget — renders an iframe with a static or dynamic URL.
 * Supports {{fieldName}} in the URL to resolve from dataset.
 */
import { useMemo } from 'react';
import { aggregate } from '../../utils/dataUtils';

function resolveUrl(template, data, defaultAgg) {
  if (!template || !data?.length) return template || '';
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const trimmed = expr.trim();
    let agg = defaultAgg || 'sum';
    let field = trimmed;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const maybeAgg = trimmed.slice(0, colonIdx).toLowerCase().trim();
      const aggList = ['sum','count','mean','min','max','median','std','p25','p75','p90','p95'];
      if (aggList.includes(maybeAgg)) {
        agg = maybeAgg;
        field = trimmed.slice(colonIdx + 1).trim();
      }
    }
    if (data.length > 0 && !(field in data[0])) return `{{${trimmed}}}`;
    const first = data[0][field];
    if (typeof first === 'string' && isNaN(first)) return first;
    const vals = data.map(r => +r[field] || 0);
    return String(aggregate(vals, agg));
  });
}

export default function EmbedWidget({ widget, data }) {
  const rawUrl = widget.embedUrl || '';

  const resolvedUrl = useMemo(
    () => resolveUrl(rawUrl, data, widget.aggregation),
    [rawUrl, data, widget.aggregation]
  );

  const containerStyle = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (!resolvedUrl.trim()) {
    return (
      <div style={{
        ...containerStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font)',
        fontSize: 13,
      }}>
        Click to edit — paste a URL to embed
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <iframe
        src={resolvedUrl}
        title={widget.title || 'Embed'}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius: 'inherit',
        }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        allowFullScreen
      />
    </div>
  );
}
