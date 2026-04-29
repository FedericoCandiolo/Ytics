/**
 * Stream Graph — flowing stacked areas over time.
 * Fields: xField (time/category), colorField (series), valueField (numeric).
 * Inspired by d3/streamgraph on Observable.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function StreamGraph({ widget, data, onCrossFilter }) {
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

    const m = { top: 16, right: 20, bottom: 48, left: 58 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const agg = widget.aggregation || 'sum';

    // Pivot: x → { series: value }
    const nested = d3.rollup(data,
      v => aggregate(v.map(d => +d[widget.valueField] || 0), agg),
      d => String(d[widget.xField] ?? ''),
      d => String(d[widget.colorField] ?? '')
    );

    let xDomain = [...nested.keys()];
    if (widget.sortBy && widget.sortBy !== 'original') {
      let pts = xDomain.map((xVal, i) => ({ key: xVal, value: i }));
      pts = sortAggregated(pts, {
        sortBy: widget.sortBy || 'original',
        sortOrder: widget.sortOrder || 'asc',
        customOrder: widget.customSortOrder,
      });
      xDomain = pts.map(p => p.key);
    }
    const series = [...new Set(data.map(d => String(d[widget.colorField] ?? '')))];

    // Build stack-compatible matrix
    const matrix = xDomain.map(x => {
      const row = { x };
      series.forEach(s => { row[s] = (nested.get(x) || new Map()).get(s) || 0; });
      return row;
    });

    let colors;
    if (widget.colorMode === 'gradient') {
      const totals = series.map(s => {
        let total = 0;
        matrix.forEach(row => { total += row[s] || 0; });
        return total;
      });
      const ext = [Math.min(...totals), Math.max(...totals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient, widget.logGradient);
      const totalMap = new Map(series.map((s, i) => [s, totals[i]]));
      colors = d => seq(totalMap.get(d) ?? 0);
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, series, widget.dimensionColors);
    }
    const opacity = widget.opacity ?? 0.9;

    const stack = d3.stack().keys(series).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
    const stacked = stack(matrix);

    const allVals = stacked.flatMap(s => s.flatMap(d => d));
    const xScale = d3.scalePoint().domain(xDomain).range([0, W]).padding(0.1);
    const yScale = d3.scaleLinear().domain([d3.min(allVals), d3.max(allVals)]).range([H, 0]).nice();

    const area = d3.area()
      .x(d => xScale(d.data.x))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale))
      .call(styledAxis).selectAll('text').attr('dy', '1em');
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

    const paths = g.selectAll('.stream').data(stacked).join('path').attr('class', 'stream')
      .attr('fill', d => colors(d.key)).attr('opacity', 0).attr('d', area);

    paths.transition().duration(700).ease(d3.easeCubicOut).attr('opacity', opacity);

    // Hover
    paths
      .on('mouseover', (ev, d) => {
        g.selectAll('.stream').transition().duration(100).attr('opacity', 0.25);
        d3.select(ev.currentTarget).raise().transition().duration(100).attr('opacity', 1);
        const total = d3.sum(d, pt => pt[1] - pt[0]);
        showTooltip(ev, <StreamTip s={d.key} widget={widget} color={colors(d.key)} total={total} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', () => {
        g.selectAll('.stream').transition().duration(150).attr('opacity', opacity);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.colorField, value: d.key }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Series labels — place at widest point
    stacked.forEach(layer => {
      const widest = layer.reduce((best, d) => (d[1] - d[0]) > (best[1] - best[0]) ? d : best, layer[0]);
      const cx = xScale(widest.data.x);
      const cy = yScale((widest[0] + widest[1]) / 2);
      const bandH = Math.abs(yScale(widest[1]) - yScale(widest[0]));
      if (bandH > 16) {
        g.append('text').attr('x', cx).attr('y', cy + 4)
          .attr('text-anchor', 'middle').attr('font-size', Math.min(11, bandH * 0.45))
          .attr('fill', '#fff').attr('font-weight', 600).attr('pointer-events', 'none')
          .attr('font-family', 'var(--font)')
          .text(layer.key.length > 12 ? layer.key.slice(0, 12) + '…' : layer.key);
      }
    });

    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 42).text(widget.xField);
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

function StreamTip({ s, widget, color, total }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {s}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Series</span>
        <span className="tt-value">{widget.colorField}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Total ({widget.aggregation})</span>
        <span className="tt-value">{formatValue(total, widget.numberFormat)}</span>
      </div>
      <div className="chart-tooltip-stat">Hover other bands to compare</div>
    </>
  );
}
