/**
 * HeatMap — color matrix for two categorical dimensions + one numeric value.
 * Fields: xField (row label), yField (column label), valueField (numeric intensity).
 * Inspired by d3/heatmap on Observable.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';
import { resolveGradient, getSequentialScale } from '../../utils/colorUtils';

export default function HeatMap({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 20, right: 60, bottom: 80, left: 80 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const agg = widget.aggregation || 'sum';
    const nested = d3.rollup(data,
      v => aggregate(v.map(d => +d[widget.valueField] || 0), agg),
      d => String(d[widget.xField] ?? ''),
      d => String(d[widget.yField] ?? '')
    );

    let xDomain = [...nested.keys()];
    let yDomain = [...new Set(data.map(d => String(d[widget.yField] ?? '')))];

    if (widget.sortBy && widget.sortBy !== 'original') {
      const sortOpts = {
        sortBy: widget.sortBy || 'original',
        sortOrder: widget.sortOrder || 'asc',
        customOrder: widget.customSortOrder,
      };
      const xPts = xDomain.map(k => ({ key: k, value: 0 }));
      xDomain = sortAggregated(xPts, sortOpts).map(p => p.key);
      const yPts = yDomain.map(k => ({ key: k, value: 0 }));
      yDomain = sortAggregated(yPts, sortOpts).map(p => p.key);
    }

    const flat = [];
    nested.forEach((yCols, xVal) => {
      yCols.forEach((val, yVal) => flat.push({ x: xVal, y: yVal, value: val }));
    });

    const [vMin, vMax] = d3.extent(flat, d => d.value);
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const colorScale = getSequentialScale(gradKey, vMin, vMax, widget.invertGradient);
    const opacity = widget.opacity ?? 1;

    const xScale = d3.scaleBand().domain(xDomain).range([0, W]).padding(0.05);
    const yScale = d3.scaleBand().domain(yDomain).range([0, H]).padding(0.05);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale))
      .call(styledAxis).selectAll('text').attr('transform', 'rotate(-40)').style('text-anchor', 'end').attr('dy', '0.4em');
    g.append('g').call(d3.axisLeft(yScale)).call(styledAxis).call(a => a.selectAll('.tick line').remove());

    const cells = g.selectAll('.cell').data(flat).join('rect').attr('class', 'cell')
      .attr('x', d => xScale(d.x)).attr('y', d => yScale(d.y))
      .attr('width', xScale.bandwidth()).attr('height', yScale.bandwidth())
      .attr('fill', 'var(--bg)').attr('rx', 3)
      .attr('stroke', '#fff').attr('stroke-width', 2);

    cells.transition().duration(600).delay((_, i) => i * 1.5).ease(d3.easeCubicOut)
      .attr('fill', d => colorScale(d.value)).attr('opacity', opacity);

    cells
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).raise().transition().duration(80).attr('rx', 6).attr('stroke-width', 3);
        showTooltip(ev, <HeatTip d={d} widget={widget} colorScale={colorScale} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).transition().duration(100).attr('rx', 3).attr('stroke-width', 2);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.x }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 72).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-60,${H / 2}) rotate(-90)`).text(widget.yField);

    // Color legend bar
    const legH = 8, legW = Math.min(W, 140);
    const legX = W - legW;
    const legG = g.append('g').attr('transform', `translate(${legX},${H + 34})`);
    const defs = svg.append('defs');
    const gradId = 'hm-grad';
    const grad = defs.append('linearGradient').attr('id', gradId);
    for (let i = 0; i <= 10; i++) {
      grad.append('stop').attr('offset', `${i * 10}%`).attr('stop-color', colorScale(vMin + (i / 10) * (vMax - vMin)));
    }
    legG.append('rect').attr('width', legW).attr('height', legH).attr('rx', 3).attr('fill', `url(#${gradId})`);
    legG.append('text').attr('x', 0).attr('y', 20).attr('font-size', 9.5).attr('fill', 'var(--chart-axis-color)').text(formatValue(vMin));
    legG.append('text').attr('x', legW).attr('y', 20).attr('text-anchor', 'end').attr('font-size', 9.5).attr('fill', 'var(--chart-axis-color)').text(formatValue(vMax));
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField || !widget.valueField) && <Placeholder text="Select X, Y and Value fields" />}
    </div>
  );
}

function HeatTip({ d, widget, colorScale }) {
  const c = colorScale(d.value);
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c, marginRight: 6, verticalAlign: 'middle', border: '1px solid rgba(255,255,255,.3)' }} />
        {d.x} × {d.y}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(d.value)}</span>
      </div>
    </>
  );
}
