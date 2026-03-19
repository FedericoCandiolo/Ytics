/**
 * Violin Plot — shows distribution shape + box plot for each category.
 * Fields: xField (category), yField (numeric).
 * Inspired by d3/violin-plot on Observable.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function ViolinPlot({ widget, data, onCrossFilter }) {
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

    const m = { top: 16, right: 18, bottom: 60, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Group by xField
    const groups = d3.rollup(data,
      v => v.map(d => +d[widget.yField]).filter(v => !isNaN(v)).sort(d3.ascending),
      d => String(d[widget.xField] ?? '')
    );

    const xDomain = [...groups.keys()];
    if (!xDomain.length) return;

    const allVals = [...groups.values()].flat();
    const yExtent = d3.extent(allVals);
    const colors = getColorScaleWithOverrides(widget.colorScheme, xDomain, widget.dimensionColors);
    const opacity = widget.opacity ?? 1;

    const xScale = d3.scaleBand().domain(xDomain).range([0, W]).padding(0.3);
    const yScale = d3.scaleLinear().domain([yExtent[0] - (yExtent[1] - yExtent[0]) * 0.08, yExtent[1] * 1.04]).range([H, 0]).nice();

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale))
      .call(styledAxis).selectAll('text').attr('transform', 'rotate(-25)').style('text-anchor', 'end');
    g.append('g').call(d3.axisLeft(yScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);

    const bw = xScale.bandwidth();

    xDomain.forEach(cat => {
      const vals = groups.get(cat);
      if (!vals.length) return;
      const cx = xScale(cat) + bw / 2;
      const color = colors(cat);

      // KDE
      const kde = kernelDensityEstimator(epanechnikovKernel(bw * 0.5), yScale.ticks(30));
      const density = kde(vals);
      const maxDensity = d3.max(density, d => d[1]);
      const violinScale = d3.scaleLinear().domain([0, maxDensity]).range([0, bw / 2 - 4]);

      const violinArea = d3.area()
        .x0(d => cx - violinScale(d[1])).x1(d => cx + violinScale(d[1]))
        .y(d => yScale(d[0]))
        .curve(d3.curveCatmullRom);

      const path = g.append('path').datum(density)
        .attr('fill', color).attr('opacity', 0).attr('d', violinArea);
      path.transition().duration(600).ease(d3.easeCubicOut).attr('opacity', opacity * 0.75);

      path
        .on('mouseover', (ev) => {
          d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1);
          const stats = computeStats(vals);
          showTooltip(ev, <ViolinTip cat={cat} stats={stats} widget={widget} color={color} n={vals.length} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).transition().duration(100).attr('opacity', opacity * 0.75);
          hideTooltip();
        })
        .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: cat }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null);

      // Box plot overlay
      const stats = computeStats(vals);
      const boxW = Math.min(bw * 0.18, 12);

      // IQR box
      g.append('rect')
        .attr('x', cx - boxW / 2).attr('y', yScale(stats.q3))
        .attr('width', boxW).attr('height', yScale(stats.q1) - yScale(stats.q3))
        .attr('fill', '#fff').attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', 0)
        .transition().duration(600).attr('opacity', 0.9);

      // Median line
      g.append('line').attr('x1', cx - boxW / 2 - 3).attr('x2', cx + boxW / 2 + 3)
        .attr('y1', yScale(stats.median)).attr('y2', yScale(stats.median))
        .attr('stroke', color).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');

      // Whiskers
      [stats.whiskerLow, stats.whiskerHigh].forEach(w => {
        g.append('line').attr('x1', cx).attr('x2', cx)
          .attr('y1', yScale(stats.q1)).attr('y2', yScale(w))
          .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2').attr('opacity', 0.7);
        g.append('line').attr('x1', cx - 4).attr('x2', cx + 4)
          .attr('y1', yScale(w)).attr('y2', yScale(w))
          .attr('stroke', color).attr('stroke-width', 1.5);
      });
    });

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 52).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-44,${H / 2}) rotate(-90)`).text(widget.yField);
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select Category (X) and Numeric (Y) fields" />}
    </div>
  );
}

function computeStats(vals) {
  const sorted = [...vals].sort(d3.ascending);
  const q1 = d3.quantile(sorted, 0.25);
  const median = d3.quantile(sorted, 0.5);
  const q3 = d3.quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const whiskerLow = d3.max(sorted.filter(v => v >= q1 - 1.5 * iqr));
  const whiskerHigh = d3.min(sorted.filter(v => v <= q3 + 1.5 * iqr));
  const mean = d3.mean(sorted);
  const std = d3.deviation(sorted);
  return { q1, median, q3, iqr, whiskerLow: whiskerLow ?? q1, whiskerHigh: whiskerHigh ?? q3, mean, std };
}

function kernelDensityEstimator(kernel, X) {
  return function (V) {
    return X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
  };
}

function epanechnikovKernel(bandwidth) {
  return function (u) {
    u = u / bandwidth;
    return Math.abs(u) <= 1 ? 0.75 * (1 - u * u) / bandwidth : 0;
  };
}

function ViolinTip({ cat, stats, widget, color, n }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {cat}
      </div>
      {[
        ['n', n.toLocaleString()],
        ['Mean', formatValue(stats.mean)],
        ['Median', formatValue(stats.median)],
        ['Std dev', formatValue(stats.std)],
        ['Q1', formatValue(stats.q1)],
        ['Q3', formatValue(stats.q3)],
        ['IQR', formatValue(stats.iqr)],
      ].map(([label, val]) => (
        <div key={label} className="chart-tooltip-row">
          <span className="tt-label">{label}</span>
          <span className="tt-value">{val}</span>
        </div>
      ))}
    </>
  );
}
