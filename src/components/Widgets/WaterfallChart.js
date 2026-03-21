import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorArray, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function WaterfallChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const isCandlestick = !!(widget.openField && widget.highField && widget.lowField && widget.closeField);

    if (isCandlestick) {
      if (!data?.length || !widget.xField || w < 20 || h < 20) return;
      renderCandlestick(svg, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    } else {
      if (!data?.length || !widget.xField || !widget.valueField || w < 20 || h < 20) return;
      renderWaterfall(svg, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter);
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  const isCandlestick = !!(widget.openField && widget.highField && widget.lowField && widget.closeField);
  const placeholderText = isCandlestick
    ? (!widget.xField ? 'Select X field and OHLC fields' : null)
    : (!widget.xField || !widget.valueField ? 'Select Category (X) and Value fields' : null);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {placeholderText && <Placeholder text={placeholderText} />}
    </div>
  );
}

// ── Waterfall rendering ─────────────────────────────────────────────────────────
function renderWaterfall(svg, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 18, right: 18, bottom: 70, left: 58 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  const opacity = widget.opacity ?? 1;
  const mode = widget.waterfallMode || 'difference';

  // Aggregate values per category
  const groups = new Map();
  for (const row of data) {
    const key = String(row[widget.xField] ?? '(blank)');
    const val = +row[widget.valueField] || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(val);
  }
  let pts = Array.from(groups, ([key, vals]) => ({
    key,
    value: aggregate(vals, widget.aggregation || 'sum'),
  }));

  if (widget.sortBy && widget.sortBy !== 'original') {
    pts = sortAggregated(pts, {
      sortBy: widget.sortBy || 'original',
      sortOrder: widget.sortOrder || 'asc',
      customOrder: widget.customSortOrder,
    });
  }

  // Compute waterfall bars
  const bars = [];
  let runningTotal = 0;

  for (let i = 0; i < pts.length; i++) {
    const { key, value } = pts[i];
    let change, start, end;

    if (mode === 'absolute') {
      change = i === 0 ? value : value - runningTotal;
      start = i === 0 ? 0 : runningTotal;
      end = value;
      runningTotal = value;
    } else {
      // difference mode (default)
      change = value;
      start = runningTotal;
      end = runningTotal + change;
      runningTotal = end;
    }

    bars.push({
      key,
      change,
      start,
      end,
      runningTotal: end,
      isFirst: i === 0,
      isLast: i === pts.length - 1,
    });
  }

  // Resolve colors
  const palette = getColorArray(widget.colorScheme);
  let positiveColor = palette[0] || '#22c55e';
  let negativeColor = palette[1] || '#ef4444';
  let totalColor = palette[2] || '#6366f1';

  // Gradient color mode
  let gradientScale = null;
  if (widget.colorMode === 'gradient') {
    const allChanges = bars.map(b => b.change);
    const ext = [Math.min(...allChanges), Math.max(...allChanges)];
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    gradientScale = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
  }

  function barColor(bar) {
    if (gradientScale) return gradientScale(bar.change);
    if (bar.isFirst || bar.isLast) return totalColor;
    return bar.change >= 0 ? positiveColor : negativeColor;
  }

  // Scales
  const allValues = bars.flatMap(b => [b.start, b.end]);
  const minVal = Math.min(0, ...allValues);
  const maxVal = Math.max(0, ...allValues);
  const padding = (maxVal - minVal) * 0.08 || 1;

  const xScale = d3.scaleBand().domain(bars.map(b => b.key)).range([0, W]).padding(0.22);
  const yScale = d3.scaleLinear().domain([minVal - padding, maxVal + padding]).range([H, 0]).nice();

  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  // Grid
  if (widget.showGrid) {
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
      .call(a => a.select('.domain').remove())
      .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
  }

  // Axes
  g.append('g').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10)))
    .call(styledAxis)
    .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

  // Connector lines between bars
  bars.forEach((bar, i) => {
    if (i < bars.length - 1) {
      const x1 = xScale(bar.key) + xScale.bandwidth();
      const x2 = xScale(bars[i + 1].key);
      const y = yScale(bar.end);
      g.append('line')
        .attr('x1', x1).attr('y1', y)
        .attr('x2', x2).attr('y2', y)
        .attr('stroke', 'var(--chart-grid-color)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2');
    }
  });

  // Bars (animated from start position)
  g.selectAll('.wf-bar').data(bars).join('rect').attr('class', 'wf-bar')
    .attr('x', d => xScale(d.key))
    .attr('y', d => yScale(d.start))
    .attr('width', xScale.bandwidth())
    .attr('height', 0)
    .attr('fill', d => barColor(d))
    .attr('opacity', opacity)
    .attr('rx', 3)
    .on('mouseover', (ev, d) => {
      d3.select(ev.currentTarget).attr('opacity', 1);
      showTooltip(ev, <WaterfallTip d={d} widget={widget} color={barColor(d)} />);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', (ev) => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTooltip(); })
    .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
    .style('cursor', onCrossFilter ? 'pointer' : null)
    .transition().duration(500).ease(d3.easeCubicOut)
    .attr('y', d => yScale(Math.max(d.start, d.end)))
    .attr('height', d => Math.abs(yScale(d.start) - yScale(d.end)));

  // Value labels
  g.selectAll('.wf-label').data(bars).join('text').attr('class', 'wf-label')
    .attr('x', d => xScale(d.key) + xScale.bandwidth() / 2)
    .attr('y', d => {
      const top = yScale(Math.max(d.start, d.end));
      return d.change >= 0 ? top - 4 : yScale(Math.min(d.start, d.end)) + 12;
    })
    .attr('text-anchor', 'middle')
    .attr('font-size', 10)
    .attr('fill', 'var(--chart-axis-color)')
    .attr('font-family', 'var(--font)')
    .attr('opacity', 0)
    .text(d => formatValue(d.change))
    .transition().delay(300).duration(300)
    .attr('opacity', 1);

  // Axis labels
  axisLabel(g, widget.xField, W / 2, H + 56, false);
  axisLabel(g, widget.valueField, -(H / 2), -46, true);
}

// ── Candlestick rendering ───────────────────────────────────────────────────────
function renderCandlestick(svg, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  const { w, h } = dims;
  const m = { top: 18, right: 18, bottom: 70, left: 58 };
  const W = w - m.left - m.right;
  const H = h - m.top - m.bottom;
  if (W <= 0 || H <= 0) return;

  const opacity = widget.opacity ?? 1;
  const palette = getColorArray(widget.colorScheme);
  const bullColor = palette[0] || '#22c55e';
  const bearColor = palette[1] || '#ef4444';

  // Aggregate per category if needed
  const groups = new Map();
  for (const row of data) {
    const key = String(row[widget.xField] ?? '(blank)');
    if (!groups.has(key)) groups.set(key, { opens: [], highs: [], lows: [], closes: [] });
    const g = groups.get(key);
    g.opens.push(+row[widget.openField] || 0);
    g.highs.push(+row[widget.highField] || 0);
    g.lows.push(+row[widget.lowField] || 0);
    g.closes.push(+row[widget.closeField] || 0);
  }

  const candles = Array.from(groups, ([key, g]) => ({
    key,
    open: aggregate(g.opens, widget.aggregation || 'avg'),
    high: aggregate(g.highs, widget.aggregation || 'max'),
    low: aggregate(g.lows, widget.aggregation || 'min'),
    close: aggregate(g.closes, widget.aggregation || 'avg'),
  }));

  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const pricePad = (maxPrice - minPrice) * 0.05 || 1;

  const xScale = d3.scaleBand().domain(candles.map(c => c.key)).range([0, W]).padding(0.3);
  const yScale = d3.scaleLinear().domain([minPrice - pricePad, maxPrice + pricePad]).range([H, 0]).nice();

  svg.attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  // Grid
  if (widget.showGrid) {
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
      .call(a => a.select('.domain').remove())
      .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
  }

  // Axes
  g.append('g').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat(d => truncate(d, 10)))
    .call(styledAxis)
    .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
  g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

  // Wicks (high-low lines)
  g.selectAll('.wick').data(candles).join('line').attr('class', 'wick')
    .attr('x1', d => xScale(d.key) + xScale.bandwidth() / 2)
    .attr('x2', d => xScale(d.key) + xScale.bandwidth() / 2)
    .attr('y1', d => yScale(d.high))
    .attr('y2', d => yScale(d.low))
    .attr('stroke', d => d.close >= d.open ? bullColor : bearColor)
    .attr('stroke-width', 1.5);

  // Bodies (open-close rectangles)
  g.selectAll('.candle-body').data(candles).join('rect').attr('class', 'candle-body')
    .attr('x', d => xScale(d.key))
    .attr('y', d => yScale(Math.max(d.open, d.close)))
    .attr('width', xScale.bandwidth())
    .attr('height', 0)
    .attr('fill', d => d.close >= d.open ? bullColor : bearColor)
    .attr('fill-opacity', d => d.close >= d.open ? opacity : 0.3)
    .attr('stroke', d => d.close >= d.open ? bullColor : bearColor)
    .attr('stroke-width', 1.5)
    .attr('rx', 2)
    .on('mouseover', (ev, d) => {
      showTooltip(ev, <CandleTip d={d} widget={widget} bullColor={bullColor} bearColor={bearColor} />);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.key }); } : null)
    .style('cursor', onCrossFilter ? 'pointer' : null)
    .transition().duration(500).ease(d3.easeCubicOut)
    .attr('height', d => Math.max(1, Math.abs(yScale(d.open) - yScale(d.close))));

  // Axis labels
  axisLabel(g, widget.xField, W / 2, H + 56, false);
}

// ── Tooltip Components ──────────────────────────────────────────────────────────
function WaterfallTip({ d, widget, color }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(d.change)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Running Total</span><span className="tt-value">{formatValue(d.runningTotal)}</span></div>
    </>
  );
}

function CandleTip({ d, widget, bullColor, bearColor }) {
  const isBull = d.close >= d.open;
  const color = isBull ? bullColor : bearColor;
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">Open</span><span className="tt-value">{formatValue(d.open)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">High</span><span className="tt-value">{formatValue(d.high)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Low</span><span className="tt-value">{formatValue(d.low)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Close</span><span className="tt-value">{formatValue(d.close)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Change</span><span className="tt-value" style={{ color }}>{formatValue(d.close - d.open)}</span></div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function axisLabel(g, text, x, y, rotate) {
  g.append('text')
    .attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('font-family', 'var(--font)')
    .attr('text-anchor', 'middle')
    .attr('transform', rotate ? `translate(${y},${x}) rotate(-90)` : `translate(${x},${y})`)
    .text(text);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; }
