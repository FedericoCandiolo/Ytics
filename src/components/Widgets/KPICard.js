import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getSequentialScale, resolveGradient, getPrimaryColor } from '../../utils/colorUtils';
import { useChartDims, Placeholder } from './chartHelpers';

// ── Value formatting with KPI-specific modes ─────────────────────────────────

function formatKPI(v, format) {
  if (typeof v !== 'number' || isNaN(v)) return '—';
  switch (format) {
    case 'currency':
      if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
      if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
      if (Math.abs(v) >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
      return '$' + (v % 1 === 0 ? String(v) : v.toFixed(2));
    case 'percent':
      return (v % 1 === 0 ? String(v) : v.toFixed(2)) + '%';
    default:
      return formatValue(v);
  }
}

// ── Compute aggregated value from data rows ──────────────────────────────────

function computeValue(data, field, aggregation) {
  if (!data?.length || !field) return null;
  const vals = data.map(r => +r[field] || 0);
  return aggregate(vals, aggregation || 'sum');
}

// ── Style 1: Card ────────────────────────────────────────────────────────────

function renderCard(svg, value, target, widget, w, h, primaryColor) {
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);

  const format = widget.kpiFormat || 'number';
  const opacity = widget.opacity ?? 1;
  const cx = w / 2;
  const cy = h / 2;

  const g = svg.append('g').attr('opacity', opacity);

  // Main value
  const valueFontSize = Math.max(16, Math.min(56, Math.min(w, h) * 0.3));
  g.append('text')
    .attr('x', cx).attr('y', cy - (target != null ? 8 : 4))
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', valueFontSize)
    .attr('font-weight', 700)
    .attr('fill', primaryColor)
    .attr('font-family', 'var(--font)')
    .text(formatKPI(value, format));

  // Subtitle (field name)
  const subtitleSize = Math.max(10, Math.min(14, valueFontSize * 0.28));
  g.append('text')
    .attr('x', cx).attr('y', cy + valueFontSize * 0.45 + (target != null ? -4 : 4))
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .attr('font-size', subtitleSize)
    .attr('fill', 'var(--text-muted)')
    .attr('font-family', 'var(--font)')
    .text(widget.valueField);

  // Delta row (if target exists)
  if (target != null) {
    const delta = value - target;
    const isPositive = delta >= 0;
    const deltaColor = isPositive ? '#16a34a' : '#dc2626';
    const arrow = isPositive ? '\u25B2' : '\u25BC';
    const deltaY = cy + valueFontSize * 0.45 + subtitleSize + (target != null ? 4 : 12);
    const deltaFontSize = Math.max(10, Math.min(16, valueFontSize * 0.32));

    g.append('text')
      .attr('x', cx).attr('y', deltaY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'hanging')
      .attr('font-size', deltaFontSize)
      .attr('font-weight', 600)
      .attr('fill', deltaColor)
      .attr('font-family', 'var(--font)')
      .text(`${arrow} ${formatKPI(Math.abs(delta), format)} vs target`);
  }
}

// ── Style 2: Gauge ───────────────────────────────────────────────────────────

