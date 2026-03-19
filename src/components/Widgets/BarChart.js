import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getOrdinalWithOverrides, getSequentialScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function BarChart({ widget, data, onCrossFilter }) {
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

    const hasGroup = !!widget.groupField;
    const isH = widget.orientation === 'horizontal';
    const barMode = widget.barMode || 'stacked';
    const opacity = widget.opacity ?? 1;

    if (hasGroup) {
      renderGrouped(svgRef, data, widget, dims, isH, barMode, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    } else {
      renderSimple(svgRef, data, widget, dims, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    }
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

// ── Simple bar (no groupField) ─────────────────────────────────────────────────
function renderSimple(svgRef, data, widget, dims, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 14, right: 18, bottom: isH ? 46 : 70, left: isH ? 130 : 58 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  const groups = new Map();
  for (const row of data) {
    const key = String(row[widget.xField] ?? '(blank)');
    const val = +row[widget.yField] || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(val);
  }
  let pts = Array.from(groups, ([key, vals]) => ({
    key, value: aggregate(vals, widget.aggregation || 'sum'), count: vals.length,
  }));

  if (widget.sortBy === 'label') {
    pts.sort((a, b) => widget.sortOrder === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
  } else {
    pts.sort((a, b) => widget.sortOrder === 'desc' ? b.value - a.value : a.value - b.value);
  }

  const domain = pts.map(d => d.key);
  let colors;
  if (widget.colorMode === 'gradient') {
    const ext = [Math.min(...pts.map(d => d.value)), Math.max(...pts.map(d => d.value))];
    const seq = getSequentialScale(widget.colorGradient || 'blues', ext[0], ext[1]);
    colors = d => seq(pts.find(p => p.key === d)?.value ?? 0);
  } else {
    colors = getColorScaleWithOverrides(widget.colorScheme, domain, widget.dimensionColors);
  }
  const maxVal = d3.max(pts, d => d.value) * 1.05 || 1;
  const total = pts.reduce((s, p) => s + p.value, 0);

  const svg = d3.select(svgRef.current);
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  if (isH) {
    const yScale = d3.scaleBand().domain(pts.map(d => d.key)).range([0, H]).padding(0.22);
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisBottom(xScale).tickSize(-H).tickFormat(''), 'x', H);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(formatValue)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).tickFormat(d => truncate(d, 18))).call(styledAxis).call(a => a.selectAll('.tick line').remove());

    g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
      .attr('y', d => yScale(d.key)).attr('x', 0).attr('height', yScale.bandwidth()).attr('width', 0)
      .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 4)
      .on('mouseover', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', 1); showTooltip(ev, <BarTip d={d} widget={widget} color={colors(d.key)} total={total} />); })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null)
      .transition().duration(500).ease(d3.easeCubicOut).attr('width', d => xScale(d.value));

    axisLabel(g, widget.yField, W / 2, H + 38, false);
  } else {
    const xScale = d3.scaleBand().domain(pts.map(d => d.key)).range([0, W]).padding(0.22);
    const yScale = d3.scaleLinear().domain([0, maxVal]).range([H, 0]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisLeft(yScale).tickSize(-W).tickFormat(''), 'y', 0);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10))).call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styledAxis);

    g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
      .attr('x', d => xScale(d.key)).attr('y', H).attr('width', xScale.bandwidth()).attr('height', 0)
      .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 4)
      .on('mouseover', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', 1); showTooltip(ev, <BarTip d={d} widget={widget} color={colors(d.key)} total={total} />); })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null)
      .transition().duration(500).ease(d3.easeCubicOut).attr('y', d => yScale(d.value)).attr('height', d => H - yScale(d.value));

    axisLabel(g, widget.xField, W / 2, H + 56, false);
    axisLabel(g, widget.yField, -(H / 2), -46, true);
  }
}

