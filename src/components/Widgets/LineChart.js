import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getOrdinalWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick, makeValueScale, safeLog, drawTrendLine } from './chartHelpers';

const CURVES = {
  linear: d3.curveLinear,
  monotone: d3.curveMonotoneX,
  step: d3.curveStep,
  stepBefore: d3.curveStepBefore,
  stepAfter: d3.curveStepAfter,
  cardinal: d3.curveCardinal,
  basis: d3.curveBasis,
};

export default function LineChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const yField = widget.yField || widget.valueField;

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !yField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const stackMode = widget.stackMode || 'none';
    const hasMultiSeries = !!widget.colorField;

    if (hasMultiSeries && widget.showArea && stackMode !== 'none') {
      renderStacked(svgRef, data, widget, yField, dims, stackMode, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    } else {
      renderNormal(svgRef, data, widget, yField, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    }
  }, [data, widget, yField, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !yField) && <Placeholder text="Select X and Y fields" />}
    </div>
  );
}

/* ── Detect x-axis type ──────────────────────────────────────────────────── */
function detectXType(allX) {
  const isNum = allX.length > 0 && allX.every(v => typeof v === 'number' && !isNaN(v));
  const isDate = !isNum && allX.length > 0 && allX.every(v => !isNaN(Date.parse(String(v))));
  return { isNum, isDate };
}

/* ── Build aggregated series from raw data ───────────────────────────────
   Groups by (xField, colorField), aggregates yField values, then sorts
   each series by x-value so lines are drawn in order.
   Multi-measure mode: when lineChartMeasures is defined, each measure
   becomes its own series line (colorField is ignored). */