function renderGauge(svg, value, target, widget, w, h, gradientScale) {
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);

  const format = widget.kpiFormat || 'number';
  const opacity = widget.opacity ?? 1;
  const gaugeMin = widget.kpiGaugeMin ?? 0;
  const gaugeMax = widget.kpiGaugeMax ?? 100;
  const range = gaugeMax - gaugeMin;
  const segments = widget.kpiGaugeSegments; // [{from, to, color}, ...]
  const useSegments = Array.isArray(segments) && segments.length > 0;

  // Layout: semi-circle occupies top portion, value below
  const margin = 16;
  const maxRadius = Math.min((w - margin * 2) / 2, (h - margin * 2) * 0.65);
  const radius = Math.max(24, maxRadius);
  const thickness = Math.max(8, radius * 0.18);
  const cx = w / 2;
  const cy = margin + radius + 4;

  const g = svg.append('g').attr('opacity', opacity);
  const defs = svg.append('defs');

  // Background arc (light gray track)
  const bgArc = d3.arc()
    .innerRadius(radius - thickness)
    .outerRadius(radius)
    .startAngle(-Math.PI / 2)
    .endAngle(Math.PI / 2)
    .cornerRadius(thickness / 2);

  g.append('path')
    .attr('d', bgArc())
    .attr('transform', `translate(${cx},${cy})`)
    .attr('fill', 'var(--chart-grid-color, #e5e7eb)');

  const clampedValue = Math.max(gaugeMin, Math.min(gaugeMax, value));
  const fraction = range > 0 ? (clampedValue - gaugeMin) / range : 0;

  if (useSegments) {
    // Draw segments as colored zones across the full gauge (speedometer style)
    // Sort segments by `from` so they render in order
    const sorted = [...segments].sort((a, b) => (a.from ?? gaugeMin) - (b.from ?? gaugeMin));
    const validSegs = sorted.filter(seg => {
      const sf = Math.max(gaugeMin, seg.from ?? gaugeMin);
      const st = Math.min(gaugeMax, seg.to ?? gaugeMax);
      return st > sf;
    });
    // Clip segments to the rounded background track shape
    const segClipId = 'seg-track-' + Math.random().toString(36).slice(2, 8);
    defs.append('clipPath').attr('id', segClipId)
      .append('path').attr('d', bgArc())
      .attr('transform', `translate(${cx},${cy})`);
    const segG = g.append('g').attr('clip-path', `url(#${segClipId})`);
    for (const seg of validSegs) {
      const segFrom = Math.max(gaugeMin, seg.from ?? gaugeMin);
      const segTo = Math.min(gaugeMax, seg.to ?? gaugeMax);
      const fracFrom = range > 0 ? (segFrom - gaugeMin) / range : 0;
      const fracTo = range > 0 ? (segTo - gaugeMin) / range : 0;
      const arcGen = d3.arc()
        .innerRadius(radius - thickness - 1)
        .outerRadius(radius + 1)
        .startAngle(-Math.PI / 2 + fracFrom * Math.PI)
        .endAngle(-Math.PI / 2 + fracTo * Math.PI);
      segG.append('path')
        .attr('d', arcGen())
        .attr('transform', `translate(${cx},${cy})`)
        .attr('fill', seg.color || '#94a3b8');
    }
  } else {
    // Gradient fill (default)
    const gradId = 'gauge-grad-' + Math.random().toString(36).slice(2, 8);
    const linearGrad = defs.append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');
    const nStops = 10;
    for (let i = 0; i <= nStops; i++) {
      const t = i / nStops;
      linearGrad.append('stop')
        .attr('offset', `${t * 100}%`)
        .attr('stop-color', gradientScale(gaugeMin + t * range));
    }
    const endAngle = -Math.PI / 2 + fraction * Math.PI;
    const filledArc = d3.arc()
      .innerRadius(radius - thickness)
      .outerRadius(radius)
      .startAngle(-Math.PI / 2)
      .endAngle(endAngle)
      .cornerRadius(thickness / 2);
    g.append('path')
      .attr('d', filledArc())
      .attr('transform', `translate(${cx},${cy})`)
      .attr('fill', `url(#${gradId})`);
  }

  // Needle indicator
  // d3 arc: -PI/2 = 9 o'clock, PI/2 = 3 o'clock. Convert to trig: subtract PI/2.
  const needleAngle = -Math.PI + fraction * Math.PI;
  const needleLen = radius - thickness - 6;
  const nx = cx + Math.cos(needleAngle) * needleLen;
  const ny = cy + Math.sin(needleAngle) * needleLen;

  g.append('line')
    .attr('x1', cx).attr('y1', cy)
    .attr('x2', nx).attr('y2', ny)
    .attr('stroke', 'var(--text)')
    .attr('stroke-width', 2)
    .attr('stroke-linecap', 'round');

  g.append('circle')
    .attr('cx', cx).attr('cy', cy).attr('r', 4)
    .attr('fill', 'var(--text)');

  // Target line
  if (target != null && range > 0) {
    const tFraction = Math.max(0, Math.min(1, (target - gaugeMin) / range));
    const tAngle = -Math.PI + tFraction * Math.PI;
    const tInner = radius - thickness - 3;
    const tOuter = radius + 4;
    g.append('line')
      .attr('x1', cx + Math.cos(tAngle) * tInner)
      .attr('y1', cy + Math.sin(tAngle) * tInner)
      .attr('x2', cx + Math.cos(tAngle) * tOuter)
      .attr('y2', cy + Math.sin(tAngle) * tOuter)
      .attr('stroke', 'var(--text)')
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('opacity', 0.7);
  }

  // Min/Max labels
  const labelSize = Math.max(9, Math.min(11, radius * 0.1));
  g.append('text')
    .attr('x', cx - radius).attr('y', cy + labelSize + 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', labelSize)
    .attr('fill', 'var(--text-muted)')
    .attr('font-family', 'var(--font)')
    .text(formatKPI(gaugeMin, format));

  g.append('text')
    .attr('x', cx + radius).attr('y', cy + labelSize + 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', labelSize)
    .attr('fill', 'var(--text-muted)')
    .attr('font-family', 'var(--font)')
    .text(formatKPI(gaugeMax, format));

  // Value displayed below the arc
  const valueFontSize = Math.max(14, Math.min(36, radius * 0.32));
  g.append('text')
    .attr('x', cx).attr('y', cy + valueFontSize * 0.6 + 8)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .attr('font-size', valueFontSize)
    .attr('font-weight', 700)
    .attr('fill', 'var(--text)')
    .attr('font-family', 'var(--font)')
    .text(formatKPI(value, format));

  // Field name subtitle
  const subSize = Math.max(9, Math.min(12, valueFontSize * 0.36));
  g.append('text')
    .attr('x', cx).attr('y', cy + valueFontSize * 0.6 + 8 + valueFontSize + 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .attr('font-size', subSize)
    .attr('fill', 'var(--text-muted)')
    .attr('font-family', 'var(--font)')
    .text(widget.valueField);
}

// ── Style 3: Satellite (circular progress) ───────────────────────────────────

function renderSatellite(svg, value, target, widget, w, h, gradientScale) {
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);

  const format = widget.kpiFormat || 'number';
  const opacity = widget.opacity ?? 1;

  const margin = 12;
  const maxRadius = Math.min(w - margin * 2, h - margin * 2) / 2;
  const radius = Math.max(20, maxRadius);
  const thickness = Math.max(6, radius * 0.16);
  const cx = w / 2;
  const cy = h / 2;

  const g = svg.append('g').attr('opacity', opacity);

  // Background track ring
  g.append('circle')
    .attr('cx', cx).attr('cy', cy)
    .attr('r', radius - thickness / 2)
    .attr('fill', 'none')
    .attr('stroke', 'var(--chart-grid-color, #e5e7eb)')
    .attr('stroke-width', thickness);

  // Determine how much of the circle to fill
  // 100% = full circle (2*PI). Can wrap multiple times for >100%.
  const pct = value; // raw value treated as percentage
  const sign = pct >= 0 ? 1 : -1;
  const absPct = Math.abs(pct);

  // For values > 100%, draw multiple rings
  const fullTurns = Math.floor(absPct / 100);
  const remainder = absPct % 100;

  // Helper: draw gradient arc segments (fine slices for smooth look)
  const defs = svg.append('defs');
  const N_SEGS = 180;
  // tMax: gradient maps 0→tMax (1 for full ring, fraction for partial)
  function drawGradientSlices(parent, ringRadius, startAngle, endAngle, rounded, tMax) {
    const totalAngle = endAngle - startAngle;
    const nSegs = Math.max(12, Math.round(Math.abs(totalAngle / (2 * Math.PI)) * N_SEGS));
    const step = totalAngle / nSegs;

    let arcG;
    if (rounded) {
      const clipId = 'sat-clip-' + Math.random().toString(36).slice(2, 8);
      const clipArc = d3.arc()
        .innerRadius(ringRadius - thickness)
        .outerRadius(ringRadius)
        .startAngle(startAngle)
        .endAngle(endAngle)
        .cornerRadius(thickness / 2);
      defs.append('clipPath').attr('id', clipId)
        .append('path').attr('d', clipArc())
        .attr('transform', `translate(${cx},${cy})`);
      arcG = parent.append('g').attr('clip-path', `url(#${clipId})`);
    } else {
      arcG = parent.append('g');
    }

    for (let i = 0; i < nSegs; i++) {
      const a0 = startAngle + i * step;
      const a1 = startAngle + (i + 1) * step;
      const t = nSegs > 1 ? (i / (nSegs - 1)) * tMax : 0;
      const arcSeg = d3.arc()
        .innerRadius(ringRadius - thickness - (rounded ? 1 : 0))
        .outerRadius(ringRadius + (rounded ? 1 : 0))
        .startAngle(a0)
        .endAngle(a1 + 0.005);
      arcG.append('path')
        .attr('d', arcSeg())
        .attr('transform', `translate(${cx},${cy})`)
        .attr('fill', gradientScale(t));
    }
  }

  // Full rings: leave a small gap so start/end don't collide, with rounded caps
  const gapAngle = thickness / radius * 0.15;
  for (let ring = 0; ring < fullTurns && ring < 3; ring++) {
    const rOffset = ring * (thickness + 3);
    const ringRadius = radius - rOffset;
    if (ringRadius < 12) break;
    const endAngle = sign * (2 * Math.PI - gapAngle);
    drawGradientSlices(g, ringRadius, 0, endAngle, true, 1);
  }

  // Partial arc: gradient covers only the filled fraction (tMax = remainder/100)
  if (remainder > 0) {
    const rOffset = Math.min(fullTurns, 3) * (thickness + 3);
    const ringRadius = radius - rOffset;
    if (ringRadius >= 12) {
      const partialAngle = sign * (remainder / 100) * 2 * Math.PI;
      drawGradientSlices(g, ringRadius, 0, partialAngle, true, remainder / 100);
    }
  }

  // If value is zero, just show the track (already drawn)

  // Center value text
  const valueFontSize = Math.max(14, Math.min(40, radius * 0.36));
  g.append('text')
    .attr('x', cx).attr('y', cy - 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', valueFontSize)
    .attr('font-weight', 700)
    .attr('fill', 'var(--text)')
    .attr('font-family', 'var(--font)')
    .text(formatKPI(value, format));

  // Field name below value
  const subSize = Math.max(9, Math.min(12, valueFontSize * 0.34));
  g.append('text')
    .attr('x', cx).attr('y', cy + valueFontSize * 0.5 + 6)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'hanging')
    .attr('font-size', subSize)
    .attr('fill', 'var(--text-muted)')
    .attr('font-family', 'var(--font)')
    .text(widget.valueField);
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function KPICard({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    const value = computeValue(data, widget.valueField, widget.aggregation);
    const target = widget.yField ? computeValue(data, widget.yField, widget.aggregation) : null;

    if (value == null) {
      svg.selectAll('*').remove();
      return;
    }

    const style = widget.kpiStyle || 'card';
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const primaryColor = getPrimaryColor(widget.colorScheme);

    if (style === 'card') {
      renderCard(svg, value, target, widget, w, h, primaryColor);
    } else if (style === 'gauge') {
      const gaugeMin = widget.kpiGaugeMin ?? 0;
      const gaugeMax = widget.kpiGaugeMax ?? 100;
      const gradientScale = getSequentialScale(gradKey, gaugeMin, gaugeMax, widget.invertGradient);
      renderGauge(svg, value, target, widget, w, h, gradientScale);
    } else if (style === 'satellite') {
      // For satellite, gradient maps 0..1 for arc coloring
      const gradientScale = getSequentialScale(gradKey, 0, 1, widget.invertGradient);
      renderSatellite(svg, value, target, widget, w, h, gradientScale);
    }
  }, [data, widget, dims]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {!widget.valueField && <Placeholder text="Select a Value field" />}
    </div>
  );
}
