import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function MekkoChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const yField = widget.yField || widget.valueField;
    if (!data?.length || !widget.xField || !yField || !widget.colorField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const opacity = widget.opacity ?? 1;
    const valueMode = widget.mekkoValueMode || 'relative';
    const gap = 2;

    const m = { top: 14, right: 18, bottom: 70, left: 58 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // ── Aggregate by (xField, colorField) combinations ──────────────────────
    const pivotMap = new Map();
    const subCatSet = new Set();
    for (const row of data) {
      const xKey = String(row[widget.xField] ?? '(blank)');
      const cKey = String(row[widget.colorField] ?? '(blank)');
      subCatSet.add(cKey);
      const mapKey = `${xKey}|||${cKey}`;
      if (!pivotMap.has(mapKey)) pivotMap.set(mapKey, { xKey, cKey, vals: [] });
      pivotMap.get(mapKey).vals.push(+row[yField] || 0);
    }

    const subCategories = [...subCatSet];
    const xKeys = [...new Set([...pivotMap.values()].map(v => v.xKey))];

    // Build per-category data
    const categories = xKeys.map(xKey => {
      const segments = [];
      let catTotal = 0;
      for (const cKey of subCategories) {
        const entry = pivotMap.get(`${xKey}|||${cKey}`);
        const val = entry ? aggregate(entry.vals, widget.aggregation || 'sum') : 0;
        segments.push({ subCat: cKey, value: val });
        catTotal += val;
      }
      return { key: xKey, segments, total: catTotal };
    });

    // Sort x-axis categories if sortBy is set
    if (widget.sortBy && widget.sortBy !== 'original') {
      let sorted = categories.map(c => ({ key: c.key, value: c.total }));
      sorted = sortAggregated(sorted, {
        sortBy: widget.sortBy || 'original',
        sortOrder: widget.sortOrder || 'asc',
        customOrder: widget.customSortOrder,
      });
      const orderMap = new Map(sorted.map((d, i) => [d.key, i]));
      categories.sort((a, b) => orderMap.get(a.key) - orderMap.get(b.key));
    }

    const grandTotal = categories.reduce((s, c) => s + c.total, 0) || 1;

    // ── Color scale ─────────────────────────────────────────────────────────
    let colorScale;
    if (widget.colorMode === 'gradient') {
      const ext = d3.extent(subCategories.map((_, i) => i));
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1]);
      colorScale = (cKey) => seq(subCategories.indexOf(cKey));
    } else {
      colorScale = getColorScaleWithOverrides(widget.colorScheme, subCategories, widget.dimensionColors);
    }

    // ── Render ──────────────────────────────────────────────────────────────
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Y-axis: 0% to 100%
    const yScale = d3.scaleLinear().domain([0, 1]).range([H, 0]);
    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.0%')))
      .call(styledAxis);

    // Compute column x positions and widths
    const totalGap = gap * Math.max(0, categories.length - 1);
    const usableW = W - totalGap;

    let xCursor = 0;
    const cols = categories.map(cat => {
      const colW = (cat.total / grandTotal) * usableW;
      const col = { ...cat, x: xCursor, w: colW };
      xCursor += colW + gap;
      return col;
    });

    // Draw columns
    cols.forEach(col => {
      let yCursor = 0; // fraction accumulated from top (we draw top-down, 0 = bottom in value)

      // Sort segments so largest are at bottom
      const sorted = [...col.segments].filter(s => s.value > 0);

      sorted.forEach(seg => {
        const segFraction = col.total > 0 ? seg.value / col.total : 0;
        const segY = yScale(yCursor + segFraction);
        const segH = yScale(yCursor) - segY;
        yCursor += segFraction;

        const pctOfCat = col.total > 0 ? ((seg.value / col.total) * 100).toFixed(1) : '0.0';
        const pctOfGrand = ((seg.value / grandTotal) * 100).toFixed(1);

        g.append('rect')
          .attr('x', col.x)
          .attr('y', segY)
          .attr('width', Math.max(col.w, 0))
          .attr('height', Math.max(segH, 0))
          .attr('fill', colorScale(seg.subCat))
          .attr('opacity', opacity)
          .attr('stroke', 'var(--surface)')
          .attr('stroke-width', 0.5)
          .on('mouseover', (ev) => {
            d3.select(ev.currentTarget).attr('opacity', 1);
            showTooltip(ev, (
              <MekkoTip
                category={col.key}
                subCategory={seg.subCat}
                value={seg.value}
                pctOfCat={pctOfCat}
                pctOfGrand={pctOfGrand}
                catTotal={col.total}
                color={colorScale(seg.subCat)}
                widget={widget}
                yField={yField}
              />
            ));
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', (ev) => {
            d3.select(ev.currentTarget).attr('opacity', opacity);
            hideTooltip();
          })
          .on('click', onCrossFilter ? (ev) => {
            ev.stopPropagation();
            onCrossFilter({ field: widget.xField, value: col.key });
          } : null)
          .style('cursor', onCrossFilter ? 'pointer' : null);

        // Segment label (only if large enough)
        if (segH > 14 && col.w > 30) {
          let labelText;
          if (valueMode === 'absolute') {
            labelText = formatValue(seg.value);
          } else if (valueMode === 'both') {
            labelText = `${formatValue(seg.value)} (${pctOfCat}%)`;
          } else {
            labelText = `${pctOfCat}%`;
          }

          // Only show if text would fit
          const estTextW = labelText.length * 6;
          if (col.w > estTextW + 4) {
            g.append('text')
              .attr('x', col.x + col.w / 2)
              .attr('y', segY + segH / 2)
              .attr('text-anchor', 'middle')
              .attr('dominant-baseline', 'central')
              .attr('font-size', Math.min(11, segH - 2))
              .attr('font-family', 'var(--font)')
              .attr('fill', '#fff')
              .attr('pointer-events', 'none')
              .text(labelText);
          }
        }
      });

      // Category label below column
      if (col.w > 12) {
        g.append('text')
          .attr('x', col.x + col.w / 2)
          .attr('y', H + 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', Math.min(11, col.w * 0.8))
          .attr('font-family', 'var(--font)')
          .attr('fill', 'var(--chart-axis-color)')
          .text(truncate(col.key, Math.max(3, Math.floor(col.w / 7))));

        // Total value below category name
        g.append('text')
          .attr('x', col.x + col.w / 2)
          .attr('y', H + 28)
          .attr('text-anchor', 'middle')
          .attr('font-size', Math.min(10, col.w * 0.7))
          .attr('font-family', 'var(--font)')
          .attr('fill', 'var(--text-muted)')
          .text(formatValue(col.total));
      }
    });

    // Axis labels
    g.append('text')
      .attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('font-family', 'var(--font)')
      .attr('text-anchor', 'middle')
      .attr('transform', `translate(${W / 2},${H + 56})`)
      .text(widget.xField);

    g.append('text')
      .attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('font-family', 'var(--font)')
      .attr('text-anchor', 'middle')
      .attr('transform', `translate(${-46},${-(H / 2)}) rotate(-90)`)
      .text(yField);

    // ── Legend ───────────────────────────────────────────────────────────────
    if (widget.showLegend && subCategories.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W - subCategories.length * 80}, ${-10})`);
      subCategories.slice(0, 10).forEach((key, i) => {
        const item = leg.append('g').attr('transform', `translate(${i * 80}, 0)`);
        item.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colorScale(key));
        item.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10).attr('fill', 'var(--text-muted)')
          .text(truncate(key, 8));
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !(widget.yField || widget.valueField) || !widget.colorField) &&
        <Placeholder text="Select Category (X), Numeric (Y), and Color fields" />}
    </div>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function MekkoTip({ category, subCategory, value, pctOfCat, pctOfGrand, catTotal, color, widget, yField }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {category} — {subCategory}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{yField}</span><span className="tt-value">{formatValue(value)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share of {category}</span><span className="tt-value">{pctOfCat}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share of total</span><span className="tt-value">{pctOfGrand}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Category total</span><span className="tt-value">{formatValue(catTotal)}</span></div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
