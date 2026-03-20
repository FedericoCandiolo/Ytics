import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function RadarChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.axisField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = 50;
    const radius = Math.min(w, h) / 2 - m;
    if (radius < 20) return;

    const opacity = widget.opacity ?? 1;
    const hasSeries = !!widget.colorField;

    // Compute axes (unique axisField values)
    let axes = [...new Set(data.map(d => String(d[widget.axisField] ?? '')))];
    if (widget.sortBy && widget.sortBy !== 'original') {
      axes = sortAggregated(
        axes.map(key => ({ key, value: key })),
        { sortBy: widget.sortBy, sortOrder: widget.sortOrder || 'asc', customOrder: widget.customSortOrder },
      ).map(d => d.key);
    }
    const numAxes = axes.length;
    if (numAxes < 3) return; // radar needs at least 3 axes

    const angleSlice = (2 * Math.PI) / numAxes;

    // Group into series
    const seriesMap = new Map();
    for (const row of data) {
      const sKey = hasSeries ? String(row[widget.colorField] ?? '') : '__all__';
      if (!seriesMap.has(sKey)) seriesMap.set(sKey, new Map());
      const axisKey = String(row[widget.axisField] ?? '');
      if (!seriesMap.get(sKey).has(axisKey)) seriesMap.get(sKey).set(axisKey, []);
      seriesMap.get(sKey).get(axisKey).push(+row[widget.valueField] || 0);
    }

    const seriesNames = [...seriesMap.keys()];
    // Aggregate each series × axis (moved before colors for gradient computation)
    const seriesData = seriesNames.map(name => {
      const axisMap = seriesMap.get(name);
      return {
        name,
        values: axes.map(axis => {
          const vals = axisMap.get(axis) || [0];
          return aggregate(vals, widget.aggregation || 'sum');
        }),
      };
    });

    let colors;
    if (widget.colorMode === 'gradient') {
      const totals = seriesData.map(s => d3.sum(s.values));
      const ext = [Math.min(...totals), Math.max(...totals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1]);
      const totalMap = new Map(seriesNames.map((n, i) => [n, totals[i]]));
      colors = d => seq(totalMap.get(d) ?? 0);
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, seriesNames, widget.dimensionColors);
    }

    const maxVal = d3.max(seriesData.flatMap(s => s.values)) || 1;
    const rScale = d3.scaleLinear().domain([0, maxVal]).range([0, radius]);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${w / 2},${h / 2})`);

    // Grid circles
    const levels = 5;
    for (let i = 1; i <= levels; i++) {
      const r = (radius / levels) * i;
      g.append('circle')
        .attr('r', r).attr('fill', 'none')
        .attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3').attr('opacity', 0.6);
      g.append('text')
        .attr('x', 4).attr('y', -r - 2)
        .attr('font-size', 9).attr('fill', 'var(--text-muted)')
        .text(formatValue((maxVal / levels) * i));
    }

    // Axis lines and labels
    axes.forEach((axis, i) => {
      const angle = angleSlice * i - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      g.append('line')
        .attr('x1', 0).attr('y1', 0).attr('x2', x).attr('y2', y)
        .attr('stroke', 'var(--chart-grid-color)').attr('stroke-width', 1);

      const labelR = radius + 16;
      const lx = Math.cos(angle) * labelR;
      const ly = Math.sin(angle) * labelR;
      g.append('text')
        .attr('x', lx).attr('y', ly)
        .attr('text-anchor', Math.abs(lx) < 5 ? 'middle' : lx > 0 ? 'start' : 'end')
        .attr('dominant-baseline', Math.abs(ly) < 5 ? 'central' : ly > 0 ? 'hanging' : 'auto')
        .attr('font-size', 10.5).attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
        .text(axis.length > 14 ? axis.slice(0, 14) + '…' : axis);
    });

    // Draw series polygons
    const curveFn = widget.radarCurve === 'curved'
      ? d3.curveCatmullRomClosed
      : d3.curveLinearClosed;
    const radarLine = d3.lineRadial()
      .radius(d => rScale(d))
      .angle((d, i) => i * angleSlice)
      .curve(curveFn);

    seriesData.forEach((series, si) => {
      const color = colors(series.name);

      g.append('path')
        .datum(series.values)
        .attr('d', radarLine)
        .attr('fill', color).attr('fill-opacity', 0.12 * opacity)
        .attr('stroke', color).attr('stroke-width', 2).attr('opacity', opacity);

      // Data points
      series.values.forEach((val, i) => {
        const angle = angleSlice * i - Math.PI / 2;
        const x = Math.cos(angle) * rScale(val);
        const y = Math.sin(angle) * rScale(val);

        g.append('circle')
          .attr('cx', x).attr('cy', y)
          .attr('r', 4).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5)
          .attr('opacity', opacity)
          .on('mouseover', ev => showTooltip(ev, <RadarTip axis={axes[i]} value={val} series={series.name} color={color} hasSeries={hasSeries} widget={widget} />))
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip)
          .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: hasSeries ? widget.colorField : widget.axisField, value: hasSeries ? series.name : axes[i] }); } : null)
          .style('cursor', onCrossFilter ? 'pointer' : null);
      });
    });

    // Legend
    if (widget.showLegend && hasSeries && seriesNames.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${-w / 2 + 10},${-h / 2 + 10})`);
      seriesNames.slice(0, 8).forEach((name, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colors(name));
        row.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10).attr('fill', 'var(--text-muted)')
          .text(name.length > 15 ? name.slice(0, 15) + '…' : name);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.axisField || !widget.valueField) && <Placeholder text="Select Axis and Value fields" />}
    </div>
  );
}

function RadarTip({ axis, value, series, color, hasSeries, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {axis}
      </div>
      {hasSeries && <div className="chart-tooltip-row"><span className="tt-label">Series</span><span className="tt-value">{series}</span></div>}
      <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(value)}</span></div>
    </>
  );
}
