import { useEffect, useState } from 'react';
import * as d3 from 'd3';
import { linearRegression, polynomialRegression, polyEval, logarithmicRegression, exponentialRegression } from '../../utils/dataUtils';

/** ResizeObserver hook — returns {w, h} of container element. */
export function useChartDims(ref) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return dims;
}

/** Apply consistent axis styling. */
export function styledAxis(g) {
  g.select('.domain').attr('stroke', 'var(--chart-grid-color)');
  g.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)');
  g.selectAll('text')
    .attr('fill', 'var(--chart-axis-color)')
    .attr('font-size', 'var(--chart-label-size)')
    .attr('font-family', 'var(--font)');
}

/** Centered "no data" placeholder overlay. */
export function Placeholder({ text }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-light)', fontSize: 12, gap: 6,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.4}>
        <rect x={3} y={3} width={18} height={18} rx={3} />
        <path d="M8 17V13M12 17V9M16 17V12" strokeLinecap="round" />
      </svg>
      {text}
    </div>
  );
}

/** Format compact numbers for axis ticks. */
export function fmtTick(v) {
  if (typeof v !== 'number') return v;
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

/** Build a linear or log scale for a value axis. */
export function makeValueScale(useLog, domain, range) {
  if (useLog) {
    const [lo, hi] = domain;
    return d3.scaleLog()
      .domain([Math.max(1, lo), Math.max(1, hi)])
      .range(range)
      .clamp(true);
  }
  return d3.scaleLinear().domain(domain).range(range).nice();
}

/** Clamp value for log scale (avoids log(0)). */
export function safeLog(useLog, v) {
  return useLog ? Math.max(1, v) : v;
}

/**
 * Draw a trend line into a d3 group.
 * @param {d3.Selection} g - SVG group to append to
 * @param {Array<{x:number, y:number}>} points - data points with numeric x,y
 * @param {Function} xToPixel - maps regression x -> pixel x
 * @param {d3.Scale} yScale - y scale
 * @param {[number,number]} xRange - [xMin, xMax] of the data
 * @param {string} type - 'linear'|'polynomial'|'logarithmic'|'exponential'
 * @param {number} degree - polynomial degree (only for type=polynomial)
 * @param {string} strokeColor
 * @param {string} clipId - clip path id for bounding within chart area
 */
export function drawTrendLine(g, points, xToPixel, yScale, xRange, type, degree, strokeColor, clipId) {
  if (points.length < 2) return;
  const [x0, x1] = xRange;
  const nSamples = 80;
  const step = (x1 - x0) / nSamples;

  let evalFn, r2;

  if (type === 'logarithmic') {
    const result = logarithmicRegression(points);
    if (!result) return;
    r2 = result.r2;
    evalFn = x => x > 0 ? result.a + result.b * Math.log(x) : null;
  } else if (type === 'exponential') {
    const result = exponentialRegression(points);
    if (!result) return;
    r2 = result.r2;
    evalFn = x => result.a * Math.exp(result.b * x);
  } else if (type === 'polynomial') {
    const deg = Math.max(2, Math.min(degree || 2, points.length - 1));
    const result = polynomialRegression(points, deg);
    if (!result) return;
    r2 = result.r2;
    evalFn = x => polyEval(result.coeffs, x);
  } else {
    // linear
    const result = linearRegression(points);
    if (!result) return;
    r2 = result.r2;
    evalFn = x => result.slope * x + result.intercept;
  }

  // Sample the curve
  const curvePoints = [];
  for (let i = 0; i <= nSamples; i++) {
    const x = x0 + i * step;
    const y = evalFn(x);
    if (y == null || !isFinite(y)) continue;
    curvePoints.push({ px: xToPixel(x), py: yScale(y) });
  }
  if (curvePoints.length < 2) return;

  const clipAttr = clipId ? `url(#${clipId})` : null;

  // Use curveNatural for curved types, curveLinear for linear
  const curveInterp = type === 'linear' ? d3.curveLinear : d3.curveNatural;
  const lineGen = d3.line()
    .x(d => d.px)
    .y(d => d.py)
    .curve(curveInterp);

  g.append('path')
    .attr('d', lineGen(curvePoints))
    .attr('fill', 'none')
    .attr('stroke', strokeColor)
    .attr('stroke-width', 3)
    .attr('stroke-dasharray', '8,5')
    .attr('opacity', 0.85)
    .attr('clip-path', clipAttr);

  // R² label near 75% of the curve
  const labelPt = curvePoints[Math.floor(curvePoints.length * 0.75)] || curvePoints[curvePoints.length - 1];
  g.append('text')
    .attr('x', labelPt.px + 4).attr('y', labelPt.py - 8)
    .attr('font-size', 11)
    .attr('font-weight', 600)
    .attr('font-family', 'var(--font)')
    .attr('fill', strokeColor)
    .attr('opacity', 0.9)
    .attr('clip-path', clipAttr)
    .text(`R\u00B2=${r2.toFixed(3)}`);
}

/**
 * Draw multiple reference lines for bar/grouped charts.
 * numScale: maps numeric value \u2192 pixel (y for vertical bars, x for horizontal)
 * catScale: maps category string \u2192 pixel (x for vertical bars, y for horizontal) \u2014 may be null
 */
function refLabelContrast(color) {
  if (!color || !color.startsWith('#') || color.length < 7) return '#ffffff';
  try {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? '#1e293b' : '#ffffff';
  } catch { return '#ffffff'; }
}

function drawRefLabel(g, lx, ly, text, color, anchor = 'start') {
  const bgColor = color.startsWith('var(') ? '#64748b' : color;
  const tw = Math.max(text.length * 5.5 + 8, 20);
  const th = 14;
  const bx = anchor === 'end' ? lx - tw : lx;
  g.append('rect').attr('x', bx).attr('y', ly - th + 2)
    .attr('width', tw).attr('height', th)
    .attr('rx', 2).attr('fill', bgColor).attr('opacity', 0.9);
  g.append('text').attr('x', bx + tw / 2).attr('y', ly - 1)
    .attr('font-size', 10).attr('fill', refLabelContrast(bgColor))
    .attr('font-family', 'var(--font)').attr('text-anchor', 'middle')
    .text(text);
}

export function drawReferenceLines(g, widget, numScale, catScale, W, H, isH) {
  const lines = widget.referenceLines?.length
    ? widget.referenceLines
    : (widget.referenceLine?.value != null ? [widget.referenceLine] : []);
  if (!lines.length) return;

  for (const ref of lines) {
    if (!ref) continue;
    const color = ref.color || 'var(--text-muted)';
    const strokeDash = ref.dashed !== false ? '6,4' : null;
    const axis = ref.axis || 'y';

    if (axis === 'y' && ref.value != null) {
      const pos = numScale(+ref.value);
      if (!isFinite(pos)) continue;
      if (isH) {
        g.append('line').attr('x1', pos).attr('x2', pos).attr('y1', 0).attr('y2', H)
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
        if (ref.label) drawRefLabel(g, pos + 4, 10, ref.label, color, 'start');
      } else {
        g.append('line').attr('x1', 0).attr('x2', W).attr('y1', pos).attr('y2', pos)
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
        if (ref.label) drawRefLabel(g, W - 4, pos - 5, ref.label, color, 'end');
      }
    } else if (axis === 'x' && ref.dimValue != null && catScale) {
      const pos = catScale(String(ref.dimValue));
      if (pos == null || !isFinite(pos)) continue;
      const bw = catScale.bandwidth?.() || 0;
      const cx = pos + bw / 2;
      if (isH) {
        g.append('line').attr('x1', 0).attr('x2', W).attr('y1', cx).attr('y2', cx)
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
        if (ref.label) drawRefLabel(g, W - 4, cx - 5, ref.label, color, 'end');
      } else {
        g.append('line').attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', H)
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
        if (ref.label) drawRefLabel(g, cx + 4, 10, ref.label, color, 'start');
      }
    }
  }
}

/**
 * Draw reference lines for XY charts (line, scatter).
 * xMapper: function(val) \u2192 pixel x (handles date/numeric/categorical)
 */
export function drawReferenceLinesXY(g, widget, yScale, xMapper, W, H) {
  const lines = widget.referenceLines?.length
    ? widget.referenceLines
    : (widget.referenceLine?.value != null ? [{ ...widget.referenceLine, axis: 'y' }] : []);
  if (!lines.length) return;

  for (const ref of lines) {
    if (!ref) continue;
    const color = ref.color || 'var(--text-muted)';
    const strokeDash = ref.dashed !== false ? '6,4' : null;
    const axis = ref.axis || 'y';

    if (axis === 'y' && ref.value != null) {
      const pos = yScale(+ref.value);
      if (!isFinite(pos) || pos < 0 || pos > H) continue;
      g.append('line').attr('x1', 0).attr('x2', W).attr('y1', pos).attr('y2', pos)
        .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
      if (ref.label) drawRefLabel(g, W - 4, pos - 5, ref.label, color, 'end');
    } else if (axis === 'x' && ref.dimValue != null && xMapper) {
      const pos = xMapper(ref.dimValue);
      if (pos == null || !isFinite(pos) || pos < 0 || pos > W) continue;
      g.append('line').attr('x1', pos).attr('x2', pos).attr('y1', 0).attr('y2', H)
        .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', strokeDash).attr('opacity', 0.85);
      if (ref.label) drawRefLabel(g, pos + 4, 10, ref.label, color, 'start');
    }
  }
}
