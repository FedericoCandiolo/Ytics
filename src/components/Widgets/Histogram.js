import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getPrimaryColor } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function Histogram({ widget, data }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const vals = data.map(d => +d[widget.xField]).filter(v => !isNaN(v));
    if (!vals.length) return;

    const m = { top: 16, right: 18, bottom: 52, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const xScale = d3.scaleLinear().domain(d3.extent(vals)).nice().range([0, W]);
    const bins = d3.bin().domain(xScale.domain()).thresholds(xScale.ticks(widget.bins ?? 20))(vals);
    const yScale = d3.scaleLinear().domain([0, d3.max(bins, d => d.length) * 1.08]).range([H, 0]).nice();

    const fillColor = getPrimaryColor(widget.colorScheme);
    const opacity = widget.opacity ?? 1;
    const mean = d3.mean(vals), median = d3.median(vals), std = d3.deviation(vals);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5)).call(styledAxis);

    const bars = g.selectAll('.bin').data(bins).join('rect').attr('class', 'bin')
      .attr('x', d => xScale(d.x0) + 1).attr('y', H)
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 2))
      .attr('height', 0).attr('fill', fillColor).attr('opacity', opacity).attr('rx', 3);

    bars.transition().duration(500).ease(d3.easeCubicOut)
      .attr('y', d => yScale(d.length)).attr('height', d => H - yScale(d.length));

    bars
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1);
        const pct = ((d.length / vals.length) * 100).toFixed(1);
        showTooltip(ev, <HistTip d={d} color={fillColor} pct={pct} total={vals.length} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).transition().duration(100).attr('opacity', opacity);
        hideTooltip();
      });

    [{ val: mean, label: 'Mean', dash: '5,3', color: '#4f8ef7' },
     { val: median, label: 'Median', dash: '2,3', color: '#0ea572' }].forEach(a => {
      const x = xScale(a.val);
      g.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', H)
        .attr('stroke', a.color).attr('stroke-width', 1.5).attr('stroke-dasharray', a.dash).attr('opacity', 0.75);
      g.append('text').attr('x', x + 3).attr('y', 12)
        .attr('font-size', 9.5).attr('fill', a.color).attr('font-family', 'var(--font)')
        .text(a.label + ' ' + fmtTick(a.val));
    });

    if (std > 0) {
      const binW = bins[0] ? xScale(bins[0].x1) - xScale(bins[0].x0) : 1;
      g.append('path').datum(xScale.ticks(80))
        .attr('fill', 'none').attr('stroke', fillColor).attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,3').attr('opacity', 0.45)
        .attr('d', d3.line()
          .x(d => xScale(d))
          .y(d => yScale(((1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((d - mean) / std) ** 2)) * vals.length * binW))
          .curve(d3.curveBasis));
    }

    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 46).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-44,${H / 2}) rotate(-90)`).text('Count');

    const statsG = g.append('g').attr('transform', `translate(${W - 4}, 4)`);
    [`n = ${vals.length.toLocaleString()}`, `μ = ${fmtTick(mean)}`, `σ = ${fmtTick(std)}`].forEach((t, i) =>
      statsG.append('text').attr('x', 0).attr('y', i * 13).attr('text-anchor', 'end')
        .attr('font-size', 9.5).attr('fill', 'var(--chart-axis-color)').attr('font-family', 'var(--font)').text(t)
    );
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {!widget.xField && <Placeholder text="Select a numeric field" />}
    </div>
  );
}

function HistTip({ d, color, pct, total }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {formatValue(d.x0)} – {formatValue(d.x1)}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Count</span>
        <span className="tt-value">{d.length.toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Frequency</span>
        <span className="tt-value">{pct}%</span>
      </div>
      <div className="chart-tooltip-stat">of {total.toLocaleString()} total values</div>
    </>
  );
}