function buildSeries(data, widget, yField) {
  const extraMeasures = widget.lineChartMeasures?.filter(m => m.field) || [];
  const seriesMode = widget.seriesMode || (extraMeasures.length > 0 ? 'measures' : 'dimensions');
  const multiMeasure = seriesMode === 'measures' && extraMeasures.length > 0;

  const allXRaw = data.map(d => d[widget.xField]);
  const { isNum, isDate } = detectXType(allXRaw);

  // Helper: sort points by x
  const sortPts = (pts) => {
    if (isNum) pts.sort((a, b) => (+a.x) - (+b.x));
    else if (isDate) pts.sort((a, b) => new Date(a.x) - new Date(b.x));
    else {
      const orderMap = new Map();
      let idx = 0;
      for (const row of data) {
        const v = String(row[widget.xField]);
        if (!orderMap.has(v)) orderMap.set(v, idx++);
      }
      pts.sort((a, b) => (orderMap.get(String(a.x)) ?? 0) - (orderMap.get(String(b.x)) ?? 0));
    }
    return pts;
  };

  // Helper: aggregate one field into a series
  const buildOneSeries = (field, aggFn) => {
    const buckets = new Map();
    for (const row of data) {
      const xRaw = row[widget.xField];
      const mapKey = String(xRaw);
      if (!buckets.has(mapKey)) buckets.set(mapKey, { xRaw, yVals: [] });
      const isCount = aggFn === 'count';
      buckets.get(mapKey).yVals.push(isCount ? 1 : (+row[field] || 0));
    }
    const allYVals = widget.total ? data.map(r => +r[field] || 0) : null;
    const pts = [];
    for (const [, bucket] of buckets) {
      pts.push({ x: bucket.xRaw, y: aggregate(allYVals || bucket.yVals, aggFn, undefined, { distinct: widget.distinct }) });
    }
    return sortPts(pts);
  };

  const seriesMap = new Map();
  const seriesNames = [];
  // Per-series metadata (numberFormat, etc.)
  const seriesMeta = new Map();

  if (multiMeasure) {
    // Primary measure
    const primaryAgg = widget.aggregation || 'sum';
    const primaryLabel = widget.primaryMeasureLabel || `${yField} (${primaryAgg})`;
    seriesNames.push(primaryLabel);
    seriesMap.set(primaryLabel, buildOneSeries(yField, primaryAgg));
    seriesMeta.set(primaryLabel, { numberFormat: widget.numberFormat });

    // Additional measures
    for (const m of extraMeasures) {
      const agg = m.aggregation || 'sum';
      const label = m.label || `${m.field} (${agg})`;
      seriesNames.push(label);
      seriesMap.set(label, buildOneSeries(m.field, agg));
      seriesMeta.set(label, { numberFormat: m.numberFormat || widget.numberFormat });
    }
  } else {
    // Original colorField-based series mode
    const aggFn = widget.aggregation || 'sum';
    const buckets = new Map();
    const seriesSet = new Set();
    for (const row of data) {
      const sKey = widget.colorField ? String(row[widget.colorField] ?? '') : '__all__';
      const xRaw = row[widget.xField];
      seriesSet.add(sKey);
      const mapKey = `${sKey}\0${xRaw}`;
      if (!buckets.has(mapKey)) buckets.set(mapKey, { xRaw, yVals: [] });
      buckets.get(mapKey).yVals.push(+row[yField] || 0);
    }

    const names = [...seriesSet];
    const allYVals = widget.total ? data.map(r => +r[yField] || 0) : null;
    for (const sName of names) {
      const pts = [];
      for (const [key, bucket] of buckets) {
        if (!key.startsWith(sName + '\0')) continue;
        pts.push({ x: bucket.xRaw, y: aggregate(allYVals || bucket.yVals, aggFn, undefined, { distinct: widget.distinct }) });
      }
      seriesMap.set(sName, sortPts(pts));
      seriesNames.push(sName);
      seriesMeta.set(sName, { numberFormat: widget.numberFormat });
    }
  }

  // Sort categorical x-axis if sortBy is set (no-op for numeric/date)
  if (!isNum && !isDate && widget.sortBy && widget.sortBy !== 'original') {
    const xAggMap = new Map();
    for (const [, pts] of seriesMap) {
      for (const pt of pts) {
        const k = String(pt.x);
        xAggMap.set(k, (xAggMap.get(k) || 0) + pt.y);
      }
    }
    let sorted = [...xAggMap.entries()].map(([key, value]) => ({ key, value }));
    sorted = sortAggregated(sorted, {
      sortBy: widget.sortBy || 'original',
      sortOrder: widget.sortOrder || 'asc',
      customOrder: widget.customSortOrder,
    });
    const orderMap = new Map(sorted.map((d, i) => [d.key, i]));
    for (const [sName, pts] of seriesMap) {
      pts.sort((a, b) => (orderMap.get(String(a.x)) ?? 0) - (orderMap.get(String(b.x)) ?? 0));
      seriesMap.set(sName, pts);
    }
  }

  return { seriesMap, seriesNames, seriesMeta, isNum, isDate, multiMeasure };
}

