import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

export default function BoxPlot({ widget, data, onCrossFilter }) {
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

    const iqrMultiplier = widget.iqrMultiplier ?? 1.5;
    const hasColorField = !!widget.colorField;

    const m = { top: 14, right: 18, bottom: 70, left: 58 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Group by category (and optionally by colorField)
    const groups = new Map();
    const subGroupSet = new Set();
    for (const row of data) {
      const key = String(row[widget.xField] ?? '(blank)');
      const val = +row[widget.yField];
      if (isNaN(val)) continue;
      if (hasColorField) {
        const sub = String(row[widget.colorField] ?? '(blank)');
        subGroupSet.add(sub);
        const compKey = `${key}||${sub}`;
        if (!groups.has(compKey)) groups.set(compKey, { cat: key, sub, vals: [], rows: [] });
        groups.get(compKey).vals.push(val);
        groups.get(compKey).rows.push(row);
      } else {
        if (!groups.has(key)) groups.set(key, { cat: key, sub: null, vals: [], rows: [] });
        groups.get(key).vals.push(val);
        groups.get(key).rows.push(row);
      }
    }

    // Sort categories if sortBy is set
    let categories = [...new Set([...groups.values()].map(g => g.cat))];
    if (widget.sortBy && widget.sortBy !== 'original') {
      // Build pseudo-points with median as value for sort
      const catPts = categories.map(cat => {
        const vals = [...groups.values()].filter(g => g.cat === cat).flatMap(g => g.vals);
        return { key: cat, value: d3.median(vals) || 0 };
      });
      categories = sortAggregated(catPts, {
        sortBy: widget.sortBy, sortOrder: widget.sortOrder || 'asc',
        customOrder: widget.customSortOrder,
      }).map(d => d.key);
    }
    const subGroups = hasColorField ? [...subGroupSet] : [null];

    // Compute stats for each group
    const statsMap = new Map();
    for (const [key, grp] of groups) {
      // Sort vals and rows together so indices stay aligned
      const indexed = grp.vals.map((v, i) => ({ v, row: grp.rows[i] }));
      indexed.sort((a, b) => a.v - b.v);
      const vals = indexed.map(d => d.v);
      const rows = indexed.map(d => d.row);
      const n = vals.length;
      if (n === 0) continue;
      const q1 = quantile(vals, 0.25);
      const median = quantile(vals, 0.5);
      const q3 = quantile(vals, 0.75);
      const iqr = q3 - q1;
      const whiskerLo = Math.max(d3.min(vals), q1 - iqrMultiplier * iqr);
      const whiskerHi = Math.min(d3.max(vals), q3 + iqrMultiplier * iqr);
      const outliers = vals.filter(v => v < whiskerLo || v > whiskerHi);
      const mean = d3.mean(vals);
      statsMap.set(key, { cat: grp.cat, sub: grp.sub, vals, rows, n, q1, median, q3, iqr, whiskerLo, whiskerHi, outliers, mean });
    }

    // Color scale
    let colors;
    const colorDomain = hasColorField ? subGroups : categories;
    if (widget.colorMode === 'gradient' && !hasColorField) {
      const medians = categories.map(cat => statsMap.get(cat)?.median ?? 0);
      const ext = [Math.min(...medians), Math.max(...medians)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
      const medianMap = new Map(categories.map((cat, i) => [cat, medians[i]]));
      colors = d => seq(medianMap.get(d) ?? 0);
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, colorDomain, widget.dimensionColors);
    }
    const opacity = widget.opacity ?? 1;

    const allVals = data.map(d => +d[widget.yField]).filter(v => !isNaN(v));
    const yMin = d3.min(allVals);
    const yMax = d3.max(allVals);
    const pad = (yMax - yMin) * 0.05 || 1;

    const xScale = d3.scaleBand().domain(categories).range([0, W]).padding(0.3);
    const yScale = d3.scaleLinear().domain([yMin - pad, yMax + pad]).range([H, 0]).nice();

    // Sub-group scale within each category band
    const subScale = hasColorField
      ? d3.scaleBand().domain(subGroups).range([0, xScale.bandwidth()]).padding(0.08)
      : null;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale)).call(styledAxis)
      .selectAll('text').attr('transform', 'rotate(-38)').style('text-anchor', 'end').attr('dy', '0.4em').attr('dx', '-0.4em');
    g.append('g').call(d3.axisLeft(yScale).ticks(6).tickFormat(formatValue)).call(styledAxis);

    const bw = xScale.bandwidth();

    // Seeded pseudo-random for consistent jitter
    const jitterRng = mulberry32(42);
    const useJitterField = !!widget.jitterField;

    for (const [, s] of statsMap) {
      const catX = xScale(s.cat);
      let slotX, slotW;
      if (hasColorField) {
        slotX = catX + subScale(s.sub);
        slotW = subScale.bandwidth();
      } else {
        slotX = catX;
        slotW = bw;
      }

      const boxW = Math.min(slotW, 60);
      const offset = (slotW - boxW) / 2;
      const cx = slotX + slotW / 2;
      const x0 = slotX + offset;
      const color = hasColorField ? colors(s.sub) : colors(s.cat);

      // Whisker lines
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(s.whiskerHi)).attr('y2', yScale(s.q3))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(s.q1)).attr('y2', yScale(s.whiskerLo))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);

      // Whisker caps
      g.append('line').attr('x1', cx - boxW * 0.25).attr('x2', cx + boxW * 0.25)
        .attr('y1', yScale(s.whiskerHi)).attr('y2', yScale(s.whiskerHi))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);
      g.append('line').attr('x1', cx - boxW * 0.25).attr('x2', cx + boxW * 0.25)
        .attr('y1', yScale(s.whiskerLo)).attr('y2', yScale(s.whiskerLo))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', opacity);

      // Box
      const boxRect = g.append('rect')
        .attr('x', x0).attr('y', yScale(s.q3))
        .attr('width', boxW).attr('height', Math.max(0, yScale(s.q1) - yScale(s.q3)))
        .attr('fill', color).attr('fill-opacity', 0.25 * opacity)
        .attr('stroke', color).attr('stroke-width', 1.5).attr('rx', 3);

      // Median line
      g.append('line').attr('x1', x0).attr('x2', x0 + boxW)
        .attr('y1', yScale(s.median)).attr('y2', yScale(s.median))
        .attr('stroke', color).attr('stroke-width', 2.5).attr('opacity', opacity);

      // Mean diamond
      const my = yScale(s.mean);
      g.append('path')
        .attr('d', `M${cx},${my - 4} L${cx + 4},${my} L${cx},${my + 4} L${cx - 4},${my} Z`)
        .attr('fill', '#fff').attr('stroke', color).attr('stroke-width', 1.5);

      // Per-group jitter scale when jitterField is set (min/max per box)
      let grpJitterScale;
      if (useJitterField) {
        const jVals = s.rows.map(r => +r[widget.jitterField]).filter(v => !isNaN(v));
        const jExt = d3.extent(jVals);
        grpJitterScale = jExt[0] === jExt[1]
          ? () => 0
          : d3.scaleLinear().domain(jExt).range([-0.45, 0.45]);
      }

      // Data points & outliers
      if (widget.showDataPoints !== false) {
        // Single pass: all values with tooltips; outliers styled distinctly
        s.vals.forEach((v, i) => {
          const row = s.rows[i];
          const isOutlier = v < s.whiskerLo || v > s.whiskerHi;
          const jx = useJitterField
            ? grpJitterScale(+row[widget.jitterField] || 0) * boxW
            : (jitterRng() - 0.5) * boxW * 0.7;
          const circle = g.append('circle')
            .attr('cx', cx + jx)
            .attr('cy', yScale(v))
            .attr('r', 2.5)
            .attr('fill', isOutlier ? 'none' : color)
            .attr('fill-opacity', isOutlier ? 1 : 0.3)
            .attr('stroke', isOutlier ? color : 'none')
            .attr('stroke-width', isOutlier ? 1.2 : 0)
            .attr('opacity', isOutlier ? opacity * 0.7 : 1);
          circle
            .on('mouseover', ev => {
              circle.attr('r', 4.5).attr('fill', color).attr('fill-opacity', 0.8).attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', 1);
              showTooltip(ev, <PointTip row={row} widget={widget} value={v} color={color} cat={s.cat} sub={s.sub} />);
            })
            .on('mousemove', moveTooltip)
            .on('mouseleave', () => {
              circle.attr('r', 2.5)
                .attr('fill', isOutlier ? 'none' : color)
                .attr('fill-opacity', isOutlier ? 1 : 0.3)
                .attr('stroke', isOutlier ? color : 'none')
                .attr('stroke-width', isOutlier ? 1.2 : 0)
                .attr('opacity', isOutlier ? opacity * 0.7 : 1);
              hideTooltip();
            });
        });
      } else {
        // Only show outlier dots (no tooltips when data points are off)
        s.outliers.forEach(v => {
          g.append('circle')
            .attr('cx', cx + (jitterRng() - 0.5) * boxW * 0.7)
            .attr('cy', yScale(v))
            .attr('r', 3).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2).attr('opacity', opacity * 0.7);
        });
      }

      // Tooltip on box
      boxRect
        .on('mouseover', ev => showTooltip(ev, <BoxTip s={s} color={color} widget={widget} iqrMultiplier={iqrMultiplier} />))
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip)
        .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: s.cat }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null);
    }

    // Legend for colorField sub-groups
    if (hasColorField && subGroups.length > 1) {
      const legend = g.append('g').attr('transform', `translate(${W - subGroups.length * 80},${-10})`);
      subGroups.forEach((sub, i) => {
        const lg = legend.append('g').attr('transform', `translate(${i * 80},0)`);
        lg.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', colors(sub));
        lg.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10)
          .attr('fill', 'var(--chart-axis-color)').text(sub);
      });
    }

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', W / 2).attr('y', H + 56).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('transform', `translate(${-46},${H / 2}) rotate(-90)`).text(widget.yField);
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

