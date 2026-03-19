import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getPrimaryColor, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

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

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
      g.append('g').call(d3.axisBottom(xScale).tickSize(-H).tickFormat(''))
        .attr('transform', `translate(0,${H})`)
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

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

    // Regression line (always shown)
    const xVals = pts.map(d => d.x), yVals = pts.map(d => d.y);
    const xMean = d3.mean(xVals), yMean = d3.mean(yVals);
    const num = d3.sum(pts, d => (d.x - xMean) * (d.y - yMean));
    const den = d3.sum(pts, d => (d.x - xMean) ** 2);
    if (den !== 0) {
      const slope = num / den;
      const intercept = yMean - slope * xMean;
      const [x0, x1] = xScale.domain();
      g.append('line')
        .attr('x1', xScale(x0)).attr('y1', yScale(slope * x0 + intercept))
        .attr('x2', xScale(x1)).attr('y2', yScale(slope * x1 + intercept))
        .attr('stroke', 'var(--chart-axis-color)').attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6,4').attr('opacity', 0.5);
    }

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
  return (
    <>
      <div className="chart-tooltip-title">
        {widget.colorField
          ? <><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />{d.color}</>
          : 'Data point'
        }
      </div>
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
