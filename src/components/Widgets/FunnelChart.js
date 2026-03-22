import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function FunnelChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const opacity = widget.opacity ?? 1;
    const funnelMode = widget.funnelMode || 'absolute';

    // Aggregate values per stage
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.xField] ?? '(blank)');
      const val = +row[widget.valueField] || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(val);
    }
    let stages = Array.from(groups, ([key, vals]) => ({
      key,
      value: aggregate(vals, widget.aggregation || 'sum', undefined, { distinct: widget.distinct }),
      count: vals.length,
    }));

    // Sort stages using shared sort utility (supports custom order with spaces)
    stages = sortAggregated(stages, {
      sortBy: widget.sortBy || 'value',
      sortOrder: widget.sortOrder || 'desc',
      customOrder: widget.customSortOrder,
    });

    // Apply cumulative mode: each stage shows sum of itself and all subsequent stages
    let displayValues;
    if (funnelMode === 'cumulative') {
      displayValues = stages.map((_, i) =>
        stages.slice(i).reduce((s, st) => s + st.value, 0)
      );
    } else {
      displayValues = stages.map(s => s.value);
    }

    const maxValue = displayValues[0] || 1;
    const firstValue = displayValues[0] || 1;
    const n = stages.length;

    // Margins
    const m = { top: 14, right: 20, bottom: 14, left: 20 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Color scale
    const domain = stages.map(d => d.key);
    let colors;
    if (widget.colorMode === 'gradient') {
      const colorVals = displayValues;
      const ext = [Math.min(...colorVals), Math.max(...colorVals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
      colors = (_, i) => seq(colorVals[i] ?? 0);
    } else {
      const scale = getColorScaleWithOverrides(widget.colorScheme, domain, widget.dimensionColors);
      colors = (key) => scale(key);
    }

    // Layout: horizontal trapezoids stacked vertically, centered
    const labelAreaLeft = Math.min(120, W * 0.25);
    const labelAreaRight = Math.min(100, W * 0.2);
    const funnelW = W - labelAreaLeft - labelAreaRight;
    const gap = 3;
    const conversionRowH = 18;
    const totalConversionRows = Math.max(0, n - 1);
    const segmentH = n > 0 ? (H - totalConversionRows * conversionRowH) / n : 0;
    if (segmentH < 4) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    const centerX = labelAreaLeft + funnelW / 2;

    stages.forEach((stage, i) => {
      const val = displayValues[i];
      const nextVal = i < n - 1 ? displayValues[i + 1] : null;

      // Width proportional to value
      const topW = (val / maxValue) * funnelW;
      const botW = nextVal != null ? (nextVal / maxValue) * funnelW : topW * 0.4;

      const yOffset = i * (segmentH + conversionRowH);
      const y0 = yOffset;
      const y1 = yOffset + segmentH - gap;

      // Trapezoid points: top-left, top-right, bottom-right, bottom-left
      const x1tl = centerX - topW / 2;
      const x1tr = centerX + topW / 2;
      const x2bl = centerX - botW / 2;
      const x2br = centerX + botW / 2;

      const points = `${x1tl},${y0} ${x1tr},${y0} ${x2br},${y1} ${x2bl},${y1}`;

      const color = colors(stage.key, i);
      const pctOfFirst = firstValue > 0 ? ((val / firstValue) * 100).toFixed(1) : '0';

      g.append('polygon')
        .attr('points', points)
        .attr('fill', color)
        .attr('opacity', 0)
        .attr('stroke', 'none')
        .style('cursor', onCrossFilter ? 'pointer' : null)
        .on('mouseover', (ev) => {
          d3.select(ev.currentTarget).attr('opacity', 1);
          showTooltip(ev, <FunnelTip stage={stage} value={val} color={color} pctOfFirst={pctOfFirst} widget={widget} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).attr('opacity', opacity);
          hideTooltip();
        })
        .on('click', onCrossFilter ? (ev) => {
          ev.stopPropagation();
          onCrossFilter({ field: widget.xField, value: stage.key });
        } : null)
        .transition().duration(500).ease(d3.easeCubicOut)
        .attr('opacity', opacity);

      // Stage label on the left
      const labelY = (y0 + y1) / 2;
      g.append('text')
        .attr('x', labelAreaLeft - 8)
        .attr('y', labelY)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('fill', 'var(--chart-axis-color)')
        .attr('font-size', 11)
        .attr('font-family', 'var(--font)')
        .text(truncate(stage.key, 14));

      // Value on the right
      g.append('text')
        .attr('x', labelAreaLeft + funnelW + 8)
        .attr('y', labelY)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', 'var(--chart-axis-color)')
        .attr('font-size', 11)
        .attr('font-family', 'var(--font)')
        .attr('font-weight', 600)
        .text(formatValue(val, widget.numberFormat));

      // Conversion rate between this stage and the next
      if (i < n - 1) {
        const convY = yOffset + segmentH + conversionRowH / 2;
        const convRate = val > 0 ? ((displayValues[i + 1] / val) * 100).toFixed(1) : '0';

        g.append('text')
          .attr('x', centerX)
          .attr('y', convY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', 'var(--text-muted)')
          .attr('font-size', 10)
          .attr('font-family', 'var(--font)')
          .text(`${convRate}%`);
      }
    });
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.valueField) && <Placeholder text="Select Stage (X) and Value fields" />}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function FunnelTip({ stage, value, color, pctOfFirst, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {stage.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(value, widget.numberFormat)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">% of first stage</span><span className="tt-value">{pctOfFirst}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Records</span><span className="tt-value">{stage.count.toLocaleString()}</span></div>
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '\u2026' : s; }
