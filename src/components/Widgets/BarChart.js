import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function BarChart({ widget, data }) {
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

    const isH = widget.orientation === 'horizontal';
    const m = { top: 14, right: 18, bottom: isH ? 46 : 70, left: isH ? 130 : 58 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Aggregate
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.xField] ?? '(blank)');
      const val = +row[widget.yField] || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(val);
    }
    let pts = Array.from(groups, ([key, vals]) => ({
      key,
      value: aggregate(vals, widget.aggregation || 'sum'),
      count: vals.length,
    }));

    if (widget.sortBy === 'label') {
      pts.sort((a, b) => widget.sortOrder === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
    } else {
      pts.sort((a, b) => widget.sortOrder === 'desc' ? b.value - a.value : a.value - b.value);
    }

    const colors = getColorScale(widget.colorScheme, pts.map(d => d.key));
    const opacity = widget.opacity ?? 1;
    const maxVal = d3.max(pts, d => d.value) * 1.05 || 1;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (isH) {
      const yScale = d3.scaleBand().domain(pts.map(d => d.key)).range([0, H]).padding(0.22);
      const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W]).nice();

      if (widget.showGrid) drawGrid(g, d3.axisBottom(xScale).tickSize(-H).tickFormat(''), 'x', H);

      g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(formatValue)).call(styledAxis);
      g.append('g').call(d3.axisLeft(yScale).tickFormat(d => truncate(d, 18))).call(styledAxis).call(a => a.selectAll('.tick line').remove());

      const bars = g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
        .attr('y', d => yScale(d.key)).attr('x', 0)
        .attr('height', yScale.bandwidth()).attr('width', 0)
        .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 4);

      bars.transition().duration(500).ease(d3.easeCubicOut).attr('width', d => xScale(d.value));

      bars
        .on('mouseover', (ev, d) => {
          d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1).attr('x', -3).attr('height', yScale.bandwidth() + 2).attr('y', yScale(d.key) - 1);
          showTooltip(ev, <BarTip d={d} widget={widget} color={colors(d.key)} total={pts.reduce((s, p) => s + p.value, 0)} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).transition().duration(100).attr('opacity', opacity).attr('x', 0).attr('y', d => yScale(d.key)).attr('height', yScale.bandwidth());
          hideTooltip();
        });

      axisLabel(g, isH ? widget.yField : widget.xField, W / 2, H + 38, false);

    } else {
      const xScale = d3.scaleBand().domain(pts.map(d => d.key)).range([0, W]).padding(0.22);
      const yScale = d3.scaleLinear().domain([0, maxVal]).range([H, 0]).nice();

      if (widget.showGrid) drawGrid(g, d3.axisLeft(yScale).tickSize(-W).tickFormat(''), 'y', 0);

      g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10))).call(styledAxis)
        .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
      g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styledAxis);

      const bars = g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
        .attr('x', d => xScale(d.key)).attr('y', H).attr('width', xScale.bandwidth()).attr('height', 0)
        .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 4);

      bars.transition().duration(500).ease(d3.easeCubicOut).attr('y', d => yScale(d.value)).attr('height', d => H - yScale(d.value));

      bars
        .on('mouseover', (ev, d) => {
          d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1).attr('x', d => xScale(d.key) - 2).attr('width', xScale.bandwidth() + 4);
          showTooltip(ev, <BarTip d={d} widget={widget} color={colors(d.key)} total={pts.reduce((s, p) => s + p.value, 0)} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).transition().duration(100).attr('opacity', opacity).attr('x', d => xScale(d.key)).attr('width', xScale.bandwidth());
          hideTooltip();
        });

      axisLabel(g, widget.xField, W / 2, H + 56, false);
      axisLabel(g, widget.yField, -(H / 2), -46, true);
    }
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

function BarTip({ d, widget, color, total }) {
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '–';
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.yField}</span>
        <span className="tt-value">{formatValue(d.value)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Share of total</span>
        <span className="tt-value">{pct}%</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Records</span>
        <span className="tt-value">{d.count.toLocaleString()}</span>
      </div>
    </>
  );
}

// Helpers
function drawGrid(g, axis, dir, offset) {
  g.append('g')
    .attr('class', 'grid')
    .attr('transform', dir === 'x' ? `translate(0,0)` : `translate(0,${offset})`)
    .call(axis)
    .call(a => a.select('.domain').remove())
    .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
}

function axisLabel(g, text, x, y, rotate) {
  g.append('text')
    .attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('font-family', 'var(--font)')
    .attr('text-anchor', 'middle')
    .attr('transform', rotate ? `translate(${y},${x}) rotate(-90)` : `translate(${x},${y})`)
    .text(text);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