function BoxTip({ s, color, widget, iqrMultiplier }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {s.cat}{s.sub != null ? ` / ${s.sub}` : ''}
      </div>
      <div className="chart-tooltip-row"><span className="tt-label">n</span><span className="tt-value">{s.n}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Median</span><span className="tt-value">{formatValue(s.median)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Mean</span><span className="tt-value">{formatValue(s.mean)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Q1</span><span className="tt-value">{formatValue(s.q1)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Q3</span><span className="tt-value">{formatValue(s.q3)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">IQR</span><span className="tt-value">{formatValue(s.iqr)}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">IQR mult</span><span className="tt-value">{iqrMultiplier}</span></div>
      <div className="chart-tooltip-row"><span className="tt-label">Outliers</span><span className="tt-value">{s.outliers.length}</span></div>
    </>
  );
}

function PointTip({ row, widget, value, color, cat, sub }) {
  const label = widget.labelField ? String(row[widget.labelField] ?? '') : null;
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {label || cat}{sub != null ? ` / ${sub}` : ''}
      </div>
      {label && (
        <div className="chart-tooltip-row"><span className="tt-label">{widget.xField}</span><span className="tt-value">{cat}</span></div>
      )}
      <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(value)}</span></div>
    </>
  );
}

function quantile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Simple seeded PRNG for deterministic jitter */
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
