/**
 * Violin Plot — shows distribution shape + box plot for each category.
 * Fields: xField (category), yField (numeric).
 * Supports colorField for sub-grouped violins, iqrMultiplier, showDataPoints.
 */
import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue, sortAggregated } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

export default function ViolinPlot({ widget, data, onCrossFilter }) {
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

    const m = { top: 16, right: 18, bottom: 60, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Group by xField (and optionally colorField)
    const groupMap = new Map();
    const subGroupSet = new Set();
    for (const row of data) {
      const cat = String(row[widget.xField] ?? '');
      const val = +row[widget.yField];
      if (isNaN(val)) continue;
      if (hasColorField) {
        const sub = String(row[widget.colorField] ?? '(blank)');
        subGroupSet.add(sub);
        const compKey = `${cat}||${sub}`;
        if (!groupMap.has(compKey)) groupMap.set(compKey, { cat, sub, vals: [], rows: [] });
        const grp = groupMap.get(compKey);
        grp.vals.push(val);
        grp.rows.push(row);
      } else {
        if (!groupMap.has(cat)) groupMap.set(cat, { cat, sub: null, vals: [], rows: [] });
        const grp = groupMap.get(cat);
        grp.vals.push(val);
        grp.rows.push(row);
      }
    }

    // Sort vals (keep rows in sync)
    for (const grp of groupMap.values()) {
      const indexed = grp.vals.map((v, i) => ({ v, row: grp.rows[i] }));
      indexed.sort((a, b) => d3.ascending(a.v, b.v));
      grp.vals = indexed.map(d => d.v);
      grp.rows = indexed.map(d => d.row);
    }

    let xDomain = [...new Set([...groupMap.values()].map(g => g.cat))];
    if (widget.sortBy && widget.sortBy !== 'original') {
      const catPts = xDomain.map(cat => {
        const vals = [...groupMap.values()].filter(g => g.cat === cat).flatMap(g => g.vals);
        return { key: cat, value: d3.median(vals) || 0 };
      });
      xDomain = sortAggregated(catPts, {
        sortBy: widget.sortBy, sortOrder: widget.sortOrder || 'asc',
        customOrder: widget.customSortOrder,
      }).map(d => d.key);
    }
    const subGroups = hasColorField ? [...subGroupSet] : [null];
    if (!xDomain.length) return;

    const allVals = [...groupMap.values()].flatMap(g => g.vals);
    const yExtent = d3.extent(allVals);

    // Color scale
    let colors;
    const colorDomain = hasColorField ? subGroups : xDomain;
    if (widget.colorMode === 'gradient' && !hasColorField) {
      const medians = xDomain.map(cat => d3.median(groupMap.get(cat)?.vals ?? []));
      const ext = [Math.min(...medians), Math.max(...medians)];
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1]);
      const medianMap = new Map(xDomain.map((cat, i) => [cat, medians[i]]));
      colors = d => seq(medianMap.get(d) ?? 0);
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, colorDomain, widget.dimensionColors);
    }
    const opacity = widget.opacity ?? 1;

    const yPad = (yExtent[1] - yExtent[0]) * 0.08 || 1;
    const xScale = d3.scaleBand().domain(xDomain).range([0, W]).padding(0.3);
    const yScale = d3.scaleLinear().domain([yExtent[0] - yPad, yExtent[1] + yPad]).range([H, 0]).nice();

    // Sub-group scale within each category band
    const bw = xScale.bandwidth();
    const subScale = hasColorField
      ? d3.scaleBand().domain(subGroups).range([0, bw]).padding(0.06)
      : null;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale))
      .call(styledAxis).selectAll('text').attr('transform', 'rotate(-25)').style('text-anchor', 'end');
    g.append('g').call(d3.axisLeft(yScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);

    // Seeded PRNG for jitter (used when no jitterField is set)
    const jitterRng = mulberry32(42);
    const useJitterField = !!widget.jitterField;

    for (const [, grp] of groupMap) {
      const vals = grp.vals;
      if (!vals.length) continue;

      const catX = xScale(grp.cat);
      let slotX, slotW;
      if (hasColorField) {
        slotX = catX + subScale(grp.sub);
        slotW = subScale.bandwidth();
      } else {
        slotX = catX;
        slotW = bw;
      }
      const cx = slotX + slotW / 2;
      const color = hasColorField ? colors(grp.sub) : colors(grp.cat);

      // KDE — Silverman's rule of thumb for bandwidth (data-space)
      const n = vals.length;
      const std = d3.deviation(vals) || 1;
      const iqr = (d3.quantile(vals, 0.75) - d3.quantile(vals, 0.25)) || std;
      const kdeBandwidth = n > 1
        ? 0.9 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2)
        : std || 1;
      const yDomain = yScale.domain();
      const kdePoints = d3.ticks(yDomain[0], yDomain[1], 50);
      const kde = kernelDensityEstimator(epanechnikovKernel(kdeBandwidth), kdePoints);
      const density = kde(vals);
      const maxDensity = d3.max(density, d => d[1]);
      const violinScale = d3.scaleLinear().domain([0, maxDensity]).range([0, slotW / 2 - 2]);

      const violinArea = d3.area()
        .x0(d => cx - violinScale(d[1])).x1(d => cx + violinScale(d[1]))
        .y(d => yScale(d[0]))
        .curve(d3.curveCatmullRom);

      const path = g.append('path').datum(density)
        .attr('fill', color).attr('opacity', 0).attr('d', violinArea);
      path.transition().duration(600).ease(d3.easeCubicOut).attr('opacity', opacity * 0.75);

      // Compute stats with configurable iqrMultiplier
      const stats = computeStats(vals, iqrMultiplier);

      path
        .on('mouseover', (ev) => {
          d3.select(ev.currentTarget).transition().duration(80).attr('opacity', 1);
          showTooltip(ev, <ViolinTip cat={grp.cat} sub={grp.sub} stats={stats} widget={widget} color={color} n={vals.length} iqrMultiplier={iqrMultiplier} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev) => {
          d3.select(ev.currentTarget).transition().duration(100).attr('opacity', opacity * 0.75);
          hideTooltip();
        })
        .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.xField, value: grp.cat }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null);

      // --- Mini box/whisker inside violin ---
      const boxW = Math.min(slotW * 0.18, 12);

      // Whisker lines (dashed)
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(stats.whiskerHigh)).attr('y2', yScale(stats.q3))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2').attr('opacity', 0.7);
      g.append('line').attr('x1', cx).attr('x2', cx)
        .attr('y1', yScale(stats.q1)).attr('y2', yScale(stats.whiskerLow))
        .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2').attr('opacity', 0.7);

      // Whisker caps
      g.append('line').attr('x1', cx - 4).attr('x2', cx + 4)
        .attr('y1', yScale(stats.whiskerHigh)).attr('y2', yScale(stats.whiskerHigh))
        .attr('stroke', color).attr('stroke-width', 1.5);
      g.append('line').attr('x1', cx - 4).attr('x2', cx + 4)
        .attr('y1', yScale(stats.whiskerLow)).attr('y2', yScale(stats.whiskerLow))
        .attr('stroke', color).attr('stroke-width', 1.5);

      // IQR box
      g.append('rect')
        .attr('x', cx - boxW / 2).attr('y', yScale(stats.q3))
        .attr('width', boxW).attr('height', Math.max(0, yScale(stats.q1) - yScale(stats.q3)))
        .attr('fill', '#fff').attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', 0)
        .transition().duration(600).attr('opacity', 0.9);

      // Median line
      g.append('line').attr('x1', cx - boxW / 2 - 3).attr('x2', cx + boxW / 2 + 3)
        .attr('y1', yScale(stats.median)).attr('y2', yScale(stats.median))
        .attr('stroke', color).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');

      // Q1 / Q3 tick marks on the box edges
      [stats.q1, stats.q3].forEach(qv => {
        g.append('line').attr('x1', cx - boxW / 2).attr('x2', cx + boxW / 2)
          .attr('y1', yScale(qv)).attr('y2', yScale(qv))
          .attr('stroke', color).attr('stroke-width', 1).attr('opacity', 0.5);
      });

      // Data points & outliers
      // Per-group jitter scale when jitterField is set (min/max per violin)
      let grpJitterScale;
      if (useJitterField) {
        const jVals = grp.rows.map(r => +r[widget.jitterField]).filter(v => !isNaN(v));
        const jExt = d3.extent(jVals);
        grpJitterScale = jExt[0] === jExt[1]
          ? () => 0
          : d3.scaleLinear().domain(jExt).range([-0.45, 0.45]);
      }
      if (widget.showDataPoints !== false) {
        // Show all values as jittered semi-transparent dots with tooltips
        // (outliers are included here, so we skip the separate outlier layer)
        vals.forEach((v, i) => {
          const row = grp.rows[i];
          const isOutlier = v < stats.whiskerLow || v > stats.whiskerHigh;
          const jx = useJitterField
            ? grpJitterScale(+row[widget.jitterField] || 0) * slotW
            : (jitterRng() - 0.5) * slotW * 0.7;
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
              showTooltip(ev, <PointTip row={row} widget={widget} value={v} color={color} cat={grp.cat} sub={grp.sub} />);
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
        stats.outliers.forEach(v => {
          g.append('circle')
            .attr('cx', cx + (jitterRng() - 0.5) * slotW * 0.7)
            .attr('cy', yScale(v))
            .attr('r', 2.5).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.2).attr('opacity', opacity * 0.7);
        });
      }
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
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 52).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-44,${H / 2}) rotate(-90)`).text(widget.yField);
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

function computeStats(vals, iqrMultiplier = 1.5) {
  const sorted = [...vals].sort(d3.ascending);
  const q1 = d3.quantile(sorted, 0.25);
  const median = d3.quantile(sorted, 0.5);
  const q3 = d3.quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loBound = q1 - iqrMultiplier * iqr;
  const hiBound = q3 + iqrMultiplier * iqr;
  // Whiskers extend to the most extreme data point within bounds
  const inRange = sorted.filter(v => v >= loBound && v <= hiBound);
  const whiskerLow = inRange.length ? inRange[0] : q1;
  const whiskerHigh = inRange.length ? inRange[inRange.length - 1] : q3;
  const outliers = sorted.filter(v => v < loBound || v > hiBound);
  const mean = d3.mean(sorted);
  const std = d3.deviation(sorted);
  return { q1, median, q3, iqr, whiskerLow, whiskerHigh, outliers, mean, std };
}

function kernelDensityEstimator(kernel, X) {
  return function (V) {
    return X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
  };
}

function epanechnikovKernel(bandwidth) {
  return function (u) {
    u = u / bandwidth;
    return Math.abs(u) <= 1 ? 0.75 * (1 - u * u) / bandwidth : 0;
  };
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

function ViolinTip({ cat, sub, stats, widget, color, n, iqrMultiplier }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {cat}{sub != null ? ` / ${sub}` : ''}
      </div>
      {[
        ['n', n.toLocaleString()],
        ['Mean', formatValue(stats.mean)],
        ['Median', formatValue(stats.median)],
        ['Std dev', formatValue(stats.std)],
        ['Q1', formatValue(stats.q1)],
        ['Q3', formatValue(stats.q3)],
        ['IQR', formatValue(stats.iqr)],
        ['IQR mult', String(iqrMultiplier)],
        ['Outliers', String(stats.outliers.length)],
      ].map(([label, val]) => (
        <div key={label} className="chart-tooltip-row">
          <span className="tt-label">{label}</span>
          <span className="tt-value">{val}</span>
        </div>
      ))}
    </>
  );
}