/* ── Normal (non-stacked) line/area ──────────────────────────────────────── */
function renderNormal(svgRef, data, widget, yField, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 16, right: widget.showLegend ? 110 : 20, bottom: 52, left: 60 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  const { seriesMap, seriesNames, seriesMeta, isNum, isDate, multiMeasure } = buildSeries(data, widget, yField);
  const showPoints = widget.showPoints !== false; // default true
  const opacity = widget.opacity ?? 1;

  // Color scale
  let colors;
  if (widget.colorMode === 'gradient') {
    const totals = seriesNames.map(name => d3.sum(seriesMap.get(name), d => d.y));
    const ext = [Math.min(...totals), Math.max(...totals)];
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient, widget.logGradient);
    const totalMap = new Map(seriesNames.map((n, i) => [n, totals[i]]));
    colors = d => seq(totalMap.get(d) ?? 0);
  } else {
    colors = getColorScaleWithOverrides(widget.colorScheme, seriesNames, widget.dimensionColors);
  }

  // Collect all x and y values for scale domains
  const allPts = [...seriesMap.values()].flat();
  const allX = allPts.map(d => d.x);
  const allY = allPts.map(d => d.y);

  // X scale — default: equally spaced; option "linear" = proportional to value
  const useLinearSpacing = widget.xAxisSpacing === 'linear';
  let xScale;
  if (isDate) {
    xScale = d3.scaleTime().domain(d3.extent(allX.map(v => new Date(v)))).range([0, W]).nice();
  } else if (isNum && useLinearSpacing) {
    // Proportional spacing — scaleLinear
    xScale = d3.scaleLinear().domain(d3.extent(allX.map(Number))).range([0, W]).nice();
  } else if (useLinearSpacing && allX.every(v => !isNaN(+v))) {
    // Non-numeric detected but values are parseable as numbers + user wants linear
    xScale = d3.scaleLinear().domain(d3.extent(allX.map(Number))).range([0, W]).nice();
  } else {
    // Default: equally spaced (scalePoint)
    const uniqueX = [...new Set(allX.map(String))];
    if (isNum) uniqueX.sort((a, b) => +a - +b);
    xScale = d3.scalePoint().domain(uniqueX).range([0, W]).padding(0.1);
  }

  // Y scale
  const useLog = !!widget.useLogScale;
  const yDomain = [useLog ? Math.max(1, d3.min(allY)) : Math.min(0, d3.min(allY)), d3.max(allY) * 1.08];
  const yScale = makeValueScale(useLog, yDomain, [H, 0]);

  // Curve and generators
  const curve = CURVES[widget.curveType] || CURVES[widget.lineType] || d3.curveLinear;
  const isLinearScale = xScale.invert !== undefined; // linear/time scales have invert, point doesn't
  const xPos = d => (isDate ? xScale(new Date(d.x)) : isLinearScale ? xScale(+d.x) : xScale(String(d.x)));
  const lineGen = d3.line().x(xPos).y(d => yScale(d.y)).curve(curve).defined(d => !isNaN(d.y));
  const areaGen = d3.area().x(xPos).y0(H).y1(d => yScale(d.y)).curve(curve).defined(d => !isNaN(d.y));

  // SVG setup
  const svg = d3.select(svgRef.current);
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
  const defs = svg.append('defs');

  // Grid
  if (widget.showGrid) {
    g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
      .call(a => a.select('.domain').remove())
      .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
  }

  // Axes
  g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6))
    .call(styledAxis).selectAll('text').attr('dy', '1em')
    .attr('transform', isDate ? '' : 'rotate(-30)').style('text-anchor', isDate ? 'middle' : 'end');
  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

  // Draw each series
  seriesNames.forEach((name, si) => {
    const color = colors(name);
    const pts = seriesMap.get(name);

    // Area fill (gradient under the line)
    if (widget.showArea) {
      const gradId = `area-grad-${si}`;
      const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.22);
      grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
      g.append('path').datum(pts).attr('fill', `url(#${gradId})`).attr('d', areaGen);
    }

    // Line with animated draw
    const path = g.append('path').datum(pts)
      .attr('fill', 'none').attr('stroke', color)
      .attr('stroke-width', 2.5).attr('opacity', opacity).attr('d', lineGen);
    const len = path.node()?.getTotalLength() || 0;
    path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
      .transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

    // Data points
    if (showPoints) {
      g.selectAll(`.pt-${si}`).data(pts.filter(d => !isNaN(d.y))).join('circle')
        .attr('class', `pt-${si}`)
        .attr('cx', xPos).attr('cy', d => yScale(d.y))
        .attr('r', 0).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', opacity)
        .transition().delay(600).duration(200).attr('r', 4);
    }
  });

  // Trend lines (linear, polynomial, logarithmic, exponential)
  const showReg = widget.showRegression || widget.showTrendLine;
  if (showReg) {
    const trendType = widget.regressionType || 'linear';
    const trendDegree = widget.polynomialDegree || 2;

    // Clip rect so trend lines don't overflow the chart area
    const clipId = `line-trend-clip-${Math.random().toString(36).slice(2, 8)}`;
    defs.append('clipPath').attr('id', clipId)
      .append('rect').attr('width', W).attr('height', H);

    seriesNames.forEach((name) => {
      const color = colors(name);
      const raw = seriesMap.get(name).filter(d => !isNaN(d.y));
      if (raw.length < 2) return;

      // Build numeric points: use actual x if numeric, else sequential index
      let regPts;
      if (isNum) {
        regPts = raw.filter(d => !isNaN(+d.x)).map(d => ({ x: +d.x, y: d.y }));
      } else {
        regPts = raw.map((d, i) => ({ x: i, y: d.y }));
      }
      if (regPts.length < 2) return;

      const xExt = d3.extent(regPts, d => d.x);

      // Map regression x back to pixel position
      const regXToPixel = (rx) => {
        if (isNum) return xScale(rx);
        const idx = rx;
        const floor = Math.max(0, Math.min(Math.floor(idx), raw.length - 1));
        const ceil = Math.min(floor + 1, raw.length - 1);
        const frac = idx - floor;
        const ptXPos = d => isDate ? xScale(new Date(d.x)) : isLinearScale ? xScale(+d.x) : xScale(String(d.x));
        return ptXPos(raw[floor]) * (1 - frac) + ptXPos(raw[ceil]) * frac;
      };

      drawTrendLine(g, regPts, regXToPixel, yScale, xExt, trendType, trendDegree, color, clipId);
    });
  }

  // Legend
  if (widget.showLegend && (widget.colorField || multiMeasure) && seriesNames.length > 1) {
    const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
    seriesNames.slice(0, 10).forEach((name, i) => {
      const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
      row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
        .attr('stroke', colors(name)).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
      row.append('text').attr('x', 18).attr('y', 10.5)
        .attr('font-size', 10.5).attr('font-family', 'var(--font)').attr('fill', 'var(--text-muted)')
        .text(name.length > 13 ? name.slice(0, 13) + '\u2026' : name);
    });
  }

  // X-axis label
  g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
    .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 46).text(widget.xField);

  // Hover overlay
  addHoverOverlay(g, svg, widget, yField, seriesMap, seriesNames, seriesMeta, colors, xScale, yScale, isNum, isDate, multiMeasure, W, H, m, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
}

