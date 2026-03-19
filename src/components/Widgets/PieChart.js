import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function PieChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.labelField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const legW = widget.showLegend ? 128 : 0;
    const availW = w - legW;
    const radius = Math.min(availW, h) / 2 - 18;
    if (radius < 12) return;

    const innerR = ((widget.innerRadius ?? 0) / 100) * radius;
    const cx = availW / 2, cy = h / 2;

    // Aggregate
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.labelField] ?? '(blank)');
      const val = +row[widget.valueField] || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(val);
    }
    let pts = Array.from(groups, ([key, vals]) => ({
      key, value: aggregate(vals, 'sum'), count: vals.length,
    }));
    if (widget.sortByValue !== false) pts.sort((a, b) => b.value - a.value);

    const total = d3.sum(pts, d => d.value);
    const colors = getColorScaleWithOverrides(widget.colorScheme, pts.map(d => d.key), widget.dimensionColors);
    const opacity = widget.opacity ?? 1;

    const pie = d3.pie().value(d => d.value).sort(null).padAngle(0.015);
    const arc = d3.arc().innerRadius(innerR).outerRadius(radius).cornerRadius(4);
    const arcHover = d3.arc().innerRadius(innerR).outerRadius(radius + 8).cornerRadius(4);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const arcs = pie(pts);

    // Animate in
    const slices = g.selectAll('.slice').data(arcs).join('path').attr('class', 'slice')
      .attr('fill', d => colors(d.data.key))
      .attr('opacity', opacity)
      .attr('stroke', '#fff').attr('stroke-width', 2);

    slices.transition().duration(600).ease(d3.easeCubicOut)
      .attrTween('d', function (d) {
        const interp = d3.interpolate({ startAngle: d.startAngle, endAngle: d.startAngle }, d);
        return t => arc(interp(t));
      });

    slices
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).raise().transition().duration(80).attr('d', arcHover(d)).attr('opacity', 1);
        const pct = total > 0 ? ((d.data.value / total) * 100).toFixed(1) : '0';
        showTooltip(ev, <PieTip d={d.data} widget={widget} color={colors(d.data.key)} pct={pct} total={total} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(100).attr('d', arc(d)).attr('opacity', opacity);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.labelField, value: d.data.key }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Labels for larger slices
    g.selectAll('.slice-label').data(arcs.filter(d => (d.endAngle - d.startAngle) > 0.3)).join('text')
      .attr('class', 'slice-label')
      .attr('transform', d => `translate(${arc.centroid(d)})`)
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('font-size', 10).attr('font-family', 'var(--font)').attr('fill', '#fff')
      .attr('font-weight', 600).attr('pointer-events', 'none')
      .text(d => `${((d.data.value / total) * 100).toFixed(0)}%`);

    // Center label for donut
    if (innerR > 0) {
      g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
        .attr('font-size', Math.max(12, Math.min(22, innerR * 0.45)))
        .attr('font-weight', 700).attr('fill', 'var(--text)').text(formatValue(total));
      g.append('text').attr('text-anchor', 'middle').attr('dy', '1.4em')
        .attr('font-size', 10).attr('fill', 'var(--text-muted)').text('total');
    }

    // Legend
    if (widget.showLegend) {
      const leg = svg.append('g').attr('transform', `translate(${availW + 8},${Math.max(8, cy - pts.length * 9)})`);
      pts.slice(0, 12).forEach((d, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 20})`);
        row.append('rect').attr('y', 0).attr('width', 10).attr('height', 10).attr('rx', 3).attr('fill', colors(d.key));
        row.append('text').attr('x', 14).attr('y', 9.5)
          .attr('font-size', 10.5).attr('font-family', 'var(--font)').attr('fill', 'var(--text-muted)')
          .text(d.key.length > 14 ? d.key.slice(0, 14) + '…' : d.key);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.labelField || !widget.valueField) && <Placeholder text="Select Label and Value fields" />}
    </div>
  );
}

function PieTip({ d, widget, color, pct, total }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(d.value)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Share</span>
        <span className="tt-value">{pct}%</span>
      </div>
      <div className="chart-tooltip-stat">
        Total: {formatValue(total)} · {d.count.toLocaleString()} records
      </div>
    </>
  );
}
