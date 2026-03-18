import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function BoxPlot({ widget, data }) {
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

    const m = { top: 14, right: 18, bottom: 70, left: 58 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Group by category
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.xField] ?? '(blank)');
      const val = +row[widget.yField];
      if (!isNaN(val)) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(val);
      }
    }

    const categories = [...groups.keys()];
    const stats = categories.map(cat => {
      const vals = groups.get(cat).sort((a, b) => a - b);
      const n = vals.length;
      const q1 = quantile(vals, 0.25);
      const median = quantile(vals, 0.5);
      const q3 = quantile(vals, 0.75);
      const iqr = q3 - q1;
      const whiskerLo = Math.max(d3.min(vals), q1 - 1.5 * iqr);
      const whiskerHi = Math.min(d3.max(vals), q3 + 1.5 * iqr);
      const outliers = vals.filter(v => v < whiskerLo || v > whiskerHi);
      const mean = d3.mean(vals);
      return { cat, vals, n, q1, median, q3, iqr, whiskerLo, whiskerHi, outliers, mean };
    });

    const colors = getColorScale(widget.colorScheme, categories);
    const opacity = widget.opacity ?? 1;

    const allVals = data.map(d => +d[widget.yField]).filter(v => !isNaN(v));
    const yMin = d3.min(allVals);
    const yMax = d3.max(allVals);
    const pad = (yMax - yMin) * 0.05 || 1;

    const xScale = d3.scaleBand().domain(categories).range([0, W]).padding(0.3);
    const yScale = d3.scaleLinear().domain([yMin - pad, yMax + pad]).range([H, 0]).nice();

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale)).call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).ticks(6).tickFormat(formatValue)).call(styledAxis);

    const bw = xScale.bandwidth();
    const boxW = Math.min(bw, 60);
    const offset = (bw - boxW) / 2;

    stats.forEach(s => {
      const cx = xScale(s.cat) + bw / 2;
      const x0 = xScale(s.cat) + offset;
      const color = colors(s.cat);

      // Whisker lines
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(s.whiskerHi)).attr('y2', yScale(s.q3))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(s.q1)).attr('y2', yScale(s.whiskerLo))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);

      // Whisker caps
      g.append('line').attr('x1', cx - boxW * 0.25).attr('x2', cx + boxW * 0.25)
        .attr('y1', yScale(s.whiskerHi)).attr('y2', yScale(s.whiskerHi))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);
      g.append('line').attr('x1', cx - boxW * 0.25).attr('x2', cx + boxW * 0.25)
        .attr('y1', yScale(s.whiskerLo)).attr('y2', yScale(s.whiskerLo))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);

      // Box
      const boxRect = g.append('rect')
        .attr('x', x0).attr('y', yScale(s.q3))
        .attr('width', boxW).attr('height', Math.max(0, yScale(s.q1) - yScale(s.q3)))
        .attr('fill', color).attr('fill-opacity', 0.25 * opacity)
        .attr('stroke', color).attr('stroke-width', 1.5).attr('rx', 3);

      // Median line
      g.append('line').attr('x1', x0).attr('x2', x0 + boxW)
        .attr('y1', yScale(s.median)).attr('y2', yScale(s.median))
        .attr('stroke', color).attr('stroke-width', 2.5).attr('opacity', opacity);

      // Mean diamond
      const my = yScale(s.mean);
      g.append('path')
        .attr('d', `M${cx},${my - 4} L${cx + 4},${my} L${cx},${my + 4} L${cx - 4},${my} Z`)
        .attr('fill', '#fff').attr('stroke', color).attr('stroke-width', 1.5);

      // Outliers
      s.outliers.forEach(v => {
        g.append('circle')
          .attr('cx', cx).attr('cy', yScale(v))
          .attr('r', 3).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2).attr('opacity', opacity * 0.7);
      });

      // Tooltip on box
      boxRect
        .on('mouseover', ev => showTooltip(ev, <BoxTip s={s} color={color} widget={widget} />))
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip);
    });

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', W / 2).attr('y', H + 56).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('transform', `translate(${-46},${H / 2}) rotate(-90)`).text(widget.yField);
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select Category (X) and Numeric (Y) fields" />}
    </div>
  );
}

function BoxTip({ s, color, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {s.cat}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">n</span><span className="tt-value">{s.n}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Median</span><span className="tt-value">{formatValue(s.median)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Mean</span><span className="tt-value">{formatValue(s.mean)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Q1</span><span className="tt-value">{formatValue(s.q1)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Q3</span><span className="tt-value">{formatValue(s.q3)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">IQR</span><span className="tt-value">{formatValue(s.iqr)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Outliers</span><span className="tt-value">{s.outliers.length}</span></div>
    </>
  );
}

function quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