/* ── Stacked area line chart ─────────────────────────────────────────────── */
function renderStacked(svgRef, data, widget, yField, dims, stackMode, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 16, right: widget.showLegend ? 110 : 20, bottom: 52, left: 60 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  const opacity = widget.opacity ?? 1;
  const curve = CURVES[widget.curveType] || CURVES[widget.lineType] || d3.curveLinear;
  const aggFn = widget.aggregation || 'sum';

  // Pivot data: aggregate by (xField, colorField) into a matrix
  const buckets = new Map(); // key: "xRaw\0seriesKey" → [yVals]
  const seriesSet = new Set();
  for (const row of data) {
    const xRaw = row[widget.xField];
    const sKey = String(row[widget.colorField] ?? '');
    seriesSet.add(sKey);
    const mapKey = `${xRaw}\0${sKey}`;
    if (!buckets.has(mapKey)) buckets.set(mapKey, []);
    buckets.get(mapKey).push(+row[yField] || 0);
  }
  const seriesKeys = [...seriesSet];

  // Get unique sorted X values
  const allXRaw = data.map(d => d[widget.xField]);
  const { isNum, isDate } = detectXType(allXRaw);

  // Deduplicate and sort x values
  const xSet = new Map(); // canonical string → raw value
  for (const v of allXRaw) {
    const key = isDate ? new Date(v).getTime() : isNum ? +v : String(v);
    if (!xSet.has(key)) xSet.set(key, v);
  }
  let xEntries = [...xSet.entries()]; // [canonicalKey, rawValue]
  if (isNum || isDate) xEntries.sort((a, b) => a[0] - b[0]);

  // Build pivot rows
  const pivotData = xEntries.map(([, xRaw]) => {
    const row = { __x: isDate ? new Date(xRaw).getTime() : isNum ? +xRaw : String(xRaw), __xRaw: xRaw };
    for (const sk of seriesKeys) {
      const mapKey = `${xRaw}\0${sk}`;
      const vals = buckets.get(mapKey);
      row[sk] = vals ? aggregate(vals, aggFn, undefined, { distinct: widget.distinct }) : 0;
    }
    return row;
  });

  const stack = d3.stack().keys(seriesKeys)
    .offset(stackMode === 'percent' ? d3.stackOffsetExpand : d3.stackOffsetNone);
  const stacked = stack(pivotData);

  // Scales
  const xVals = pivotData.map(d => d.__x);
  let xScale;
  if (isNum) xScale = d3.scaleLinear().domain(d3.extent(xVals)).range([0, W]).nice();
  else if (isDate) xScale = d3.scaleTime().domain(d3.extent(xVals.map(v => new Date(v)))).range([0, W]).nice();
  else xScale = d3.scalePoint().domain(xVals).range([0, W]).padding(0.1);

  const yMax = stackMode === 'percent' ? 1 : d3.max(stacked, layer => d3.max(layer, d => d[1])) * 1.05 || 1;
  const useLog = !!widget.useLogScale;
  const yScale = makeValueScale(useLog, [useLog ? 1 : 0, yMax], [H, 0]);

  // Colors
  let colorScale;
  if (widget.colorMode === 'gradient') {
    const totals = seriesKeys.map(k => d3.sum(pivotData, d => d[k] || 0));
    const ext = [Math.min(...totals), Math.max(...totals)];
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient, widget.logGradient);
    const totalMap = new Map(seriesKeys.map((k, i) => [k, totals[i]]));
    colorScale = d => seq(totalMap.get(d) ?? 0);
  } else {
    colorScale = getOrdinalWithOverrides(widget.colorScheme, seriesKeys, widget.dimensionColors);
  }

  // SVG setup
  const svg = d3.select(svgRef.current);
  svg.selectAll('*').remove();
  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  // Grid
  if (widget.showGrid) {
    g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
      .call(a => a.select('.domain').remove())
      .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
  }

  // X accessor for stacked data
  const xAccessor = d => isDate ? xScale(new Date(d.data.__x)) : isNum ? xScale(d.data.__x) : xScale(d.data.__x);

  // Axes
  g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6)).call(styledAxis);
  const yFmt = stackMode === 'percent' ? d3.format('.0%') : fmtTick;
  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(yFmt)).call(styledAxis);

  // Generators
  const areaGen = d3.area()
    .x(xAccessor)
    .y0(d => yScale(d[0]))
    .y1(d => yScale(d[1]))
    .curve(curve);

  const lineGen = d3.line()
    .x(xAccessor)
    .y(d => yScale(d[1]))
    .curve(curve);

  // Draw stacked layers
  stacked.forEach((layer) => {
    g.append('path').datum(layer)
      .attr('fill', colorScale(layer.key)).attr('opacity', opacity * 0.5)
      .attr('d', areaGen);
    g.append('path').datum(layer)
      .attr('fill', 'none').attr('stroke', colorScale(layer.key))
      .attr('stroke-width', 2).attr('opacity', opacity)
      .attr('d', lineGen);
  });

  // Legend
  if (widget.showLegend && seriesKeys.length > 1) {
    const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
    seriesKeys.slice(0, 10).forEach((name, i) => {
      const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
      row.append('rect').attr('width', 12).attr('height', 12).attr('rx', 2).attr('fill', colorScale(name)).attr('opacity', 0.7);
      row.append('text').attr('x', 16).attr('y', 10)
        .attr('font-size', 10.5).attr('font-family', 'var(--font)').attr('fill', 'var(--text-muted)')
        .text(name.length > 13 ? name.slice(0, 13) + '\u2026' : name);
    });
  }

  // X-axis label
  g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
    .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 46).text(widget.xField);
}

