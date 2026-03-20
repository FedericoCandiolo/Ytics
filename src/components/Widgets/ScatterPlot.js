import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue, linearRegression } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getPrimaryColor, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

/* ── Quadratic (degree-2 polynomial) least-squares fit ──────────────────────
   Solves the normal equations for y = a*x² + b*x + c via a 3×3 system.
   Returns { coeffs: [a, b, c], r2 } */
function polynomialRegression2(points) {
  const n = points.length;
  if (n < 3) return null;

  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (const { x, y } of points) {
    const x2 = x * x;
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += y; t1 += x * y; t2 += x2 * y;
  }

  // Solve 3×3 via Cramer's rule:
  // | s4 s3 s2 | |a|   |t2|
  // | s3 s2 s1 | |b| = |t1|
  // | s2 s1 s0 | |c|   |t0|
  const M = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, s0],
  ];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const D = det3(M);
  if (Math.abs(D) < 1e-12) return null;

  const replaceCol = (m, col, v) => m.map((row, i) => row.map((c, j) => (j === col ? v[i] : c)));
  const rhs = [t2, t1, t0];
  const a = det3(replaceCol(M, 0, rhs)) / D;
  const b = det3(replaceCol(M, 1, rhs)) / D;
  const c = det3(replaceCol(M, 2, rhs)) / D;

  const meanY = t0 / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (a * x * x + b * x + c)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { coeffs: [a, b, c], r2 };
}

/* ── Draw a single regression line/curve into the provided d3 group ──────── */
function drawRegression(g, pts, xScale, yScale, W, H, regressionType, strokeColor, showLabel) {
  if (pts.length < 2) return;
  const points = pts.map(d => ({ x: d.x, y: d.y }));
  const [x0, x1] = xScale.domain();

  if (regressionType === 'polynomial') {
    const result = polynomialRegression2(points);
    if (!result) return;
    const { coeffs: [a, b, c], r2 } = result;

    // Generate curve as a path with ~60 sample points
    const step = (x1 - x0) / 60;
    const curvePoints = [];
    for (let x = x0; x <= x1 + step * 0.5; x += step) {
      const y = a * x * x + b * x + c;
      curvePoints.push([xScale(x), yScale(y)]);
    }
    const line = d3.line().curve(d3.curveBasis);
    g.append('path')
      .attr('d', line(curvePoints))
      .attr('fill', 'none')
      .attr('stroke', strokeColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('opacity', 0.55)
      .attr('clip-path', 'url(#scatter-clip)');

    if (showLabel) {
      // Place R² label at the midpoint of the curve
      const midX = (x0 + x1) / 2;
      const midY = a * midX * midX + b * midX + c;
      g.append('text')
        .attr('x', xScale(midX) + 4)
        .attr('y', yScale(midY) - 6)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font)')
        .attr('fill', strokeColor)
        .attr('opacity', 0.8)
        .text(`R²=${r2.toFixed(3)}`);
    }
  } else {
    // Linear (default)
    const { slope, intercept, r2 } = linearRegression(points);
    const y0 = slope * x0 + intercept;
    const y1v = slope * x1 + intercept;

    g.append('line')
      .attr('x1', xScale(x0)).attr('y1', yScale(y0))
      .attr('x2', xScale(x1)).attr('y2', yScale(y1v))
      .attr('stroke', strokeColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('opacity', 0.55)
      .attr('clip-path', 'url(#scatter-clip)');

    if (showLabel) {
      // Place R² near the right end of the line
      const labelX = x0 + (x1 - x0) * 0.75;
      const labelY = slope * labelX + intercept;
      g.append('text')
        .attr('x', xScale(labelX) + 4)
        .attr('y', yScale(labelY) - 6)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font)')
        .attr('fill', strokeColor)
        .attr('opacity', 0.8)
        .text(`R²=${r2.toFixed(3)}`);
    }
  }
}

