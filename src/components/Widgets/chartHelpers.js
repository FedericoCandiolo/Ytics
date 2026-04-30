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