// ── Grouped/Stacked bar ────────────────────────────────────────────────────────
function renderGrouped(svgRef, data, widget, dims, isH, barMode, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 14, right: 18, bottom: isH ? 46 : 70, left: isH ? 130 : 58 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  // Pivot: aggregate by (xField, groupField)
  const pivotMap = new Map();
  const groupSet = new Set();
  for (const row of data) {
    const xKey = String(row[widget.xField] ?? '(blank)');
    const gKey = String(row[widget.groupField] ?? '(blank)');
    groupSet.add(gKey);
    const mapKey = `${xKey}|||${gKey}`;
    if (!pivotMap.has(mapKey)) pivotMap.set(mapKey, { xKey, gKey, vals: [] });
    pivotMap.get(mapKey).vals.push(+row[widget.yField] || 0);
  }

  const groupKeys = [...groupSet];
  const xKeys = [...new Set([...pivotMap.values()].map(v => v.xKey))];

  // Build pivot table
  const pivotData = xKeys.map(xKey => {
    const row = { __x: xKey };
    for (const gKey of groupKeys) {
      const entry = pivotMap.get(`${xKey}|||${gKey}`);
      row[gKey] = entry ? aggregate(entry.vals, widget.aggregation || 'sum') : 0;
    }
    return row;
  });

  // Sort
  if (widget.sortBy === 'label') {
    pivotData.sort((a, b) => widget.sortOrder === 'desc' ? b.__x.localeCompare(a.__x) : a.__x.localeCompare(b.__x));
  } else {
    pivotData.sort((a, b) => {
      const sumA = groupKeys.reduce((s, k) => s + (a[k] || 0), 0);
      const sumB = groupKeys.reduce((s, k) => s + (b[k] || 0), 0);
      return widget.sortOrder === 'desc' ? sumB - sumA : sumA - sumB;
    });
  }

  const colorScale = getOrdinalWithOverrides(widget.colorScheme, groupKeys, widget.dimensionColors);

  const svg = d3.select(svgRef.current);
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  if (barMode === 'stacked') {
    renderStacked(g, pivotData, groupKeys, colorScale, widget, W, H, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
  } else {
    renderGroupedBars(g, pivotData, groupKeys, colorScale, widget, W, H, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
  }

  // Legend
  if (widget.showLegend && groupKeys.length > 1) {
    const leg = g.append('g').attr('transform', `translate(${W - groupKeys.length * 80}, ${-10})`);
    groupKeys.slice(0, 10).forEach((key, i) => {
      const item = leg.append('g').attr('transform', `translate(${i * 80}, 0)`);
      item.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colorScale(key));
      item.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10).attr('fill', 'var(--text-muted)')
        .text(truncate(key, 8));
    });
  }
}

function renderStacked(g, pivotData, groupKeys, colorScale, widget, W, H, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const stack = d3.stack().keys(groupKeys);
  const stacked = stack(pivotData);

  const maxVal = d3.max(stacked, layer => d3.max(layer, d => d[1])) * 1.05 || 1;

  if (isH) {
    const yScale = d3.scaleBand().domain(pivotData.map(d => d.__x)).range([0, H]).padding(0.22);
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisBottom(xScale).tickSize(-H).tickFormat(''), 'x', H);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(formatValue)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).tickFormat(d => truncate(d, 18))).call(styledAxis).call(a => a.selectAll('.tick line').remove());

    stacked.forEach(layer => {
      g.selectAll(`.bar-${layer.key}`).data(layer).join('rect')
        .attr('y', d => yScale(d.data.__x)).attr('x', d => xScale(d[0]))
        .attr('height', yScale.bandwidth()).attr('width', 0)
        .attr('fill', colorScale(layer.key)).attr('opacity', opacity).attr('rx', 2)
        .on('mouseover', (ev, d) => {
          showTooltip(ev, <StackedTip x={d.data.__x} group={layer.key} value={d[1] - d[0]} color={colorScale(layer.key)} total={groupKeys.reduce((s, k) => s + (d.data[k] || 0), 0)} widget={widget} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip)
        .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.data.__x }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null)
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('width', d => xScale(d[1]) - xScale(d[0]));
    });
    axisLabel(g, widget.yField, W / 2, H + 38, false);
  } else {
    const xScale = d3.scaleBand().domain(pivotData.map(d => d.__x)).range([0, W]).padding(0.22);
    const yScale = d3.scaleLinear().domain([0, maxVal]).range([H, 0]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisLeft(yScale).tickSize(-W).tickFormat(''), 'y', 0);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10))).call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styledAxis);

    stacked.forEach(layer => {
      g.selectAll(`.bar-${layer.key}`).data(layer).join('rect')
        .attr('x', d => xScale(d.data.__x)).attr('y', H)
        .attr('width', xScale.bandwidth()).attr('height', 0)
        .attr('fill', colorScale(layer.key)).attr('opacity', opacity).attr('rx', 2)
        .on('mouseover', (ev, d) => {
          showTooltip(ev, <StackedTip x={d.data.__x} group={layer.key} value={d[1] - d[0]} color={colorScale(layer.key)} total={groupKeys.reduce((s, k) => s + (d.data[k] || 0), 0)} widget={widget} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip)
        .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.data.__x }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null)
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('y', d => yScale(d[1])).attr('height', d => yScale(d[0]) - yScale(d[1]));
    });
    axisLabel(g, widget.xField, W / 2, H + 56, false);
    axisLabel(g, widget.yField, -(H / 2), -46, true);
  }
}