export default function ScatterPlot({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 16, right: widget.showLegend && widget.colorField ? 110 : 20, bottom: 52, left: 62 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const pts = data.map(d => ({
      x: +d[widget.xField], y: +d[widget.yField],
      color: widget.colorField ? String(d[widget.colorField] ?? '') : null,
      size: widget.sizeField ? +d[widget.sizeField] || 0 : null,
      label: widget.labelField ? String(d[widget.labelField] ?? '') : null,
      raw: d,
    })).filter(d => !isNaN(d.x) && !isNaN(d.y));

    if (!pts.length) return;

    const opacity = widget.opacity ?? 0.8;
    const categories = widget.colorField ? [...new Set(pts.map(d => d.color))] : [];
    const colors = widget.colorField ? getColorScaleWithOverrides(widget.colorScheme, categories, widget.dimensionColors) : null;
    const primaryColor = getPrimaryColor(widget.colorScheme);

    // Gradient mode: color by a numeric field
    let gradientFn;
    if (widget.colorMode === 'gradient') {
      const gradField = widget.colorGradientField || widget.yField;
      const gradVals = pts.map(d => gradField === widget.yField ? d.y : (+d.raw[gradField] || 0));
      const ext = d3.extent(gradVals);
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1]);
      gradientFn = (d) => {
        const val = gradField === widget.yField ? d.y : (+d.raw[gradField] || 0);
        return seq(val);
      };
    }

    const sMin = widget.dotSizeMin ?? 4, sMax = widget.dotSizeMax ?? 20;
    const sizeExt = widget.sizeField ? d3.extent(pts, d => d.size) : [1, 1];
    const sizeScale = d3.scaleSqrt().domain(sizeExt).range([sMin, sMax]).clamp(true);

    const xScale = d3.scaleLinear().domain(d3.extent(pts, d => d.x)).range([0, W]).nice();
    const yScale = d3.scaleLinear().domain(d3.extent(pts, d => d.y)).range([H, 0]).nice();

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Clip path so regression lines don't overflow the chart area
    svg.append('defs').append('clipPath').attr('id', 'scatter-clip')
      .append('rect').attr('width', W).attr('height', H);
    g.attr('clip-path', null); // don't clip the whole group — only regression lines

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
      g.append('g').call(d3.axisBottom(xScale).tickSize(-H).tickFormat(''))
        .attr('transform', `translate(0,${H})`)
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

    // ── Regression lines ─────────────────────────────────────────────────
    const regressionType = widget.regressionType || 'linear';
    if (widget.showRegression) {
      if (widget.colorField && categories.length > 0) {
        // Draw a separate regression line per color group
        for (const cat of categories) {
          const groupPts = pts.filter(d => d.color === cat);
          if (groupPts.length >= 2) {
            const color = colors(cat);
            drawRegression(g, groupPts, xScale, yScale, W, H, regressionType, color, true);
          }
        }
      } else {
        // Single regression for all points
        const color = gradientFn ? '#888' : 'var(--chart-axis-color)';
        drawRegression(g, pts, xScale, yScale, W, H, regressionType, color, true);
      }
    }

    const dots = g.selectAll('.dot').data(pts).join('circle').attr('class', 'dot')
      .attr('cx', d => xScale(d.x)).attr('cy', d => yScale(d.y))
      .attr('r', 0)
      .attr('fill', d => gradientFn ? gradientFn(d) : widget.colorField ? colors(d.color) : primaryColor)
      .attr('opacity', opacity).attr('stroke', 'rgba(255,255,255,.6)').attr('stroke-width', 1);

    dots.transition().duration(400).delay((_, i) => i * 0.5).ease(d3.easeCubicOut)
      .attr('r', d => widget.sizeField ? sizeScale(d.size) : sMin + 2);

    dots
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).raise().transition().duration(80)
          .attr('r', (widget.sizeField ? sizeScale(d.size) : sMin + 2) * 1.5)
          .attr('opacity', 1).attr('stroke-width', 2.5);
        showTooltip(ev, <ScatterTip d={d} widget={widget} color={gradientFn ? gradientFn(d) : widget.colorField ? colors(d.color) : primaryColor} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(120)
          .attr('r', widget.sizeField ? sizeScale(d.size) : sMin + 2)
          .attr('opacity', opacity).attr('stroke-width', 1);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.colorField || widget.xField, value: d[widget.colorField || widget.xField] }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 44).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-46,${H / 2}) rotate(-90)`).text(widget.yField);

    // Legend
    if (widget.showLegend && widget.colorField && categories.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
      categories.slice(0, 10).forEach((cat, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('circle').attr('cx', 5).attr('cy', 6).attr('r', 5).attr('fill', colors(cat)).attr('opacity', opacity);
        row.append('text').attr('x', 14).attr('y', 10).attr('font-size', 10.5).attr('font-family', 'var(--font)')
          .attr('fill', 'var(--text-muted)').text(cat.length > 13 ? cat.slice(0, 13) + '…' : cat);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select numeric X and Y fields" />}
    </div>
  );
}

function ScatterTip({ d, widget, color }) {
  const title = d.label || d.color || 'Data point';
  const showColorRow = d.label && d.color && d.label !== d.color;
  return (
    <>
      <div className="chart-tooltip-title">
        {(d.label || widget.colorField)
          ? <><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />{title}</>
          : title
        }
      </div>
      {showColorRow && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.colorField}</span>
          <span className="tt-value">{d.color}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.xField}</span>
        <span className="tt-value">{formatValue(d.x)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.yField}</span>
        <span className="tt-value">{formatValue(d.y)}</span>
      </div>
      {widget.sizeField && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField}</span>
          <span className="tt-value">{formatValue(d.size)}</span>
        </div>
      )}
    </>
  );
}
