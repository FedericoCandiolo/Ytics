/**
 * Treemap — hierarchical rectangular layout.
 * Fields: labelField (category), valueField (numeric), groupField (optional parent grouping).
 * Inspired by d3/treemap on Observable.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function Treemap({ widget, data, onCrossFilter }) {
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

    // Build hierarchy — optional groupField adds a second level
    let root;
    const agg = widget.aggregation || 'sum';
    if (widget.groupField) {
      const nested = d3.rollup(data,
        v => aggregate(v.map(d => +d[widget.valueField] || 0), agg, undefined, { distinct: widget.distinct }),
        d => String(d[widget.groupField] ?? ''),
        d => String(d[widget.labelField] ?? '')
      );
      root = d3.hierarchy({ name: 'root', children: Array.from(nested, ([grp, children]) => ({
        name: grp,
        children: Array.from(children, ([name, value]) => ({ name, value })),
      })) }).sum(d => d.value).sort((a, b) => b.value - a.value);
    } else {
      const flat = new Map();
      for (const row of data) {
        const key = String(row[widget.labelField] ?? '');
        const val = +row[widget.valueField] || 0;
        if (!flat.has(key)) flat.set(key, []);
        flat.get(key).push(val);
      }
      let pts = Array.from(flat, ([name, vals]) => ({ key: name, value: aggregate(vals, agg, undefined, { distinct: widget.distinct }) }));
      if (widget.sortBy && widget.sortBy !== 'original') {
        pts = sortAggregated(pts, {
          sortBy: widget.sortBy || 'original',
          sortOrder: widget.sortOrder || 'asc',
          customOrder: widget.customSortOrder,
        });
      }
      root = d3.hierarchy({ name: 'root', children: pts.map(p => ({ name: p.key, value: p.value })) })
        .sum(d => d.value).sort((a, b) => b.value - a.value);
    }

    const total = root.value || 1;
    const topKeys = widget.groupField
      ? [...new Set(data.map(d => String(d[widget.groupField] ?? '')))]
      : [...new Set(data.map(d => String(d[widget.labelField] ?? '')))];
    let colors, leafColorFn;
    if (widget.colorMode === 'gradient') {
      const leafVals = root.leaves().map(d => d.value);
      const ext = [Math.min(...leafVals), Math.max(...leafVals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient, widget.logGradient);
      leafColorFn = val => seq(val);
      colors = getColorScaleWithOverrides(widget.colorScheme, topKeys, widget.dimensionColors);
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, topKeys, widget.dimensionColors);
      leafColorFn = null;
    }
    const opacity = widget.opacity ?? 1;

    d3.treemap().size([w, h]).paddingInner(2).paddingOuter(4).paddingTop(widget.groupField ? 18 : 2).round(true)(root);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    const leaves = root.leaves();

    const cell = svg.selectAll('.cell').data(leaves).join('g').attr('class', 'cell')
      .attr('transform', d => `translate(${d.x0},${d.y0})`);

    cell.append('rect')
      .attr('width', d => Math.max(0, d.x1 - d.x0))
      .attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('fill', d => {
        if (leafColorFn) return leafColorFn(d.value);
        const key = widget.groupField ? d.parent.data.name : d.data.name;
        return colors(key);
      })
      .attr('opacity', 0)
      .attr('rx', 4).attr('stroke', '#fff').attr('stroke-width', 2)
      .transition().duration(500).ease(d3.easeCubicOut).attr('opacity', opacity);

    // Labels — only if enough space
    cell.filter(d => (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 22).append('text')
      .attr('x', 6).attr('y', 14)
      .attr('font-size', d => Math.min(12, Math.max(9, (d.x1 - d.x0) / 7)))
      .attr('font-family', 'var(--font)').attr('font-weight', 600)
      .attr('fill', '#fff').attr('pointer-events', 'none')
      .text(d => d.data.name.length > Math.floor((d.x1 - d.x0) / 7)
        ? d.data.name.slice(0, Math.floor((d.x1 - d.x0) / 7)) + '…'
        : d.data.name);

    cell.filter(d => (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 36).append('text')
      .attr('x', 6).attr('y', 26)
      .attr('font-size', 10).attr('fill', 'rgba(255,255,255,.75)').attr('pointer-events', 'none')
      .attr('font-family', 'var(--font)')
      .text(d => formatValue(d.data.value, widget.numberFormat));

    // Parent group labels
    if (widget.groupField) {
      const parents = root.children || [];
      svg.selectAll('.parent-label').data(parents).join('text').attr('class', 'parent-label')
        .attr('x', d => d.x0 + 4).attr('y', d => d.y0 + 12)
        .attr('font-size', 11).attr('font-weight', 700).attr('fill', d => colors(d.data.name))
        .attr('font-family', 'var(--font)').attr('pointer-events', 'none')
        .text(d => d.data.name);
    }

    // Interactivity
    cell.select('rect')
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1).attr('stroke-width', 3);
        const parentKey = widget.groupField ? d.parent.data.name : null;
        const color = leafColorFn ? leafColorFn(d.value) : colors(widget.groupField ? parentKey : d.data.name);
        const pct = ((d.data.value / total) * 100).toFixed(1);
        showTooltip(ev, <TreeTip d={d} widget={widget} color={color} pct={pct} parent={parentKey} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).transition().duration(120).attr('opacity', opacity).attr('stroke-width', 2);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.labelField, value: d.data.name }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} />
      {tooltipEl}
      {(!widget.labelField || !widget.valueField) && <Placeholder text="Select Label and Value fields" />}
    </div>
  );
}

function TreeTip({ d, widget, color, pct, parent }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.data.name}
      </div>
      {parent && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.groupField}</span>
          <span className="tt-value">{parent}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(d.data.value, widget.numberFormat)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Share of total</span>
        <span className="tt-value">{pct}%</span>
      </div>
    </>
  );
}
