import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

const TOTAL_CELLS = 100; // 10×10 waffle grid

export default function WaffleChart({ widget, data, onCrossFilter }) {
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

    const m = { top: 10, right: 120, bottom: 10, left: 10 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Aggregate by label
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.labelField] ?? '(blank)');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(+row[widget.valueField] || 0);
    }

    let cats = Array.from(groups, ([key, vals]) => ({
      key,
      value: aggregate(vals, widget.aggregation || 'sum'),
    }));
    cats = sortAggregated(cats, {
      sortBy: widget.sortBy || 'value',
      sortOrder: widget.sortOrder || 'desc',
      customOrder: widget.customSortOrder,
    });

    const total = cats.reduce((s, c) => s + c.value, 0);
    if (total === 0) return;

    // Allocate cells using largest remainder method.
    // Categories below 0.5% of total are grouped into "Others".
    const threshold = 0.005; // 0.5%
    let mainCats = [];
    let othersValue = 0;
    for (const cat of cats) {
      const pct = cat.value / total;
      if (pct >= threshold) {
        mainCats.push({ ...cat, pct });
      } else {
        othersValue += cat.value;
      }
    }
    if (othersValue > 0) {
      mainCats.push({ key: 'Others', value: othersValue, pct: othersValue / total });
    }
    // Re-sort descending after adding Others
    mainCats.sort((a, b) => b.value - a.value);

    // Largest remainder method: floor each, then distribute leftover to biggest remainders
    const cellCats = mainCats.map(cat => {
      const exact = cat.pct * TOTAL_CELLS;
      return { ...cat, cells: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let allocated = cellCats.reduce((s, c) => s + c.cells, 0);
    let leftover = TOTAL_CELLS - allocated;
    // Sort indices by remainder descending to distribute leftover
    const indices = cellCats.map((_, i) => i);
    indices.sort((a, b) => cellCats[b].remainder - cellCats[a].remainder);
    for (let i = 0; i < leftover; i++) {
      cellCats[indices[i]].cells += 1;
    }
    // Categories that still got 0 cells after distribution get folded into Others
    let extraOthers = 0;
    const finalCats = [];
    for (const cat of cellCats) {
      if (cat.cells === 0) {
        extraOthers += cat.value;
      } else {
        finalCats.push(cat);
      }
    }
    if (extraOthers > 0) {
      const existing = finalCats.find(c => c.key === 'Others');
      if (existing) {
        existing.value += extraOthers;
        existing.pct = existing.value / total;
      } else {
        // Steal one cell from the category with the largest remainder that has >1 cell
        const donor = finalCats.filter(c => c.cells > 1).sort((a, b) => b.remainder - a.remainder)[0] || finalCats[finalCats.length - 1];
        donor.cells -= 1;
        finalCats.push({ key: 'Others', value: extraOthers, pct: extraOthers / total, cells: 1, remainder: 0 });
      }
    }
    // Re-sort finalCats descending for fill order
    finalCats.sort((a, b) => b.value - a.value);
    // Clean up remainder property
    finalCats.forEach(c => delete c.remainder);

    // Build flat cell array (largest category first)
    const cellArray = [];
    finalCats.forEach(cat => {
      for (let i = 0; i < cat.cells; i++) {
        cellArray.push(cat);
      }
    });

    let colors;
    if (widget.colorMode === 'gradient') {
      const gradField = widget.colorGradientField || widget.valueField;
      let colorVals;
      if (gradField !== widget.valueField) {
        const gMap = new Map();
        for (const row of data) {
          const key = String(row[widget.labelField] ?? '(blank)');
          const val = +row[gradField] || 0;
          if (!gMap.has(key)) gMap.set(key, []);
          gMap.get(key).push(val);
        }
        colorVals = finalCats.map(c => {
          const vals = gMap.get(c.key) || [0];
          return aggregate(vals, widget.aggregation || 'sum');
        });
      } else {
        colorVals = finalCats.map(c => c.value);
      }
      const ext = [Math.min(...colorVals), Math.max(...colorVals)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1]);
      colors = d => {
        const idx = finalCats.findIndex(c => c.key === d);
        return seq(colorVals[idx] ?? 0);
      };
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, finalCats.map(c => c.key), widget.dimensionColors);
    }
    const opacity = widget.opacity ?? 1;

    const cols = 10;
    const rows = 10;
    const cellSize = Math.min(W / cols, H / rows);
    const gap = cellSize * 0.1;
    const size = cellSize - gap;
    const gridW = cols * cellSize;
    const gridH = rows * cellSize;
    const offsetX = (W - gridW) / 2;
    const offsetY = (H - gridH) / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left + offsetX},${m.top + offsetY})`);

    cellArray.forEach((cat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols); // top-to-bottom, left-to-right fill
      const x = col * cellSize + gap / 2;
      const y = row * cellSize + gap / 2;

      g.append('rect')
        .attr('x', x).attr('y', y)
        .attr('width', size).attr('height', size)
        .attr('rx', size * 0.15)
        .attr('fill', colors(cat.key))
        .attr('opacity', 0)
        .on('mouseover', ev => showTooltip(ev, <WaffleTip cat={cat} color={colors(cat.key)} widget={widget} />))
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip)
        .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.labelField, value: cat.key }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null)
        .transition().delay(i * 8).duration(200)
        .attr('opacity', opacity);
    });

    // Legend
    if (widget.showLegend) {
      const leg = svg.append('g').attr('transform', `translate(${w - m.right + 10},${m.top + 10})`);
      finalCats.filter(c => c.cells > 0).slice(0, 12).forEach((cat, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 20})`);
        row.append('rect').attr('width', 12).attr('height', 12).attr('rx', 3).attr('fill', colors(cat.key));
        row.append('text').attr('x', 16).attr('y', 10)
          .attr('font-size', 10.5).attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
          .text(`${cat.key.length > 10 ? cat.key.slice(0, 10) + '…' : cat.key} (${(cat.pct * 100).toFixed(0)}%)`);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.labelField || !widget.valueField) && <Placeholder text="Select Label and Value fields" />}
    </div>
  );
}

function WaffleTip({ cat, color, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {cat.key}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(cat.value)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Share</span><span className="tt-value">{(cat.pct * 100).toFixed(1)}%</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Cells</span><span className="tt-value">{cat.cells} / {TOTAL_CELLS}</span></div>
    </>
  );
}
