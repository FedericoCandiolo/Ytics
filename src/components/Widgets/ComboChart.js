import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getPrimaryColor, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function ComboChart({ widget, data, onCrossFilter }) {
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
    renderCombo(svgRef, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select X, Y (bars) and Y2 (line) fields" />}
    </div>
  );
}

// ── Main render ────────────────────────────────────────────────────────────────
function renderCombo(svgRef, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const dualAxis = widget.dualAxis !== false;
  const comboType = widget.comboType || 'barLine';
  const opacity = widget.opacity ?? 1;
  const hasY2 = !!widget.y2Field;

  const m = { top: 20, right: dualAxis && hasY2 ? 60 : 20, bottom: 70, left: 58 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  // ── Aggregate primary (yField) per xField ──────────────────────────────────
  const hasGroup = !!widget.groupField;
  const yAgg = widget.aggregation || 'sum';
  const y2Agg = widget.y2Aggregation || 'sum';

  const xGroups = new Map();
  for (const row of data) {
    const xKey = String(row[widget.xField] ?? '(blank)');
    if (!xGroups.has(xKey)) xGroups.set(xKey, []);
    xGroups.get(xKey).push(row);
  }

  let xKeys = Array.from(xGroups.keys());

  // Sort x-axis categories if sortBy is set
  if (widget.sortBy && widget.sortBy !== 'original') {
    let sorted = xKeys.map(key => {
      const vals = xGroups.get(key).map(r => +r[widget.yField] || 0);
      return { key, value: aggregate(vals, yAgg, undefined, { distinct: widget.distinct }) };
    });
    sorted = sortAggregated(sorted, {
      sortBy: widget.sortBy || 'original',
      sortOrder: widget.sortOrder || 'asc',
      customOrder: widget.customSortOrder,
    });
    xKeys = sorted.map(d => d.key);
  }

  // Primary data (bars or first line)
  let barData;
  if (hasGroup) {
    // Grouped bars: pivot by (xField, groupField)
    const groupSet = new Set();
    const pivotMap = new Map();
    for (const row of data) {
      const xKey = String(row[widget.xField] ?? '(blank)');
      const gKey = String(row[widget.groupField] ?? '(blank)');
      groupSet.add(gKey);
      const mapKey = `${xKey}|||${gKey}`;
      if (!pivotMap.has(mapKey)) pivotMap.set(mapKey, []);
      pivotMap.get(mapKey).push(+row[widget.yField] || 0);
    }
    const groupKeys = [...groupSet];
    barData = { grouped: true, groupKeys, pivotMap, xKeys };
  } else {
    barData = {
      grouped: false,
      pts: xKeys.map(key => {
        const vals = xGroups.get(key).map(r => +r[widget.yField] || 0);
        return { key, value: aggregate(vals, yAgg, undefined, { distinct: widget.distinct }) };
      }),
    };
  }

  // Secondary data (y2Field — line or second line)
  let linePts = [];
  let lineSeriesMap = new Map();
  if (hasY2) {
    const hasColorField = !!widget.colorField;
    if (hasColorField) {
      // Multiple line series
      for (const row of data) {
        const xKey = String(row[widget.xField] ?? '(blank)');
        const sKey = String(row[widget.colorField] ?? '(blank)');
        if (!lineSeriesMap.has(sKey)) lineSeriesMap.set(sKey, new Map());
        const sMap = lineSeriesMap.get(sKey);
        if (!sMap.has(xKey)) sMap.set(xKey, []);
        sMap.get(xKey).push(+row[widget.y2Field] || 0);
      }
      // Aggregate each series per xKey
      for (const [sKey, sMap] of lineSeriesMap) {
        const pts = xKeys.map(xKey => ({
          key: xKey,
          value: sMap.has(xKey) ? aggregate(sMap.get(xKey), y2Agg, undefined, { distinct: widget.distinct }) : null,
        })).filter(d => d.value !== null);
        lineSeriesMap.set(sKey, pts);
      }
    } else {
      linePts = xKeys.map(key => {
        const vals = xGroups.get(key).map(r => +r[widget.y2Field] || 0);
        return { key, value: aggregate(vals, y2Agg, undefined, { distinct: widget.distinct }) };
      });
    }
  }

  // ── Scales ─────────────────────────────────────────────────────────────────
  const xScale = d3.scaleBand().domain(xKeys).range([0, W]).padding(0.22);

  // Y scale (primary)
  let yMax;
  if (barData.grouped) {
    const { groupKeys, pivotMap } = barData;
    yMax = d3.max(xKeys, xKey =>
      d3.max(groupKeys, gKey => {
        const vals = pivotMap.get(`${xKey}|||${gKey}`);
        return vals ? aggregate(vals, yAgg, undefined, { distinct: widget.distinct }) : 0;
      })
    ) * 1.05 || 1;
  } else {
    yMax = d3.max(barData.pts, d => d.value) * 1.05 || 1;
  }
  const yScale = d3.scaleLinear().domain([0, yMax]).range([H, 0]).nice();

  // Y2 scale (secondary)
  let y2Scale;
  if (hasY2) {
    let y2Max;
    if (lineSeriesMap.size > 0) {
      y2Max = d3.max([...lineSeriesMap.values()].flat(), d => d.value) * 1.08 || 1;
    } else {
      y2Max = d3.max(linePts, d => d.value) * 1.08 || 1;
    }
    if (dualAxis) {
      y2Scale = d3.scaleLinear().domain([0, y2Max]).range([H, 0]).nice();
    } else {
      // Shared axis — extend yScale to cover both
      const combinedMax = Math.max(yMax, y2Max * 1.05);
      yScale.domain([0, combinedMax]).nice();
      y2Scale = yScale;
    }
  }

  // ── Color setup ────────────────────────────────────────────────────────────
  const palette = widget.colorScheme || 'vivid';
  let barColors;
  if (barData.grouped) {
    barColors = getColorScaleWithOverrides(palette, barData.groupKeys, widget.dimensionColors);
  } else {
    if (widget.colorMode === 'gradient') {
      const colorVals = barData.pts.map(d => d.value);
      const ext = [Math.min(...colorVals), Math.max(...colorVals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
      barColors = d => seq(barData.pts.find(p => p.key === d)?.value ?? 0);
    } else {
      barColors = getColorScaleWithOverrides(palette, xKeys, widget.dimensionColors);
    }
  }

  // Line colors — use a contrasting color or second palette color
  let lineColor;
  let lineSeriesColors;
  if (lineSeriesMap.size > 0) {
    const seriesNames = [...lineSeriesMap.keys()];
    lineSeriesColors = getColorScaleWithOverrides(palette, seriesNames, widget.dimensionColors);
  } else {
    // Single line — pick a contrasting color (second palette entry)
    const primaryCol = getPrimaryColor(palette);
    const secondaryColors = getColorScaleWithOverrides(palette, ['__bar__', '__line__'], {});
    lineColor = secondaryColors('__line__');
    // If it looks too similar, darken it
    if (lineColor === primaryCol) {
      lineColor = d3.color(primaryCol).darker(1.2).formatHex();
    }
  }

  // ── SVG setup ──────────────────────────────────────────────────────────────
  const svg = d3.select(svgRef.current);
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);
  const defs = svg.append('defs');
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  // ── Grid (from left axis only) ─────────────────────────────────────────────
  if (widget.showGrid) {
    g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
      .call(a => a.select('.domain').remove())
      .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
  }

  // ── X axis ─────────────────────────────────────────────────────────────────
  g.append('g').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10)))
    .call(styledAxis)
    .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');

  // ── Left Y axis ────────────────────────────────────────────────────────────
  const leftAxisColor = dualAxis && hasY2 ? (barData.grouped ? 'var(--chart-axis-color)' : barColors(xKeys[0])) : 'var(--chart-axis-color)';
  const yTickFmt = widget.numberFormat ? v => formatValue(v, widget.numberFormat) : fmtTick;
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(yTickFmt))
    .call(styledAxis)
    .call(a => {
      if (dualAxis && hasY2) a.selectAll('text').attr('fill', leftAxisColor);
    });

  // ── Right Y axis (dual axis) ──────────────────────────────────────────────
  if (dualAxis && hasY2) {
    const rightAxisColor = lineSeriesColors ? 'var(--chart-axis-color)' : lineColor;
    const y2TickFmt = widget.y2NumberFormat ? v => formatValue(v, widget.y2NumberFormat) : (widget.numberFormat ? v => formatValue(v, widget.numberFormat) : fmtTick);
    g.append('g')
      .attr('transform', `translate(${W},0)`)
      .call(d3.axisRight(y2Scale).ticks(5).tickFormat(y2TickFmt))
      .call(styledAxis)
      .call(a => a.selectAll('text').attr('fill', rightAxisColor));
  }

  // ── Render bars (or first set of lines in lineLine mode) ───────────────────
  if (comboType === 'barLine') {
    if (barData.grouped) {
      renderGroupedBars(g, barData, xScale, yScale, yAgg, barColors, opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter, H);
    } else {
      renderBars(g, barData.pts, xScale, yScale, barColors, opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter, H, defs);
    }
  } else {
    // lineLine mode — render yField as a line too
    const primaryPts = barData.grouped ? [] : barData.pts;
    if (primaryPts.length) {
      const pColor = getPrimaryColor(palette);
      renderLine(g, defs, primaryPts, xScale, yScale, pColor, opacity, widget, 0);
    }
  }

  // ── Render line (y2Field) ──────────────────────────────────────────────────
  if (hasY2) {
    if (lineSeriesMap.size > 0) {
      let si = 0;
      for (const [sKey, pts] of lineSeriesMap) {
        renderLine(g, defs, pts, xScale, y2Scale, lineSeriesColors(sKey), opacity, widget, si + 1);
        si++;
      }
    } else if (linePts.length) {
      renderLine(g, defs, linePts, xScale, y2Scale, lineColor, opacity, widget, 1);
    }
  }

  // ── Legend ─────────────────────────────────────────────────────────────────
  const legendItems = [];
  if (comboType === 'barLine') {
    legendItems.push({ label: widget.yField, type: 'bar', color: barData.grouped ? null : barColors(xKeys[0]) });
  } else {
    legendItems.push({ label: widget.yField, type: 'line', color: getPrimaryColor(palette) });
  }
  if (hasY2) {
    if (lineSeriesMap.size > 0) {
      for (const sKey of lineSeriesMap.keys()) {
        legendItems.push({ label: sKey, type: 'line', color: lineSeriesColors(sKey) });
      }
    } else {
      legendItems.push({ label: widget.y2Field, type: 'line', color: lineColor });
    }
  }

  if (legendItems.length > 1) {
    const leg = g.append('g').attr('transform', `translate(0, ${-14})`);
    let cx = 0;
    legendItems.slice(0, 10).forEach((item) => {
      const itemG = leg.append('g').attr('transform', `translate(${cx}, 0)`);
      if (item.type === 'bar') {
        itemG.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2)
          .attr('fill', item.color || 'var(--chart-axis-color)');
      } else {
        itemG.append('line').attr('x1', 0).attr('y1', 5).attr('x2', 14).attr('y2', 5)
          .attr('stroke', item.color).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
        itemG.append('circle').attr('cx', 7).attr('cy', 5).attr('r', 2.5).attr('fill', item.color);
      }
      itemG.append('text').attr('x', item.type === 'bar' ? 14 : 18).attr('y', 9)
        .attr('font-size', 10).attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
        .text(truncate(item.label, 14));
      cx += Math.max(item.label.length * 7 + 24, 60);
    });
  }

  // ── Axis labels ────────────────────────────────────────────────────────────
  g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
    .attr('text-anchor', 'middle').attr('font-family', 'var(--font)')
    .attr('x', W / 2).attr('y', H + 56).text(widget.xField);

  g.append('text').attr('fill', leftAxisColor).attr('font-size', 11)
    .attr('text-anchor', 'middle').attr('font-family', 'var(--font)')
    .attr('transform', `translate(${-46},${H / 2}) rotate(-90)`).text(widget.yField);

  if (dualAxis && hasY2) {
    const rightAxisColor = lineSeriesColors ? 'var(--chart-axis-color)' : lineColor;
    g.append('text').attr('fill', rightAxisColor).attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('font-family', 'var(--font)')
      .attr('transform', `translate(${W + 46},${H / 2}) rotate(90)`).text(widget.y2Field);
  }

  // ── Hover overlay ─────────────────────────────────────────────────────────
  addHoverOverlay(g, svg, xKeys, xScale, yScale, y2Scale, barData, linePts, lineSeriesMap,
    barColors, lineColor, lineSeriesColors, widget, W, H, m, comboType, dualAxis,
    showTooltip, moveTooltip, hideTooltip, onCrossFilter, yAgg, y2Agg);
}

