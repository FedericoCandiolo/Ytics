import { useRef, useEffect, useCallback, useId } from 'react';
import * as d3 from 'd3';
import { formatValue, linearRegression, aggregate } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getPrimaryColor, getSequentialScale, resolveGradient, getColorArray } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

/* ── Quadratic (degree-2 polynomial) least-squares fit ──────────────────────
   Solves the normal equations for y = a*x² + b*x + c via a 3×3 system.
   Returns { coeffs: [a, b, c], r2 } */
function polynomialRegression2(points) {
  const n = points.length;
  if (n < 3) return null;

  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (const { x, y } of points) {
    const x2 = x * x;
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
    t0 += y; t1 += x * y; t2 += x2 * y;
  }

  // Solve 3×3 via Cramer's rule:
  // | s4 s3 s2 | |a|   |t2|
  // | s3 s2 s1 | |b| = |t1|
  // | s2 s1 s0 | |c|   |t0|
  const M = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, s0],
  ];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const D = det3(M);
  if (Math.abs(D) < 1e-12) return null;

  const replaceCol = (m, col, v) => m.map((row, i) => row.map((c, j) => (j === col ? v[i] : c)));
  const rhs = [t2, t1, t0];
  const a = det3(replaceCol(M, 0, rhs)) / D;
  const b = det3(replaceCol(M, 1, rhs)) / D;
  const c = det3(replaceCol(M, 2, rhs)) / D;

  const meanY = t0 / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    ssTot += (y - meanY) ** 2;
    ssRes += (y - (a * x * x + b * x + c)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { coeffs: [a, b, c], r2 };
}

