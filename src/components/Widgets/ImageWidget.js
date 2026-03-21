/**
 * Image Widget — renders a static image or one with a dynamic URL from data.
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
    // For URLs, non-numeric fields use the first row's value
    const first = data[0][field];
    if (typeof first === 'string' && isNaN(first)) return first;
    const vals = data.map(r => +r[field] || 0);
    return String(aggregate(vals, agg));
  });
}

export default function ImageWidget({ widget, data }) {
  const rawUrl = widget.imageUrl || '';
  const fit = widget.imageFit || 'contain';

  const resolvedUrl = useMemo(
    () => resolveUrl(rawUrl, data, widget.aggregation),
    [rawUrl, data, widget.aggregation]
  );

  const containerStyle = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  if (!resolvedUrl.trim()) {
    return (
      <div style={{ ...containerStyle, color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: 13 }}>
        Click to edit — paste an image URL
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <img
        src={resolvedUrl}
        alt={widget.title || 'Image'}
        style={{
          width: '100%',
          height: '100%',
          objectFit: fit,
          borderRadius: 'inherit',
        }}
        onError={e => {
          e.target.style.display = 'none';
          e.target.parentNode.innerHTML = '<div style="color:var(--text-muted);font-family:var(--font);font-size:13px;text-align:center">Image failed to load</div>';
        }}
      />
    </div>
  );
}