// ── Render simple bars ──────────────────────────────────────────────────────
function renderBars(g, pts, xScale, yScale, colors, opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter, H, defs) {
  const total = pts.reduce((s, p) => s + p.value, 0);

  // Gradient fill support
  if (widget.colorMode === 'gradient') {
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const ext = [Math.min(...pts.map(d => d.value)), Math.max(...pts.map(d => d.value))];
    const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
    g.selectAll('.combo-bar').data(pts).join('rect').attr('class', 'combo-bar')
      .attr('x', d => xScale(d.key)).attr('y', H).attr('width', xScale.bandwidth()).attr('height', 0)
      .attr('fill', d => seq(d.value)).attr('opacity', opacity).attr('rx', 4)
      .on('mouseover', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', 1); showTooltip(ev, <BarTip d={d} widget={widget} color={seq(d.value)} total={total} />); })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null)
      .transition().duration(500).ease(d3.easeCubicOut).attr('y', d => yScale(d.value)).attr('height', d => H - yScale(d.value));
    return;
  }

  g.selectAll('.combo-bar').data(pts).join('rect').attr('class', 'combo-bar')
    .attr('x', d => xScale(d.key)).attr('y', H).attr('width', xScale.bandwidth()).attr('height', 0)
    .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 4)
    .on('mouseover', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', 1); showTooltip(ev, <BarTip d={d} widget={widget} color={colors(d.key)} total={total} />); })
    .on('mousemove', moveTooltip)
    .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
    .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
    .style('cursor', onCrossFilter ? 'pointer' : null)
    .transition().duration(500).ease(d3.easeCubicOut).attr('y', d => yScale(d.value)).attr('height', d => H - yScale(d.value));
}

// ── Render grouped bars ─────────────────────────────────────────────────────
function renderGroupedBars(g, barData, xScale, yScale, yAgg, colors, opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter, H) {
  const { groupKeys, pivotMap, xKeys } = barData;
  const xInner = d3.scaleBand().domain(groupKeys).range([0, xScale.bandwidth()]).padding(0.05);

  xKeys.forEach(xKey => {
    groupKeys.forEach(gKey => {
      const vals = pivotMap.get(`${xKey}|||${gKey}`);
      const value = vals ? aggregate(vals, yAgg, undefined, { distinct: widget.distinct }) : 0;
      g.append('rect')
        .attr('x', xScale(xKey) + xInner(gKey)).attr('y', H)
        .attr('width', xInner.bandwidth()).attr('height', 0)
        .attr('fill', colors(gKey)).attr('opacity', opacity).attr('rx', 2)
        .on('mouseover', (ev) => {
          d3.select(ev.currentTarget).attr('opacity', 1);
          showTooltip(ev, <GroupedBarTip x={xKey} group={gKey} value={value} color={colors(gKey)} widget={widget} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
        .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: xKey }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null)
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('y', yScale(value)).attr('height', H - yScale(value));
    });
  });
}

// ── Render a line with optional points ──────────────────────────────────────
function renderLine(g, defs, pts, xScale, yScale, color, opacity, widget, seriesIdx) {
  const lineGen = d3.line()
    .x(d => xScale(d.key) + xScale.bandwidth() / 2)
    .y(d => yScale(d.value))
    .curve(d3.curveMonotoneX)
    .defined(d => d.value !== null && !isNaN(d.value));

  // Area gradient
  if (widget.showArea) {
    const H = yScale.range()[0];
    const gradId = `combo-area-grad-${seriesIdx}`;
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.18);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
    const areaGen = d3.area()
      .x(d => xScale(d.key) + xScale.bandwidth() / 2)
      .y0(H).y1(d => yScale(d.value))
      .curve(d3.curveMonotoneX)
      .defined(d => d.value !== null && !isNaN(d.value));
    g.append('path').datum(pts).attr('fill', `url(#${gradId})`).attr('d', areaGen);
  }

  const path = g.append('path').datum(pts)
    .attr('fill', 'none').attr('stroke', color)
    .attr('stroke-width', 2.5).attr('opacity', opacity).attr('d', lineGen);
  const len = path.node()?.getTotalLength() || 0;
  path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
    .transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

  // Points
  g.selectAll(`.combo-pt-${seriesIdx}`).data(pts.filter(d => d.value !== null && !isNaN(d.value))).join('circle')
    .attr('class', `combo-pt-${seriesIdx}`)
    .attr('cx', d => xScale(d.key) + xScale.bandwidth() / 2)
    .attr('cy', d => yScale(d.value))
    .attr('r', 0).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', opacity)
    .transition().delay(600).duration(200).attr('r', 4);
}

// ── Hover overlay ───────────────────────────────────────────────────────────
function addHoverOverlay(g, svg, xKeys, xScale, yScale, y2Scale, barData, linePts, lineSeriesMap,
  barColors, lineColor, lineSeriesColors, widget, W, H, m, comboType, dualAxis,
  showTooltip, moveTooltip, hideTooltip, onCrossFilter, yAgg, y2Agg) {

  const focusLine = g.append('line').attr('y1', 0).attr('y2', H)
    .attr('stroke', 'var(--chart-axis-color)').attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,3').style('display', 'none').style('pointer-events', 'none');

  const findClosestX = (mx) => {
    const bandW = xScale.bandwidth();
    let closest = xKeys[0];
    let minDist = Infinity;
    for (const key of xKeys) {
      const cx = xScale(key) + bandW / 2;
      const dist = Math.abs(mx - cx);
      if (dist < minDist) { minDist = dist; closest = key; }
    }
    return closest;
  };

  svg.append('rect')
    .attr('width', W).attr('height', H)
    .attr('transform', `translate(${m.left},${m.top})`)
    .attr('fill', 'none').attr('pointer-events', 'all')
    .on('click', (ev) => {
      if (!onCrossFilter) return;
      const [mx] = d3.pointer(ev, g.node());
      const xKey = findClosestX(mx);
      onCrossFilter({ field: widget.xField, value: xKey });
    })
    .on('mousemove', (ev) => {
      const [mx] = d3.pointer(ev, g.node());
      const xKey = findClosestX(mx);
      const cx = xScale(xKey) + xScale.bandwidth() / 2;
      focusLine.style('display', null).attr('transform', `translate(${cx},0)`);

      // Build tooltip values
      const vals = [];

      // Primary value
      const yFmt = widget.numberFormat;
      const y2Fmt = widget.y2NumberFormat || widget.numberFormat;
      if (barData.grouped) {
        const { groupKeys, pivotMap } = barData;
        for (const gKey of groupKeys) {
          const rawVals = pivotMap.get(`${xKey}|||${gKey}`);
          const value = rawVals ? aggregate(rawVals, yAgg, undefined, { distinct: widget.distinct }) : 0;
          vals.push({
            label: `${widget.yField} (${gKey})`,
            value,
            color: barColors(gKey),
            type: comboType === 'barLine' ? 'bar' : 'line',
            format: yFmt,
          });
        }
      } else {
        const pt = barData.pts?.find(d => d.key === xKey);
        vals.push({
          label: widget.yField,
          value: pt?.value ?? 0,
          color: comboType === 'barLine' ? barColors(xKey) : getPrimaryColor(widget.colorScheme || 'vivid'),
          type: comboType === 'barLine' ? 'bar' : 'line',
          format: yFmt,
        });
      }

      // Secondary value(s)
      if (widget.y2Field) {
        if (lineSeriesMap.size > 0) {
          for (const [sKey, pts] of lineSeriesMap) {
            const pt = pts.find(d => d.key === xKey);
            vals.push({ label: `${widget.y2Field} (${sKey})`, value: pt?.value ?? 0, color: lineSeriesColors(sKey), type: 'line', format: y2Fmt });
          }
        } else {
          const pt = linePts.find(d => d.key === xKey);
          vals.push({ label: widget.y2Field, value: pt?.value ?? 0, color: lineColor, type: 'line', format: y2Fmt });
        }
      }

      showTooltip(ev, <ComboTip xLabel={xKey} vals={vals} widget={widget} />);
      moveTooltip(ev);
    })
    .on('mouseleave', () => {
      focusLine.style('display', 'none');
      hideTooltip();
    });
}

// ── Tooltips ────────────────────────────────────────────────────────────────
function BarTip({ d, widget, color, total }) {
  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '-';
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(d.value, widget.numberFormat)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share</span><span className="tt-value">{pct}%</span></div>
    </>
  );
}

function GroupedBarTip({ x, group, value, color, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {x} - {group}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(value, widget.numberFormat)}</span></div>
    </>
  );
}

function ComboTip({ xLabel, vals }) {
  return (
    <>
      <div className="chart-tooltip-title">{xLabel}</div>
      {vals.map((v, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="tt-dot" style={{ background: v.color }} />
          <span className="tt-label">{v.label}</span>
          <span className="tt-value">{formatValue(v.value, v.format)}</span>
        </div>
      ))}
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; }