function renderGroupedBars(g, pivotData, groupKeys, colorScale, widget, W, H, isH, opacity, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const maxVal = d3.max(pivotData, d => d3.max(groupKeys, k => d[k] || 0)) * 1.05 || 1;

  if (isH) {
    const yScale = d3.scaleBand().domain(pivotData.map(d => d.__x)).range([0, H]).padding(0.15);
    const yInner = d3.scaleBand().domain(groupKeys).range([0, yScale.bandwidth()]).padding(0.05);
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, W]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisBottom(xScale).tickSize(-H).tickFormat(''), 'x', H);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(formatValue)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).tickFormat(d => truncate(d, 18))).call(styledAxis).call(a => a.selectAll('.tick line').remove());

    pivotData.forEach(row => {
      groupKeys.forEach(gk => {
        g.append('rect')
          .attr('y', yScale(row.__x) + yInner(gk)).attr('x', 0)
          .attr('height', yInner.bandwidth()).attr('width', 0)
          .attr('fill', colorScale(gk)).attr('opacity', opacity).attr('rx', 2)
          .on('mouseover', (ev) => {
            showTooltip(ev, <StackedTip x={row.__x} group={gk} value={row[gk] || 0} color={colorScale(gk)} total={groupKeys.reduce((s, k) => s + (row[k] || 0), 0)} widget={widget} />);
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip)
          .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: row.__x }); } : null)
          .style('cursor', onCrossFilter ? 'pointer' : null)
          .transition().duration(500).ease(d3.easeCubicOut).attr('width', xScale(row[gk] || 0));
      });
    });
    axisLabel(g, widget.yField, W / 2, H + 38, false);
  } else {
    const xScale = d3.scaleBand().domain(pivotData.map(d => d.__x)).range([0, W]).padding(0.15);
    const xInner = d3.scaleBand().domain(groupKeys).range([0, xScale.bandwidth()]).padding(0.05);
    const yScale = d3.scaleLinear().domain([0, maxVal]).range([H, 0]).nice();
    if (widget.showGrid) drawGrid(g, d3.axisLeft(yScale).tickSize(-W).tickFormat(''), 'y', 0);
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10))).call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styledAxis);

    pivotData.forEach(row => {
      groupKeys.forEach(gk => {
        g.append('rect')
          .attr('x', xScale(row.__x) + xInner(gk)).attr('y', H)
          .attr('width', xInner.bandwidth()).attr('height', 0)
          .attr('fill', colorScale(gk)).attr('opacity', opacity).attr('rx', 2)
          .on('mouseover', (ev) => {
            showTooltip(ev, <StackedTip x={row.__x} group={gk} value={row[gk] || 0} color={colorScale(gk)} total={groupKeys.reduce((s, k) => s + (row[k] || 0), 0)} widget={widget} />);
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip)
          .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: row.__x }); } : null)
          .style('cursor', onCrossFilter ? 'pointer' : null)
          .transition().duration(500).ease(d3.easeCubicOut)
          .attr('y', yScale(row[gk] || 0)).attr('height', H - yScale(row[gk] || 0));
      });
    });
    axisLabel(g, widget.xField, W / 2, H + 56, false);
    axisLabel(g, widget.yField, -(H / 2), -46, true);
  }
}

// ── Tooltips ───────────────────────────────────────────────────────────────────
function BarTip({ d, widget, color, total }) {
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '–';
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(d.value)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share</span><span className="tt-value">{pct}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Records</span><span className="tt-value">{d.count.toLocaleString()}</span></div>
    </>
  );
}

function StackedTip({ x, group, value, color, total, widget }) {
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '–';
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {x} — {group}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(value)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share of {x}</span><span className="tt-value">{pct}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Total</span><span className="tt-value">{formatValue(total)}</span></div>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function drawGrid(g, axis, dir, offset) {
  g.append('g').attr('class', 'grid')
    .attr('transform', dir === 'x' ? `translate(0,0)` : `translate(0,${offset})`)
    .call(axis).call(a => a.select('.domain').remove())
    .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
}

function axisLabel(g, text, x, y, rotate) {
  g.append('text')
    .attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('font-family', 'var(--font)')
    .attr('text-anchor', 'middle')
    .attr('transform', rotate ? `translate(${y},${x}) rotate(-90)` : `translate(${x},${y})`)
    .text(text);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