/* ── Hover overlay for normal line chart ─────────────────────────────────── */
function addHoverOverlay(g, svg, widget, yField, seriesMap, seriesNames, seriesMeta, colors, xScale, yScale, isNum, isDate, multiMeasure, W, H, m, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  // Collect all unique sorted x values across series
  const allPts = [...seriesMap.values()].flat();
  const hasInvert = !!xScale.invert; // linear/time have invert, point does not
  const sortedXs = hasInvert
    ? [...new Set(allPts.map(v => isDate ? new Date(v.x).getTime() : +v.x))].sort((a, b) => a - b)
    : [...new Set(allPts.map(d => String(d.x)))];

  const focusLine = g.append('line').attr('y1', 0).attr('y2', H)
    .attr('stroke', 'var(--chart-axis-color)').attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,3').style('display', 'none').style('pointer-events', 'none');

  const focusDots = seriesNames.map(name => {
    const dot = g.append('circle').attr('r', 5).attr('stroke', '#fff').attr('stroke-width', 2)
      .attr('fill', colors(name)).style('display', 'none').style('pointer-events', 'none');
    return { name, dot };
  });

  const findClosestX = (mx) => {
    if (hasInvert) {
      const xVal = isDate ? xScale.invert(mx).getTime() : xScale.invert(mx);
      const bisect = d3.bisectCenter(sortedXs, xVal);
      return sortedXs[Math.max(0, Math.min(sortedXs.length - 1, bisect))];
    } else {
      // scalePoint: find closest domain value
      const domain = xScale.domain();
      let closest = domain[0], minDist = Infinity;
      for (const v of domain) {
        const dist = Math.abs(xScale(v) - mx);
        if (dist < minDist) { minDist = dist; closest = v; }
      }
      return closest;
    }
  };

  svg.append('rect')
    .attr('width', W).attr('height', H)
    .attr('transform', `translate(${m.left},${m.top})`)
    .attr('fill', 'none').attr('pointer-events', 'all')
    .on('click', (ev) => {
      if (!onCrossFilter) return;
      const [mx] = d3.pointer(ev, g.node());
      const closestX = findClosestX(mx);
      const xValue = isDate ? new Date(closestX) : closestX;
      onCrossFilter({ field: widget.xField, value: xValue });
    })
    .on('mousemove', (ev) => {
      const [mx] = d3.pointer(ev, g.node());
      const closestX = findClosestX(mx);

      const cx = isDate ? xScale(new Date(closestX)) : hasInvert ? xScale(closestX) : xScale(String(closestX));
      focusLine.style('display', null).attr('transform', `translate(${cx},0)`);

      const vals = seriesNames.map(name => {
        const pts = seriesMap.get(name);
        const pt = hasInvert
          ? pts.reduce((best, p) => {
              const pv = isDate ? new Date(p.x).getTime() : +p.x;
              const bv = isDate ? new Date(best.x).getTime() : +best.x;
              return Math.abs(pv - closestX) < Math.abs(bv - closestX) ? p : best;
            }, pts[0])
          : pts.find(p => String(p.x) === String(closestX));
        if (pt) focusDots.find(d => d.name === name)?.dot.style('display', null).attr('cx', cx).attr('cy', yScale(pt.y));
        const meta = seriesMeta?.get(name);
        return { name, value: pt?.y, format: meta?.numberFormat || widget.numberFormat };
      }).filter(s => s.value !== undefined);

      const xLabel = isDate ? new Date(closestX).toLocaleDateString() : String(closestX);
      showTooltip(ev, <LineTip xLabel={xLabel} vals={vals} colors={colors} widget={widget} yField={yField} multiMeasure={multiMeasure} />);
      moveTooltip(ev);
    })
    .on('mouseleave', () => {
      focusLine.style('display', 'none');
      focusDots.forEach(d => d.dot.style('display', 'none'));
      hideTooltip();
    });
}

/* ── Tooltip component ───────────────────────────────────────────────────── */
function LineTip({ xLabel, vals, colors, widget, yField, multiMeasure }) {
  return (
    <>
      <div className="chart-tooltip-title">{xLabel}</div>
      {vals.map(s => (
        <div key={s.name} className="chart-tooltip-row">
          <span className="tt-dot" style={{ background: colors(s.name) }} />
          <span className="tt-label">{s.name === '__all__' ? (yField || widget.yField) : s.name}</span>
          <span className="tt-value">{formatValue(s.value, s.format || widget.numberFormat)}</span>
        </div>
      ))}
      {vals.length > 1 && !multiMeasure && (
        <div className="chart-tooltip-stat">
          {'\u03A3'} {formatValue(vals.reduce((s, v) => s + (v.value || 0), 0), widget.numberFormat)}
        </div>
      )}
    </>
  );
}
