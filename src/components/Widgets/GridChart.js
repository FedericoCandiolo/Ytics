import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorArray, getSequentialScale, resolveGradient, contrastText } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function GridChart({ widget, data, onCrossFilter }) {
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

    const m = { top: 24, right: 20, bottom: 72, left: 100 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const aggFn = widget.aggregation || 'sum';
    const cellType = widget.gridCellType || 'circle';
    const colorPalette = getColorArray(widget.colorScheme || 'vivid');

    // Build cell map: (xVal, yVal) → measure value
    const cellMap = new Map(); // key `x|||y` → { values: [], subMap: Map<colorVal, []> }
    const xSet = new Set();
    const ySet = new Set();
    const colorSet = new Set();

    for (const row of data) {
      const xVal = String(row[widget.xField] ?? '(blank)');
      const yVal = String(row[widget.yField] ?? '(blank)');
      const numVal = +row[widget.valueField] || 0;
      xSet.add(xVal);
      ySet.add(yVal);
      const key = `${xVal}|||${yVal}`;
      if (!cellMap.has(key)) cellMap.set(key, { values: [], subMap: new Map() });
      const cell = cellMap.get(key);
      cell.values.push(aggFn === 'count' ? 1 : numVal);

      if (widget.colorField) {
        const cVal = String(row[widget.colorField] ?? '(blank)');
        colorSet.add(cVal);
        if (!cell.subMap.has(cVal)) cell.subMap.set(cVal, []);
        cell.subMap.get(cVal).push(aggFn === 'count' ? 1 : numVal);
      }
    }

    const xDomain = [...xSet];
    const yDomain = [...ySet];
    const colorDomain = [...colorSet];

    // Aggregate cells
    const cells = [];
    for (const [key, cell] of cellMap) {
      const [xVal, yVal] = key.split('|||');
      const value = aggregate(cell.values, aggFn, undefined, { distinct: widget.distinct });
      const subValues = widget.colorField
        ? colorDomain.map(cv => ({ label: cv, value: aggregate(cell.subMap.get(cv) || [0], aggFn) }))
        : [];
      cells.push({ xVal, yVal, value, subValues });
    }

    const maxVal = d3.max(cells, d => d.value) || 1;
    const minVal = d3.min(cells, d => d.value) || 0;

    // Scales
    const xScale = d3.scaleBand().domain(xDomain).range([0, W]).padding(0.1);
    const yScale = d3.scaleBand().domain(yDomain).range([0, H]).padding(0.1);
    const cellW = xScale.bandwidth();
    const cellH = yScale.bandwidth();
    const maxR = Math.min(cellW, cellH) / 2 * 0.88;
    const rScale = d3.scaleSqrt().domain([0, maxVal]).range([2, maxR]);

    // Color scale (gradient by value or categorical by colorField)
    let colorFn;
    if (widget.colorField && cellType !== 'circle') {
      colorFn = (i) => colorPalette[i % colorPalette.length];
    } else {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seqScale = getSequentialScale(gradKey, minVal, maxVal, widget.invertGradient);
      colorFn = (val) => seqScale(val);
    }

    // SVG
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Grid lines
    if (widget.showGrid) {
      g.selectAll('.grid-col').data(xDomain).join('line').attr('class', 'grid-col')
        .attr('x1', d => xScale(d) + cellW / 2).attr('x2', d => xScale(d) + cellW / 2)
        .attr('y1', 0).attr('y2', H)
        .attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3').attr('opacity', 0.5);
      g.selectAll('.grid-row').data(yDomain).join('line').attr('class', 'grid-row')
        .attr('y1', d => yScale(d) + cellH / 2).attr('y2', d => yScale(d) + cellH / 2)
        .attr('x1', 0).attr('x2', W)
        .attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3').attr('opacity', 0.5);
    }

    // Axes
    g.append('g').attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0))
      .call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).tickSizeOuter(0)).call(styledAxis);

    // Draw cells
    const cellG = g.append('g');

    for (const cell of cells) {
      const cx = xScale(cell.xVal) + cellW / 2;
      const cy = yScale(cell.yVal) + cellH / 2;
      const r = rScale(cell.value);

      if (cellType === 'circle' || !widget.colorField || cell.subValues.length === 0) {
        // Single circle
        const bg = typeof colorFn === 'function' ? colorFn(cell.value) : colorPalette[0];
        cellG.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', r)
          .attr('fill', bg).attr('opacity', widget.opacity ?? 0.85)
          .attr('stroke', 'var(--bg)').attr('stroke-width', 1)
          .style('cursor', onCrossFilter ? 'pointer' : 'default')
          .on('mouseover', (ev) => {
            d3.select(ev.currentTarget).attr('opacity', 1);
            showTooltip(ev, <GridTip cell={cell} widget={widget} color={bg} />);
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', widget.opacity ?? 0.85); hideTooltip(); })
          .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: cell.xVal }); } : null);
      } else if (cellType === 'pie') {
        // Mini pie
        const total = d3.sum(cell.subValues, d => Math.abs(d.value));
        if (total > 0) {
          let cumAngle = -Math.PI / 2;
          cell.subValues.forEach((sv, si) => {
            const frac = Math.abs(sv.value) / total;
            const angle = frac * Math.PI * 2;
            const a0 = cumAngle, a1 = cumAngle + angle;
            cumAngle = a1;
            const large = angle > Math.PI ? 1 : 0;
            const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
            const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
            const sliceColor = colorFn(si);
            cellG.append('path')
              .attr('d', `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`)
              .attr('fill', sliceColor).attr('opacity', widget.opacity ?? 0.85)
              .attr('stroke', 'var(--bg)').attr('stroke-width', 0.5)
              .on('mouseover', (ev) => { showTooltip(ev, <GridTip cell={cell} widget={widget} />); })
              .on('mousemove', moveTooltip).on('mouseleave', hideTooltip);
          });
        }
      } else if (cellType === 'bar') {
        // Mini bar chart
        const maxSub = d3.max(cell.subValues, d => Math.abs(d.value)) || 1;
        const barW = Math.max(2, (r * 2) / cell.subValues.length - 1);
        const startX = cx - (cell.subValues.length * (barW + 1)) / 2;
        cell.subValues.forEach((sv, si) => {
          const bh = (Math.abs(sv.value) / maxSub) * r * 2;
          const bx = startX + si * (barW + 1);
          const by = cy + r - bh;
          cellG.append('rect')
            .attr('x', bx).attr('y', by).attr('width', barW).attr('height', bh)
            .attr('fill', colorFn(si)).attr('opacity', widget.opacity ?? 0.85)
            .on('mouseover', (ev) => { showTooltip(ev, <GridTip cell={cell} widget={widget} />); })
            .on('mousemove', moveTooltip).on('mouseleave', hideTooltip);
        });
      }
    }

    // Legend for color dimension
    if (widget.showLegend && widget.colorField && colorDomain.length > 0) {
      const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
      colorDomain.slice(0, 12).forEach((val, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 16})`);
        row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colorFn(i)).attr('opacity', 0.85);
        row.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10).attr('fill', 'var(--text-muted)')
          .attr('font-family', 'var(--font)').text(val.length > 12 ? val.slice(0, 12) + '…' : val);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField || !widget.valueField) && (
        <Placeholder text="Select X dim, Y dim, and a measure" />
      )}
    </div>
  );
}

function GridTip({ cell, widget, color }) {
  const fmt = widget.numberFormat;
  return (
    <>
      <div className="chart-tooltip-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />}
        {cell.xVal} · {cell.yVal}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(cell.value, fmt)}</span>
      </div>
      {cell.subValues?.length > 0 && cell.subValues.map(sv => (
        <div key={sv.label} className="chart-tooltip-row">
          <span className="tt-label">{sv.label}</span>
          <span className="tt-value">{formatValue(sv.value, fmt)}</span>
        </div>
      ))}
    </>
  );
}