/* ── Draw a single regression line/curve into the provided d3 group ──────── */
function drawRegression(g, pts, xScale, yScale, W, H, regressionType, strokeColor, showLabel, clipId) {
  if (pts.length < 2) return;
  const points = pts.map(d => ({ x: d.x, y: d.y }));
  const [x0, x1] = xScale.domain();

  if (regressionType === 'polynomial') {
    const result = polynomialRegression2(points);
    if (!result) return;
    const { coeffs: [a, b, c], r2 } = result;

    // Generate curve as a path with ~60 sample points
    const step = (x1 - x0) / 60;
    const curvePoints = [];
    for (let x = x0; x <= x1 + step * 0.5; x += step) {
      const y = a * x * x + b * x + c;
      curvePoints.push([xScale(x), yScale(y)]);
    }
    const line = d3.line().curve(d3.curveBasis);
    g.append('path')
      .attr('d', line(curvePoints))
      .attr('fill', 'none')
      .attr('stroke', strokeColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('opacity', 0.55)
      .attr('clip-path', `url(#${clipId})`);

    if (showLabel) {
      // Place R² label at the midpoint of the curve
      const midX = (x0 + x1) / 2;
      const midY = a * midX * midX + b * midX + c;
      g.append('text')
        .attr('x', xScale(midX) + 4)
        .attr('y', yScale(midY) - 6)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font)')
        .attr('fill', strokeColor)
        .attr('opacity', 0.8)
        .text(`R²=${r2.toFixed(3)}`);
    }
  } else {
    // Linear (default)
    const { slope, intercept, r2 } = linearRegression(points);
    const y0 = slope * x0 + intercept;
    const y1v = slope * x1 + intercept;

    g.append('line')
      .attr('x1', xScale(x0)).attr('y1', yScale(y0))
      .attr('x2', xScale(x1)).attr('y2', yScale(y1v))
      .attr('stroke', strokeColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('opacity', 0.55)
      .attr('clip-path', `url(#${clipId})`);

    if (showLabel) {
      // Place R² near the right end of the line
      const labelX = x0 + (x1 - x0) * 0.75;
      const labelY = slope * labelX + intercept;
      g.append('text')
        .attr('x', xScale(labelX) + 4)
        .attr('y', yScale(labelY) - 6)
        .attr('font-size', 10)
        .attr('font-family', 'var(--font)')
        .attr('fill', strokeColor)
        .attr('opacity', 0.8)
        .text(`R²=${r2.toFixed(3)}`);
    }
  }
}

export default function ScatterPlot({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();
  const reactId = useId();
  const clipId = `scatter-clip-${reactId.replace(/:/g, '')}`;

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const _overlayFields = (widget.scatterOverlayFields || []).filter(Boolean);
    const _ptType = widget.scatterPointType || 'circle';
    const _oSrc = widget.scatterOverlaySource || 'fields';
    const _useMini = (_ptType === 'pie' || _ptType === 'bar') && (
      (_oSrc === 'fields' && _overlayFields.length > 1) ||
      (_oSrc === 'dimension' && widget.colorField)
    );
    const needsLegend = _useMini || (widget.showLegend && widget.colorField);
    const m = { top: 16, right: needsLegend ? 110 : 20, bottom: 52, left: 62 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const pts = data.map(d => ({
      x: +d[widget.xField], y: +d[widget.yField],
      color: widget.colorField ? String(d[widget.colorField] ?? '') : null,
      size: widget.sizeField ? +d[widget.sizeField] || 0 : null,
      label: widget.labelField ? String(d[widget.labelField] ?? '') : null,
      raw: d,
    })).filter(d => !isNaN(d.x) && !isNaN(d.y));

    if (!pts.length) return;

    const opacity = widget.opacity ?? 0.8;
    const categories = widget.colorField ? [...new Set(pts.map(d => d.color))] : [];
    const colors = widget.colorField ? getColorScaleWithOverrides(widget.colorScheme, categories, widget.dimensionColors) : null;
    const primaryColor = getPrimaryColor(widget.colorScheme);

    // Gradient mode: color by a numeric field
    let gradientFn;
    if (widget.colorMode === 'gradient') {
      const gradField = widget.colorGradientField || widget.yField;
      const gradVals = pts.map(d => gradField === widget.yField ? d.y : (+d.raw[gradField] || 0));
      const ext = d3.extent(gradVals);
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, ext[0], ext[1], widget.invertGradient);
      gradientFn = (d) => {
        const val = gradField === widget.yField ? d.y : (+d.raw[gradField] || 0);
        return seq(val);
      };
    }

    const sMin = widget.dotSizeMin ?? 4, sMax = widget.dotSizeMax ?? 20;
    const sizeExt = widget.sizeField ? d3.extent(pts, d => d.size) : [1, 1];
    const sizeScale = d3.scaleSqrt().domain(sizeExt).range([sMin, sMax]).clamp(true);

    // ── Pre-compute mini chart grouping (needed before scales) ──
    const overlayFields = (widget.scatterOverlayFields || []).filter(Boolean);
    const pointType = widget.scatterPointType || 'circle';
    const overlaySource = widget.scatterOverlaySource || 'fields';
    const useMiniFields = (pointType === 'pie' || pointType === 'bar') && overlaySource === 'fields' && overlayFields.length > 0;
    const useMiniDim = (pointType === 'pie' || pointType === 'bar') && overlaySource === 'dimension' && widget.colorField;
    const useMiniCharts = useMiniFields || useMiniDim;
    const paletteColors = getColorArray(widget.colorScheme);
    let sliceLegendLabels;
    let ptsWithSlices;

    if (useMiniCharts) {
      if (useMiniDim) {
        const groupField = widget.labelField || widget.xField;
        const groups = new Map();
        for (const d of pts) {
          const key = String(d.raw[groupField] ?? '');
          if (!groups.has(key)) groups.set(key, { pts: [], breakdown: new Map() });
          const grp = groups.get(key);
          grp.pts.push(d);
          const dimVal = d.color || '';
          if (!grp.breakdown.has(dimVal)) grp.breakdown.set(dimVal, []);
          grp.breakdown.get(dimVal).push(d.y);
        }
        const allDimVals = new Set();
        for (const [, grp] of groups) for (const k of grp.breakdown.keys()) allDimVals.add(k);
        sliceLegendLabels = [...allDimVals];

        ptsWithSlices = [];
        for (const [key, grp] of groups) {
          const avgX = d3.mean(grp.pts, p => p.x);
          const avgY = d3.mean(grp.pts, p => p.y);
          const avgSize = widget.sizeField ? d3.mean(grp.pts, p => p.size) : null;
          const slices = sliceLegendLabels.map(dv => ({
            label: dv,
            value: aggregate(grp.breakdown.get(dv) || [], widget.aggregation || 'sum'),
          }));
          ptsWithSlices.push({
            x: avgX, y: avgY, size: avgSize,
            label: key, slices, raw: grp.pts[0].raw,
          });
        }
      } else {
        sliceLegendLabels = overlayFields;
        ptsWithSlices = pts.map(d => ({
          ...d,
          slices: overlayFields.map(f => ({ label: f, value: +d.raw[f] || 0 })),
        }));
      }
    }

    // ── Scales: use grouped points when in dimension mode ──
    const scalePts = (useMiniDim && ptsWithSlices) ? ptsWithSlices : pts;
    const xScale = d3.scaleLinear().domain(d3.extent(scalePts, d => d.x)).range([0, W]).nice();
    const yScale = d3.scaleLinear().domain(d3.extent(scalePts, d => d.y)).range([H, 0]).nice();

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('rect').attr('width', W).attr('height', H);
    g.attr('clip-path', null);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
      g.append('g').call(d3.axisBottom(xScale).tickSize(-H).tickFormat(''))
        .attr('transform', `translate(0,${H})`)
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

    // ── Regression lines ──
    const regressionType = widget.regressionType || 'linear';
    if (widget.showRegression) {
      if (widget.colorField && categories.length > 0) {
        for (const cat of categories) {
          const groupPts = pts.filter(d => d.color === cat);
          if (groupPts.length >= 2) {
            const color = colors(cat);
            drawRegression(g, groupPts, xScale, yScale, W, H, regressionType, color, true, clipId);
          }
        }
      } else {
        const color = gradientFn ? '#888' : 'var(--chart-axis-color)';
        drawRegression(g, pts, xScale, yScale, W, H, regressionType, color, true, clipId);
      }
    }

    // ── Connected scatterplot: draw lines between points ──
    // Build a map: point → { prev, next } neighbors in sorted connection order
    const connNeighbors = new Map();
    let connHighG;
    if (widget.connectPoints && !useMiniCharts) {
      const strategy = widget.connectionStrategy || 'x';
      const orderField = widget.connectionOrderField;

      const sortGroup = (group) => {
        const sorted = [...group];
        if (strategy === 'x') {
          sorted.sort((a, b) => a.x - b.x);
        } else if (strategy === 'y') {
          sorted.sort((a, b) => a.y - b.y);
        } else if (strategy === 'field' && orderField) {
          sorted.sort((a, b) => {
            const va = a.raw[orderField], vb = b.raw[orderField];
            if (va instanceof Date || !isNaN(Date.parse(va))) return new Date(va) - new Date(vb);
            if (!isNaN(+va)) return +va - +vb;
            return String(va).localeCompare(String(vb));
          });
        } else if (strategy === 'trendline') {
          const reg = linearRegression(sorted.map(d => ({ x: d.x, y: d.y })));
          const dx = 1, dy = reg.slope;
          const len = Math.sqrt(dx * dx + dy * dy);
          sorted.sort((a, b) => {
            const projA = (a.x * dx + a.y * dy) / len;
            const projB = (b.x * dx + b.y * dy) / len;
            return projA - projB;
          });
        } else if (strategy === 'angle') {
          if (sorted.length > 2) {
            const used = new Set();
            const result = [sorted[0]];
            used.add(0);
            for (let step = 1; step < sorted.length; step++) {
              const prev = result[result.length - 1];
              const prev2 = result.length > 1 ? result[result.length - 2] : null;
              let bestIdx = -1, bestScore = Infinity;
              for (let j = 0; j < sorted.length; j++) {
                if (used.has(j)) continue;
                const cand = sorted[j];
                if (prev2) {
                  const ax = prev.x - prev2.x, ay = prev.y - prev2.y;
                  const bx = cand.x - prev.x, by = cand.y - prev.y;
                  const dot = ax * bx + ay * by;
                  const cross = ax * by - ay * bx;
                  const angle = Math.abs(Math.atan2(cross, dot));
                  if (angle < bestScore) { bestScore = angle; bestIdx = j; }
                } else {
                  const dist = (cand.x - prev.x) ** 2 + (cand.y - prev.y) ** 2;
                  if (dist < bestScore) { bestScore = dist; bestIdx = j; }
                }
              }
              if (bestIdx >= 0) { result.push(sorted[bestIdx]); used.add(bestIdx); }
            }
            sorted.length = 0;
            sorted.push(...result);
          }
        }
        return sorted;
      };

      const lineGen = d3.line()
        .x(d => xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveMonotoneX);

      const connG = g.append('g').attr('class', 'scatter-connections').attr('clip-path', `url(#${clipId})`);
      const connWidth = widget.connectionWidth ?? 1.5;
      const connOpacity = widget.connectionOpacity ?? 0.5;

      const registerNeighbors = (sorted) => {
        for (let i = 0; i < sorted.length; i++) {
          connNeighbors.set(sorted[i], {
            prev: i > 0 ? sorted[i - 1] : null,
            next: i < sorted.length - 1 ? sorted[i + 1] : null,
          });
        }
      };

      if (widget.colorField && categories.length > 0) {
        for (const cat of categories) {
          const groupPts = sortGroup(pts.filter(d => d.color === cat));
          if (groupPts.length < 2) continue;
          registerNeighbors(groupPts);
          connG.append('path')
            .datum(groupPts)
            .attr('d', lineGen)
            .attr('fill', 'none')
            .attr('stroke', colors(cat))
            .attr('stroke-width', connWidth)
            .attr('stroke-opacity', connOpacity);
        }
      } else {
        const sorted = sortGroup(pts);
        if (sorted.length >= 2) {
          registerNeighbors(sorted);
          connG.append('path')
            .datum(sorted)
            .attr('d', lineGen)
            .attr('fill', 'none')
            .attr('stroke', gradientFn ? '#888' : primaryColor)
            .attr('stroke-width', connWidth)
            .attr('stroke-opacity', connOpacity);
        }
      }

      // Highlight overlay group (drawn above dots later)
      connHighG = g.append('g').attr('class', 'scatter-conn-highlight').attr('clip-path', `url(#${clipId})`);
    }

    // ── Draw points ──
    if (useMiniCharts) {
      const pie = d3.pie().value(d => Math.abs(d.value)).sort(null);

      ptsWithSlices.forEach((d) => {
        const cx = xScale(d.x), cy = yScale(d.y);
        const r = widget.sizeField ? sizeScale(d.size) : sMin + 4;
        const total = d.slices.reduce((s, sl) => s + Math.abs(sl.value), 0);
        if (total === 0) return;

        const pg = g.append('g').attr('transform', `translate(${cx},${cy})`);

        if (pointType === 'pie') {
          const arc = d3.arc().innerRadius(0).outerRadius(r);
          pg.selectAll('path').data(pie(d.slices)).join('path')
            .attr('d', arc)
            .attr('fill', (_, j) => paletteColors[j % paletteColors.length])
            .attr('stroke', '#fff').attr('stroke-width', 0.5)
            .attr('opacity', opacity);
        } else {
          const maxSlice = Math.max(...d.slices.map(s => Math.abs(s.value)));
          const barScale = maxSlice > 0 ? r / maxSlice : 1;
          const segW = (r * 1.6) / d.slices.length;
          const startX = -(r * 0.8);
          d.slices.forEach((sl, j) => {
            const barH = Math.abs(sl.value) * barScale;
            pg.append('rect')
              .attr('x', startX + j * segW)
              .attr('y', -barH)
              .attr('width', Math.max(1, segW - 1))
              .attr('height', barH)
              .attr('fill', paletteColors[j % paletteColors.length])
              .attr('stroke', '#fff').attr('stroke-width', 0.3)
              .attr('opacity', opacity);
          });
        }

        pg.append('circle').attr('r', r + 2).attr('fill', 'transparent')
          .style('cursor', onCrossFilter ? 'pointer' : 'default')
          .on('mouseover', (ev) => {
            pg.raise();
            showTooltip(ev, <MiniChartTip d={d} widget={widget} slices={d.slices} />);
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip)
          .on('click', onCrossFilter ? (ev) => { ev.stopPropagation(); onCrossFilter({ field: widget.colorField || widget.xField, value: d.color || d.raw[widget.xField] }); } : null);
      });
    } else {
      // Standard circles
      const dots = g.selectAll('.dot').data(pts).join('circle').attr('class', 'dot')
        .attr('cx', d => xScale(d.x)).attr('cy', d => yScale(d.y))
        .attr('r', 0)
        .attr('fill', d => gradientFn ? gradientFn(d) : widget.colorField ? colors(d.color) : primaryColor)
        .attr('opacity', opacity).attr('stroke', 'rgba(255,255,255,.6)').attr('stroke-width', 1);

      dots.transition().duration(400).delay((_, i) => i * 0.5).ease(d3.easeCubicOut)
        .attr('r', d => widget.sizeField ? sizeScale(d.size) : sMin + 2);

      dots
        .on('mouseover', (ev, d) => {
          d3.select(ev.currentTarget).raise().transition().duration(80)
            .attr('r', (widget.sizeField ? sizeScale(d.size) : sMin + 2) * 1.5)
            .attr('opacity', 1).attr('stroke-width', 2.5);
          // Highlight connected neighbors
          const nb = connNeighbors.get(d);
          if (nb && connHighG) {
            connHighG.selectAll('*').remove();
            const baseR = widget.sizeField ? sizeScale(d.size) : sMin + 2;
            const highlightColor = gradientFn ? '#333' : widget.colorField ? colors(d.color) : primaryColor;
            const neighbors = [nb.prev, nb.next].filter(Boolean);
            for (const n of neighbors) {
              connHighG.append('line')
                .attr('x1', xScale(d.x)).attr('y1', yScale(d.y))
                .attr('x2', xScale(n.x)).attr('y2', yScale(n.y))
                .attr('stroke', highlightColor)
                .attr('stroke-width', (widget.connectionWidth ?? 1.5) + 2)
                .attr('stroke-opacity', 0.85)
                .attr('stroke-linecap', 'round');
              const nr = widget.sizeField ? sizeScale(n.size) : sMin + 2;
              connHighG.append('circle')
                .attr('cx', xScale(n.x)).attr('cy', yScale(n.y))
                .attr('r', nr * 1.3)
                .attr('fill', gradientFn ? gradientFn(n) : widget.colorField ? colors(n.color) : primaryColor)
                .attr('opacity', 1)
                .attr('stroke', '#fff').attr('stroke-width', 2);
            }
            // Highlight hovered dot on top
            connHighG.append('circle')
              .attr('cx', xScale(d.x)).attr('cy', yScale(d.y))
              .attr('r', baseR * 1.5)
              .attr('fill', gradientFn ? gradientFn(d) : widget.colorField ? colors(d.color) : primaryColor)
              .attr('opacity', 1)
              .attr('stroke', '#fff').attr('stroke-width', 2.5);
          }
          showTooltip(ev, <ScatterTip d={d} widget={widget} color={gradientFn ? gradientFn(d) : widget.colorField ? colors(d.color) : primaryColor} />);
        })
        .on('mousemove', moveTooltip)
        .on('mouseleave', (ev, d) => {
          d3.select(ev.currentTarget).transition().duration(120)
            .attr('r', widget.sizeField ? sizeScale(d.size) : sMin + 2)
            .attr('opacity', opacity).attr('stroke-width', 1);
          if (connHighG) connHighG.selectAll('*').remove();
          hideTooltip();
        })
        .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.colorField || widget.xField, value: d[widget.colorField || widget.xField] }); } : null)
        .style('cursor', onCrossFilter ? 'pointer' : null);
    }

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 44).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-46,${H / 2}) rotate(-90)`).text(widget.yField);

    // Legend
    if (useMiniCharts && sliceLegendLabels && sliceLegendLabels.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
      sliceLegendLabels.slice(0, 12).forEach((f, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('rect').attr('x', 0).attr('y', 0).attr('width', 12).attr('height', 12).attr('rx', 2)
          .attr('fill', paletteColors[i % paletteColors.length]);
        row.append('text').attr('x', 16).attr('y', 10).attr('font-size', 10.5).attr('font-family', 'var(--font)')
          .attr('fill', 'var(--text-muted)').text(f.length > 13 ? f.slice(0, 13) + '…' : f);
      });
    } else if (widget.showLegend && widget.colorField && categories.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
      categories.slice(0, 10).forEach((cat, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('circle').attr('cx', 5).attr('cy', 6).attr('r', 5).attr('fill', colors(cat)).attr('opacity', opacity);
        row.append('text').attr('x', 14).attr('y', 10).attr('font-size', 10.5).attr('font-family', 'var(--font)')
          .attr('fill', 'var(--text-muted)').text(cat.length > 13 ? cat.slice(0, 13) + '…' : cat);
      });
    }
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter, clipId]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select numeric X and Y fields" />}
    </div>
  );
}

function ScatterTip({ d, widget, color }) {
  const title = d.label || d.color || 'Data point';
  const showColorRow = d.label && d.color && d.label !== d.color;
  return (
    <>
      <div className="chart-tooltip-title">
        {(d.label || widget.colorField)
          ? <><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />{title}</>
          : title
        }
      </div>
      {showColorRow && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.colorField}</span>
          <span className="tt-value">{d.color}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.xField}</span>
        <span className="tt-value">{formatValue(d.x, widget.numberFormat)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.yField}</span>
        <span className="tt-value">{formatValue(d.y, widget.numberFormat)}</span>
      </div>
      {widget.sizeField && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField}</span>
          <span className="tt-value">{formatValue(d.size, widget.numberFormat)}</span>
        </div>
      )}
    </>
  );
}

function MiniChartTip({ d, widget, slices }) {
  const title = d.label || d.color || 'Data point';
  return (
    <>
      <div className="chart-tooltip-title">{title}</div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.xField}</span>
        <span className="tt-value">{formatValue(d.x, widget.numberFormat)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.yField}</span>
        <span className="tt-value">{formatValue(d.y, widget.numberFormat)}</span>
      </div>
      {slices.map((s, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="tt-label">{s.label}</span>
          <span className="tt-value">{formatValue(s.value, widget.numberFormat)}</span>
        </div>
      ))}
    </>
  );
}
