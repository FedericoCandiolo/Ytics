/**
 * TriangularHeatMap — hexagonal triangle heatmap for symmetric/triangular matrices.
 *
 * Peak down: wide row at top (row 0 = yDomain[0], N hexes), apex at bottom.
 *   - X labels: top, rotated +60° following the right diagonal, right-aligned.
 *   - Y labels: left staircase — each label ends at the imaginary hex left of that row.
 *
 * Peak up: apex at top, wide row at bottom (row N-1 = yDomain[0], N hexes).
 *   - yIdx = N-1-r so the 1-hex apex shows yDomain[N-1] and the N-hex base shows yDomain[0].
 *   - X labels: bottom, rotated -60° (mirror of peak-down), right-aligned.
 *   - Y labels: same staircase formula, labels taken as yDomain[N-1-r].
 *   - Legend: in the unused top margin, above the apex.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';
import { resolveGradient, getSequentialScale } from '../../utils/colorUtils';

const S3H = Math.sqrt(3) / 2;

function hexPoints(cx, cy, r) {
  return [
    [cx,         cy - r      ],
    [cx + S3H*r, cy - r / 2  ],
    [cx + S3H*r, cy + r / 2  ],
    [cx,         cy + r      ],
    [cx - S3H*r, cy + r / 2  ],
    [cx - S3H*r, cy - r / 2  ],
  ].map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}

export default function TriangularHeatMap({ widget, data, onCrossFilter }) {
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

    const peakDown = (widget.trianglePeak || 'down') === 'down';
    const agg = widget.aggregation || 'sum';

    // Aggregate: nested[yVal][xVal] = value
    const nested = d3.rollup(
      data,
      v => aggregate(v.map(d => +d[widget.valueField] || 0), agg, undefined, { distinct: widget.distinct }),
      d => String(d[widget.yField] ?? ''),
      d => String(d[widget.xField] ?? ''),
    );

    // Domains in data order, then sort
    let yDomain = [...new Set(data.map(d => String(d[widget.yField] ?? '')))];
    let xDomain = [...new Set(data.map(d => String(d[widget.xField] ?? '')))];

    if (widget.sortBy && widget.sortBy !== 'original') {
      const opts = { sortBy: widget.sortBy, sortOrder: widget.sortOrder || 'asc', customOrder: widget.customSortOrder };
      xDomain = sortAggregated(xDomain.map(k => ({ key: k, value: 0 })), opts).map(p => p.key);
      yDomain = sortAggregated(yDomain.map(k => ({ key: k, value: 0 })), opts).map(p => p.key);
    }

    // N = triangle side — pad shorter domain with nulls
    const N = Math.max(xDomain.length, yDomain.length);
    while (xDomain.length < N) xDomain.push(null);
    while (yDomain.length < N) yDomain.push(null);

    // Peak down: X labels at top, apex at bottom (small bottom margin).
    // Peak up:   X labels at bottom, apex at top (small top margin).
    // Legend is vertical on the left for both — no horizontal legend margin needed.
    const labelGap = 5;
    const m = peakDown
      ? { top: 72, right: 24, bottom: 16, left: 76 }
      : { top: 24, right: 24, bottom: 52, left: 76 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0 || N < 1) return;

    // Hex circumradius constrained by both axes
    const hexR = Math.max(4, Math.min(W / (N * Math.sqrt(3)), H / (1.5 * N + 0.5)));
    const hexW = Math.sqrt(3) * hexR;

    const cx = m.left + W / 2;
    const rowStartY = m.top + hexR; // y-center of row 0

    // ── Build hex data ────────────────────────────────────────────────────────
    const hexes = [];
    for (let r = 0; r < N; r++) {
      const numInRow = peakDown ? (N - r) : (r + 1);
      const halfWidth = (numInRow - 1) / 2;
      // Peak down: yIdx = r.  Peak up: yIdx = N-1-r (apex row → last yDomain entry).
      const yIdx = peakDown ? r : (N - 1 - r);

      for (let c = 0; c < numInRow; c++) {
        const xVal = xDomain[c];
        const yVal = yDomain[yIdx];
        const value = (xVal !== null && yVal !== null)
          ? (nested.get(yVal)?.get(xVal) ?? null)
          : null;
        const hcx = cx + (c - halfWidth) * hexW;
        const hcy = rowStartY + r * 1.5 * hexR;
        hexes.push({ r, c, xVal, yVal, value, hcx, hcy });
      }
    }

    // ── Color scale ───────────────────────────────────────────────────────────
    const values = hexes.map(d => d.value).filter(v => v !== null && !isNaN(v));
    const [vMin, vMax] = values.length ? d3.extent(values) : [0, 1];
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const colorScale = getSequentialScale(gradKey, vMin, vMax, widget.invertGradient, widget.logGradient);
    const opacity = widget.opacity ?? 1;
    const maxFontSize = Math.min(11, Math.max(7, hexR * 0.85));

    // ── SVG ───────────────────────────────────────────────────────────────────
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g');

    // ── Hexagons ──────────────────────────────────────────────────────────────
    const cells = g.selectAll('.tri-hex').data(hexes).join('polygon')
      .attr('class', 'tri-hex')
      .attr('points', d => hexPoints(d.hcx, d.hcy, hexR * 0.96))
      .attr('fill', 'var(--bg-alt, #e0e0e0)')
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', Math.max(1, hexR * 0.08))
      .attr('opacity', opacity);

    cells.transition().duration(600).delay((_, i) => i * 1.5).ease(d3.easeCubicOut)
      .attr('fill', d => d.value !== null ? colorScale(d.value) : 'var(--bg-alt, #ddd)');

    cells
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).raise().attr('stroke-width', 3).attr('stroke', '#fff');
        if (d.value !== null)
          showTooltip(ev, <TriHeatTip d={d} widget={widget} colorScale={colorScale} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', ev => {
        d3.select(ev.currentTarget).attr('stroke-width', Math.max(1, hexR * 0.08)).attr('stroke', 'var(--bg)');
        hideTooltip();
      })
      .on('click', onCrossFilter
        ? (ev, d) => { if (d.xVal) { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: d.xVal }); } }
        : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // ── Y-axis labels — staircase following the left diagonal edge ────────────
    // For each row r, label ends at the center of the imaginary hex to the left
    // of that row's first hex: cx - (leftmost_halfWidth + 1) * hexW
    for (let r = 0; r < N; r++) {
      const yIdx = peakDown ? r : (N - 1 - r);
      const yLabel = yDomain[yIdx];
      if (!yLabel) continue;

      const numInRow = peakDown ? (N - r) : (r + 1);
      const halfWidth = (numInRow - 1) / 2;
      // Leftmost hex center: cx - halfWidth*hexW. Imaginary hex one step left:
      const lx = cx - halfWidth * hexW - hexW;
      const ly = rowStartY + r * 1.5 * hexR;
      const truncated = String(yLabel).length > 10 ? String(yLabel).slice(0, 9) + '…' : String(yLabel);

      g.append('text')
        .attr('x', lx)
        .attr('y', ly)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', maxFontSize)
        .attr('font-family', 'var(--font)')
        .attr('fill', 'var(--chart-axis-color)')
        .text(truncated);
    }

    // ── X-axis labels ─────────────────────────────────────────────────────────
    // Peak down: above the top row (all N columns at same y), rotated +60°.
    // Peak up:   below the bottom row (all N columns at same y), rotated -60°.
    // Both use text-anchor="end" so text extends away from the chart.
    for (let c = 0; c < N; c++) {
      const xLabel = xDomain[c];
      if (!xLabel) continue;
      const truncated = String(xLabel).length > 10 ? String(xLabel).slice(0, 9) + '…' : String(xLabel);

      // Column c is present in row 0 for peak down (top row has all N cols)
      // and in row N-1 for peak up (bottom row has all N cols).
      let lx, ly, rotation;
      if (peakDown) {
        // Anchor at center of imaginary hex upper-left of column c's row-0 hex:
        // that neighbor is hexW/2 left and 1.5*hexR above the row-0 hex center.
        lx = cx + (c - (N - 1) / 2) * hexW - hexW / 2;
        ly = rowStartY - 1.5 * hexR;
        rotation = 60;  // follows the right-diagonal edge, text extends lower-left from anchor
      } else {
        // Bottom row (row N-1): same x formula, anchor just below hex bottom
        lx = cx + (c - (N - 1) / 2) * hexW;
        ly = rowStartY + (N - 1) * 1.5 * hexR + hexR + labelGap;
        rotation = -60; // mirror of peak-down, extends lower-left from anchor
      }

      g.append('text')
        .attr('x', lx)
        .attr('y', ly)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'auto')
        .attr('font-size', maxFontSize)
        .attr('font-family', 'var(--font)')
        .attr('fill', 'var(--chart-axis-color)')
        .attr('transform', `rotate(${rotation}, ${lx}, ${ly})`)
        .text(truncated);
    }

    // ── Color legend — vertical bar on the left margin ────────────────────────
    const legBarW = 8;
    const legBarH = Math.min(160, H * 0.65);
    const legLx = 4;
    const legLy = m.top + (H - legBarH) / 2;

    const defs = svg.append('defs');
    const gradId = `trihm-grad-${Math.random().toString(36).slice(2, 6)}`;
    // y1=1 → y2=0 so bottom of bar = vMin, top = vMax
    const grad = defs.append('linearGradient').attr('id', gradId)
      .attr('x1', '0').attr('y1', '1').attr('x2', '0').attr('y2', '0');
    for (let i = 0; i <= 10; i++) {
      grad.append('stop').attr('offset', `${i * 10}%`)
        .attr('stop-color', colorScale(vMin + (i / 10) * (vMax - vMin)));
    }
    const legG = g.append('g').attr('transform', `translate(${legLx}, ${legLy})`);
    legG.append('rect').attr('width', legBarW).attr('height', legBarH).attr('rx', 3).attr('fill', `url(#${gradId})`);
    legG.append('text').attr('x', legBarW / 2).attr('y', -4)
      .attr('text-anchor', 'middle').attr('font-size', 9.5)
      .attr('fill', 'var(--chart-axis-color)').text(formatValue(vMax, widget.numberFormat));
    legG.append('text').attr('x', legBarW / 2).attr('y', legBarH + 12)
      .attr('text-anchor', 'middle').attr('font-size', 9.5)
      .attr('fill', 'var(--chart-axis-color)').text(formatValue(vMin, widget.numberFormat));
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField || !widget.valueField) && (
        <Placeholder text="Select X, Y and Value fields" />
      )}
    </div>
  );
}

function TriHeatTip({ d, widget, colorScale }) {
  const c = colorScale(d.value);
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: 3,
          background: c, marginRight: 6, verticalAlign: 'middle',
          border: '1px solid rgba(255,255,255,.3)',
        }} />
        {d.xVal} × {d.yVal}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField}</span>
        <span className="tt-value">{formatValue(d.value, widget.numberFormat)}</span>
      </div>
    </>
  );
}
