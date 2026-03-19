/**
 * Bump Chart — shows rank over time.
 * Fields: xField (time/category), colorField (series), valueField (numeric, rank is derived).
 * Inspired by d3/bump-chart on Observable.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function BumpChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.colorField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 20, right: 90, bottom: 52, left: 34 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Aggregate: for each (x, series) pair, compute value then rank
    const nested = d3.rollup(data,
      v => d3.sum(v, d => +d[widget.valueField] || 0),
      d => String(d[widget.xField] ?? ''),
      d => String(d[widget.colorField] ?? '')
    );

    const xDomain = [...nested.keys()];
    const series = [...new Set(data.map(d => String(d[widget.colorField] ?? '')))];
    const colors = getColorScaleWithOverrides(widget.colorScheme, series, widget.dimensionColors);
    const opacity = widget.opacity ?? 1;

    // Build ranked data: for each x step, rank series by value
    const rankData = new Map(); // series → [{x, rank, value}]
    xDomain.forEach(xVal => {
      const stepVals = series.map(s => ({ s, v: (nested.get(xVal) || new Map()).get(s) || 0 }));
      stepVals.sort((a, b) => b.v - a.v);
      stepVals.forEach((sv, rank) => {
        if (!rankData.has(sv.s)) rankData.set(sv.s, []);
        rankData.get(sv.s).push({ x: xVal, rank: rank + 1, value: sv.v });
      });
    });

    const maxRank = series.length;
    const xScale = d3.scalePoint().domain(xDomain).range([0, W]).padding(0.2);
    const yScale = d3.scaleLinear().domain([1, maxRank]).range([0, H]);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Rank axis (left — just labels)
    for (let r = 1; r <= maxRank; r++) {
      g.append('text').attr('x', -6).attr('y', yScale(r) + 4)
        .attr('text-anchor', 'end').attr('font-size', 10).attr('fill', 'var(--chart-axis-color)')
        .attr('font-family', 'var(--font)').text(`#${r}`);
    }

    // X axis
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale))
      .call(styledAxis).selectAll('text').attr('dy', '1em');

    // Subtle rank grid lines
    for (let r = 1; r <= maxRank; r++) {
      g.append('line').attr('x1', 0).attr('x2', W).attr('y1', yScale(r)).attr('y2', yScale(r))
        .attr('stroke', 'var(--chart-grid-color)').attr('stroke-width', 1).attr('stroke-dasharray', '3,4');
    }

    // Lines per series
    const lineGen = d3.line().x(d => xScale(d.x)).y(d => yScale(d.rank)).curve(d3.curveBumpX);

    series.forEach(s => {
      const pts = rankData.get(s) || [];
      const color = colors(s);
      const path = g.append('path').datum(pts)
        .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 3)
        .attr('opacity', opacity).attr('stroke-linecap', 'round').attr('d', lineGen);

      const len = path.node()?.getTotalLength() || 0;
      path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(800).ease(d3.easeCubicInOut).attr('stroke-dashoffset', 0);

      // Dots at each step
      const dots = g.selectAll(`.dot-${s.replace(/\W/g, '_')}`).data(pts).join('circle')
        .attr('cx', d => xScale(d.x)).attr('cy', d => yScale(d.rank))
        .attr('r', 0).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 2)
        .attr('opacity', opacity);
      dots.transition().delay(750).duration(200).attr('r', 5);

      dots
        .on('mouseover', (ev, d) => {
          d3.select(ev.currentTarget).raise().transition().duration(80).attr('r', 8);
          showTooltip(ev, <BumpTip d={d} s={s} widget={widget} color={color} maxRank={maxRank} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).transition().duration(100).attr('r', 5);
          hideTooltip();
        })
        .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.colorField, value: s }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null);
    });

    // Right-side series labels (final rank)
    const finalRanks = series.map(s => {
      const pts = rankData.get(s) || [];
      const last = pts[pts.length - 1];
      return { s, rank: last?.rank, y: yScale(last?.rank || 1) };
    }).sort((a, b) => a.rank - b.rank);

    finalRanks.forEach(({ s, y }) => {
      g.append('text').attr('x', W + 8).attr('y', y + 4)
        .attr('font-size', 10.5).attr('fill', colors(s)).attr('font-family', 'var(--font)').attr('font-weight', 600)
        .text(s.length > 12 ? s.slice(0, 12) + '…' : s);
    });
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.colorField || !widget.valueField) &&
        <Placeholder text="Select X (time), Series and Value fields" />}
    </div>
  );
}

function BumpTip({ d, s, widget, color, maxRank }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {s}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.xField}</span>
        <span className="tt-value">{d.x}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Rank</span>
        <span className="tt-value">#{d.rank} of {maxRank}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(d.value)}</span>
      </div>
    </>
  );
}
