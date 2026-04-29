/**
 * Correlogram — correlation matrix for numeric and/or categorical variables.
 * Auto-detects column types and picks the right statistic per cell pair:
 *   - numeric × numeric  → Pearson r  (diverging, -1 to +1)
 *   - numeric × categorical → Eta η (correlation ratio, 0 to 1)
 *   - categorical × categorical → Cramér's V (0 to 1)
 *
 * Three cell modes: circles, scatter/box/heatmap, text.
 * Diagonal: histogram for numeric, bar chart for categorical.
 */
import { useRef, useEffect, useCallback, useId } from 'react';
import * as d3 from 'd3';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';
import { getPrimaryColor, getColorArray } from '../../utils/colorUtils';

/* ── Statistical helpers ─────────────────────────────────────────────────── */

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxy += xs[i] * ys[i];
    sx2 += xs[i] * xs[i];
    sy2 += ys[i] * ys[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  return den === 0 ? 0 : num / den;
}

/** Eta (correlation ratio): how much of numeric variance is explained by categorical groups. */
function eta(categories, numerics) {
  const n = categories.length;
  if (n < 3) return 0;
  const groups = new Map();
  let grandSum = 0;
  for (let i = 0; i < n; i++) {
    const cat = categories[i];
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(numerics[i]);
    grandSum += numerics[i];
  }
  const grandMean = grandSum / n;
  let ssBetween = 0, ssTotal = 0;
  for (const vals of groups.values()) {
    const groupMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    ssBetween += vals.length * (groupMean - grandMean) ** 2;
  }
  for (let i = 0; i < n; i++) {
    ssTotal += (numerics[i] - grandMean) ** 2;
  }
  return ssTotal === 0 ? 0 : Math.sqrt(ssBetween / ssTotal);
}

/** Cramér's V: association between two categorical variables via chi-squared. */
function cramersV(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  // Build contingency table
  const xCats = [...new Set(xs)];
  const yCats = [...new Set(ys)];
  const k = xCats.length, r = yCats.length;
  if (k < 2 || r < 2) return 0;
  const xIdx = new Map(xCats.map((c, i) => [c, i]));
  const yIdx = new Map(yCats.map((c, i) => [c, i]));
  const table = Array.from({ length: k }, () => new Array(r).fill(0));
  for (let i = 0; i < n; i++) table[xIdx.get(xs[i])][yIdx.get(ys[i])]++;
  const rowSums = table.map(row => row.reduce((a, b) => a + b, 0));
  const colSums = new Array(r).fill(0);
  for (let j = 0; j < r; j++) for (let i = 0; i < k; i++) colSums[j] += table[i][j];
  let chi2 = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < r; j++) {
      const expected = (rowSums[i] * colSums[j]) / n;
      if (expected > 0) chi2 += (table[i][j] - expected) ** 2 / expected;
    }
  }
  const minDim = Math.min(k, r) - 1;
  return minDim === 0 ? 0 : Math.sqrt(chi2 / (n * minDim));
}

/** Detect if a field is numeric by sampling data. */
function isNumericField(data, field) {
  let numCount = 0, total = 0;
  for (const d of data) {
    const v = d[field];
    if (v === null || v === undefined || v === '') continue;
    total++;
    if (!isNaN(+v)) numCount++;
    if (total >= 100) break;
  }
  return total > 0 && numCount / total > 0.8;
}

export default function Correlogram({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();
  const reactId = useId();
  const uid = reactId.replace(/:/g, '');

  const render = useCallback(() => {
    const { w, h } = dims;
    const fields = (widget.correlogramFields || []).filter(Boolean);
    if (!data?.length || fields.length < 2 || w < 60 || h < 60) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const nf = fields.length;
    const cellMode = widget.correlogramMode || 'circles';
    const opacity = widget.opacity ?? 0.85;
    const primaryColor = getPrimaryColor(widget.colorScheme);
    const palette = getColorArray(widget.colorScheme);

    // Detect types
    const fieldType = {};
    for (const f of fields) fieldType[f] = isNumericField(data, f) ? 'num' : 'cat';

    // Margins
    const labelSize = Math.min(80, Math.max(30, w / (nf + 2)));
    const m = { top: labelSize, right: 16, bottom: 28, left: labelSize };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const cellW = W / nf;
    const cellH = H / nf;
    const pad = 3;

    // Precompute paired stats
    const cellData = {};
    for (let i = 0; i < nf; i++) {
      for (let j = 0; j < nf; j++) {
        if (i === j) continue;
        const fi = fields[i], fj = fields[j];
        const ti = fieldType[fi], tj = fieldType[fj];
        const key = `${i}-${j}`;

        if (ti === 'num' && tj === 'num') {
          // Pearson
          const xs = [], ys = [];
          for (const d of data) {
            const vx = +d[fi], vy = +d[fj];
            if (!isNaN(vx) && !isNaN(vy)) { xs.push(vx); ys.push(vy); }
          }
          cellData[key] = { kind: 'pearson', xs, ys, value: pearson(xs, ys), n: xs.length, signed: true };
        } else if (ti === 'num' && tj === 'cat') {
          // Eta: categorical fj groups, numeric fi values
          const cats = [], nums = [];
          for (const d of data) {
            const vn = +d[fi], vc = d[fj];
            if (!isNaN(vn) && vc !== null && vc !== undefined && vc !== '') { nums.push(vn); cats.push(String(vc)); }
          }
          cellData[key] = { kind: 'eta', cats, nums, value: eta(cats, nums), n: cats.length, signed: false };
        } else if (ti === 'cat' && tj === 'num') {
          // Eta: categorical fi groups, numeric fj values
          const cats = [], nums = [];
          for (const d of data) {
            const vn = +d[fj], vc = d[fi];
            if (!isNaN(vn) && vc !== null && vc !== undefined && vc !== '') { nums.push(vn); cats.push(String(vc)); }
          }
          cellData[key] = { kind: 'eta', cats, nums, value: eta(cats, nums), n: cats.length, signed: false };
        } else {
          // Cramér's V
          const xs = [], ys = [];
          for (const d of data) {
            const vx = d[fi], vy = d[fj];
            if (vx !== null && vx !== undefined && vx !== '' && vy !== null && vy !== undefined && vy !== '') {
              xs.push(String(vx)); ys.push(String(vy));
            }
          }
          cellData[key] = { kind: 'cramer', xs, ys, value: cramersV(xs, ys), n: xs.length, signed: false };
        }
      }
    }

    // Color scales
    const corrColor = d3.scaleSequential(d3.interpolateRdBu).domain([1, -1]);   // diverging for Pearson
    const assocColor = d3.scaleSequential(d3.interpolateOranges).domain([0, 1]); // sequential for unsigned

    const getCellColor = (cell) => cell.signed ? corrColor(cell.value) : assocColor(cell.value);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Column headers
    for (let j = 0; j < nf; j++) {
      const f = fields[j];
      const label = f.length > 12 ? f.slice(0, 11) + '\u2026' : f;
      const typeTag = fieldType[f] === 'num' ? ' #' : ' A';
      g.append('text')
        .attr('x', j * cellW + cellW / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('font-size', Math.min(11, cellW * 0.22))
        .attr('font-family', 'var(--font)')
        .attr('fill', 'var(--chart-axis-color)')
        .text(label + typeTag);
    }

    // Row headers
    for (let i = 0; i < nf; i++) {
      const f = fields[i];
      const label = f.length > 12 ? f.slice(0, 11) + '\u2026' : f;
      const typeTag = fieldType[f] === 'num' ? ' #' : ' A';
      g.append('text')
        .attr('x', -8)
        .attr('y', i * cellH + cellH / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', Math.min(11, cellH * 0.22))
        .attr('font-family', 'var(--font)')
        .attr('fill', 'var(--chart-axis-color)')
        .text(label + typeTag);
    }

    // ── Draw cells ──
    for (let i = 0; i < nf; i++) {
      for (let j = 0; j < nf; j++) {
        const cx = j * cellW;
        const cy = i * cellH;
        const cellG = g.append('g').attr('transform', `translate(${cx},${cy})`);

        // Background
        cellG.append('rect')
          .attr('width', cellW).attr('height', cellH)
          .attr('fill', 'var(--bg)')
          .attr('stroke', 'var(--chart-grid-color)')
          .attr('stroke-width', 0.5);

        if (i === j) {
          // ── Diagonal ──
          const f = fields[i];
          if (fieldType[f] === 'num') {
            // Histogram
            const vals = data.map(d => +d[f]).filter(v => !isNaN(v));
            if (vals.length < 2) continue;
            const ext = d3.extent(vals);
            const bins = d3.bin().domain(ext).thresholds(Math.min(15, Math.max(5, Math.floor(cellW / 6))))(vals);
            const maxCount = d3.max(bins, b => b.length) || 1;
            const hx = d3.scaleLinear().domain(ext).range([pad, cellW - pad]);
            const hy = d3.scaleLinear().domain([0, maxCount]).range([cellH - pad, pad + 12]);

            bins.forEach(bin => {
              cellG.append('rect')
                .attr('x', hx(bin.x0))
                .attr('y', hy(bin.length))
                .attr('width', Math.max(1, hx(bin.x1) - hx(bin.x0) - 1))
                .attr('height', cellH - pad - hy(bin.length))
                .attr('fill', primaryColor)
                .attr('opacity', 0.6);
            });
          } else {
            // Bar chart of top categories
            const counts = new Map();
            for (const d of data) {
              const v = d[f];
              if (v === null || v === undefined || v === '') continue;
              const s = String(v);
              counts.set(s, (counts.get(s) || 0) + 1);
            }
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
            if (sorted.length === 0) continue;
            const maxC = sorted[0][1];
            const barH = Math.max(2, (cellH - pad * 2 - 12) / sorted.length - 1);
            const bx = d3.scaleLinear().domain([0, maxC]).range([0, cellW - pad * 2 - 4]);

            sorted.forEach(([cat, count], k) => {
              cellG.append('rect')
                .attr('x', pad + 2)
                .attr('y', pad + 12 + k * (barH + 1))
                .attr('width', bx(count))
                .attr('height', barH)
                .attr('fill', palette[k % palette.length])
                .attr('opacity', 0.7);
            });
          }
          // Label on diagonal
          cellG.append('text')
            .attr('x', cellW / 2).attr('y', pad + 10)
            .attr('text-anchor', 'middle')
            .attr('font-size', Math.min(9, cellW * 0.16))
            .attr('font-family', 'var(--font)')
            .attr('fill', 'var(--text-muted)')
            .text(f.length > 8 ? f.slice(0, 7) + '\u2026' : f);

        } else {
          // ── Off-diagonal ──
          const key = `${i}-${j}`;
          const cell = cellData[key];
          const absV = Math.abs(cell.value);
          const bgColor = getCellColor(cell);

          if (cellMode === 'circles') {
            cellG.select('rect').attr('fill', bgColor).attr('opacity', 0.15 + absV * 0.55);
            const maxR = Math.min(cellW, cellH) / 2 - pad - 1;
            cellG.append('circle')
              .attr('cx', cellW / 2).attr('cy', cellH / 2)
              .attr('r', maxR * absV)
              .attr('fill', bgColor)
              .attr('opacity', opacity)
              .attr('stroke', 'rgba(255,255,255,.4)')
              .attr('stroke-width', 0.5);
            if (cellW > 30) {
              cellG.append('text')
                .attr('x', cellW / 2).attr('y', cellH / 2 + 3)
                .attr('text-anchor', 'middle')
                .attr('font-size', Math.min(10, cellW * 0.18))
                .attr('font-weight', 600)
                .attr('font-family', 'var(--font)')
                .attr('fill', absV > 0.5 ? '#fff' : 'var(--chart-axis-color)')
                .text(cell.value.toFixed(2));
            }

          } else if (cellMode === 'scatter') {
            // Adaptive visualization based on types
            if (cell.kind === 'pearson') {
              // Mini scatterplot
              const { xs, ys } = cell;
              if (xs.length < 2) continue;
              const sx = d3.scaleLinear().domain(d3.extent(xs)).range([pad + 2, cellW - pad - 2]);
              const sy = d3.scaleLinear().domain(d3.extent(ys)).range([cellH - pad - 2, pad + 2]);
              const dotR = Math.max(1, Math.min(2.5, cellW / 30));
              const maxDots = Math.min(xs.length, 200);
              const step = Math.max(1, Math.floor(xs.length / maxDots));
              for (let k = 0; k < xs.length; k += step) {
                cellG.append('circle')
                  .attr('cx', sx(xs[k])).attr('cy', sy(ys[k]))
                  .attr('r', dotR)
                  .attr('fill', corrColor(cell.value))
                  .attr('opacity', 0.5);
              }
            } else if (cell.kind === 'eta') {
              // Strip/box plot: categorical groups on x, numeric on y
              const { cats, nums } = cell;
              const uniqueCats = [...new Set(cats)].slice(0, 8);
              const catScale = d3.scaleBand().domain(uniqueCats).range([pad + 2, cellW - pad - 2]).padding(0.15);
              const numExt = d3.extent(nums);
              const numScale = d3.scaleLinear().domain(numExt).range([cellH - pad - 2, pad + 2]);
              const dotR = Math.max(1, Math.min(2, cellW / 40));
              // Group data
              const grouped = new Map();
              for (let k = 0; k < cats.length; k++) {
                if (!uniqueCats.includes(cats[k])) continue;
                if (!grouped.has(cats[k])) grouped.set(cats[k], []);
                grouped.get(cats[k]).push(nums[k]);
              }
              // Draw box per category
              for (const [cat, vals] of grouped) {
                const cx2 = catScale(cat) + catScale.bandwidth() / 2;
                const bw = catScale.bandwidth();
                vals.sort(d3.ascending);
                const q1 = d3.quantile(vals, 0.25);
                const med = d3.quantile(vals, 0.5);
                const q3 = d3.quantile(vals, 0.75);
                // Box
                cellG.append('rect')
                  .attr('x', cx2 - bw / 2)
                  .attr('y', numScale(q3))
                  .attr('width', bw)
                  .attr('height', Math.max(1, numScale(q1) - numScale(q3)))
                  .attr('fill', assocColor(cell.value))
                  .attr('opacity', 0.4)
                  .attr('stroke', assocColor(cell.value))
                  .attr('stroke-width', 0.5);
                // Median line
                cellG.append('line')
                  .attr('x1', cx2 - bw / 2).attr('x2', cx2 + bw / 2)
                  .attr('y1', numScale(med)).attr('y2', numScale(med))
                  .attr('stroke', assocColor(cell.value))
                  .attr('stroke-width', 1.5);
                // Jittered dots (sampled)
                const maxD = Math.min(vals.length, 30);
                const stp = Math.max(1, Math.floor(vals.length / maxD));
                for (let k = 0; k < vals.length; k += stp) {
                  const jitter = (Math.random() - 0.5) * bw * 0.6;
                  cellG.append('circle')
                    .attr('cx', cx2 + jitter)
                    .attr('cy', numScale(vals[k]))
                    .attr('r', dotR)
                    .attr('fill', assocColor(cell.value))
                    .attr('opacity', 0.5);
                }
              }
            } else {
              // Cramér's V: mini heatmap (contingency table)
              const { xs, ys } = cell;
              const xCats = [...new Set(xs)].slice(0, 6);
              const yCats = [...new Set(ys)].slice(0, 6);
              const counts = new Map();
              let maxC = 0;
              for (let k = 0; k < xs.length; k++) {
                if (!xCats.includes(xs[k]) || !yCats.includes(ys[k])) continue;
                const ck = `${xs[k]}|${ys[k]}`;
                const c = (counts.get(ck) || 0) + 1;
                counts.set(ck, c);
                if (c > maxC) maxC = c;
              }
              const xBand = d3.scaleBand().domain(xCats).range([pad + 2, cellW - pad - 2]).padding(0.08);
              const yBand = d3.scaleBand().domain(yCats).range([pad + 2, cellH - pad - 2]).padding(0.08);
              const cScale = d3.scaleSequential(d3.interpolateOranges).domain([0, maxC || 1]);
              for (const xc of xCats) {
                for (const yc of yCats) {
                  const c = counts.get(`${xc}|${yc}`) || 0;
                  cellG.append('rect')
                    .attr('x', xBand(xc))
                    .attr('y', yBand(yc))
                    .attr('width', xBand.bandwidth())
                    .attr('height', yBand.bandwidth())
                    .attr('fill', c > 0 ? cScale(c) : 'var(--bg)')
                    .attr('stroke', 'var(--chart-grid-color)')
                    .attr('stroke-width', 0.3)
                    .attr('rx', 1);
                }
              }
            }

          } else {
            // Text mode
            cellG.select('rect').attr('fill', bgColor).attr('opacity', 0.12 + absV * 0.5);
            cellG.append('text')
              .attr('x', cellW / 2).attr('y', cellH / 2 + 5)
              .attr('text-anchor', 'middle')
              .attr('font-size', Math.min(14, cellW * 0.28, cellH * 0.28))
              .attr('font-weight', 700)
              .attr('font-family', 'var(--font)')
              .attr('fill', absV > 0.5 ? '#fff' : 'var(--chart-axis-color)')
              .text(cell.value.toFixed(2));
          }

          // Tooltip
          cellG.append('rect')
            .attr('width', cellW).attr('height', cellH)
            .attr('fill', 'transparent')
            .style('cursor', 'default')
            .on('mouseover', (ev) => {
              showTooltip(ev, <CorrTip fi={fields[i]} fj={fields[j]} cell={cell} />);
            })
            .on('mousemove', moveTooltip)
            .on('mouseleave', hideTooltip);
        }
      }
    }

    // ── Legends ──
    const legW = Math.min(W / 2 - 10, 120);
    const legH = 8;
    const defs = svg.append('defs');

    // Pearson legend (diverging) — only if there are numeric×numeric pairs
    const hasNumNum = fields.some((fi, i) => fields.some((fj, j) => i !== j && fieldType[fi] === 'num' && fieldType[fj] === 'num'));
    // Association legend (sequential) — only if there are non-num×num pairs
    const hasAssoc = fields.some((fi, i) => fields.some((fj, j) => i !== j && !(fieldType[fi] === 'num' && fieldType[fj] === 'num')));

    let legX = 0;
    if (hasNumNum) {
      const lw = hasAssoc ? legW : Math.min(W, 160);
      const lx = hasAssoc ? 0 : W / 2 - lw / 2;
      const legG = g.append('g').attr('transform', `translate(${lx},${H + 4})`);
      const gid = `corr-pearson-${uid}`;
      const gr = defs.append('linearGradient').attr('id', gid);
      for (let t = 0; t <= 10; t++) {
        const v = -1 + (t / 10) * 2;
        gr.append('stop').attr('offset', `${t * 10}%`).attr('stop-color', corrColor(v));
      }
      legG.append('rect').attr('width', lw).attr('height', legH).attr('rx', 3).attr('fill', `url(#${gid})`);
      legG.append('text').attr('x', 0).attr('y', 18).attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('-1');
      legG.append('text').attr('x', lw / 2).attr('y', 18).attr('text-anchor', 'middle').attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('Pearson r');
      legG.append('text').attr('x', lw).attr('y', 18).attr('text-anchor', 'end').attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('+1');
      legX = lw + 20;
    }
    if (hasAssoc) {
      const lw = hasNumNum ? legW : Math.min(W, 160);
      const lx = hasNumNum ? legX : W / 2 - lw / 2;
      const legG = g.append('g').attr('transform', `translate(${lx},${H + 4})`);
      const gid = `corr-assoc-${uid}`;
      const gr = defs.append('linearGradient').attr('id', gid);
      for (let t = 0; t <= 10; t++) {
        gr.append('stop').attr('offset', `${t * 10}%`).attr('stop-color', assocColor(t / 10));
      }
      legG.append('rect').attr('width', lw).attr('height', legH).attr('rx', 3).attr('fill', `url(#${gid})`);
      legG.append('text').attr('x', 0).attr('y', 18).attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('0');
      legG.append('text').attr('x', lw / 2).attr('y', 18).attr('text-anchor', 'middle').attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('\u03b7 / V');
      legG.append('text').attr('x', lw).attr('y', 18).attr('text-anchor', 'end').attr('font-size', 8).attr('fill', 'var(--chart-axis-color)').text('1');
    }

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, uid]);

  useEffect(render, [render]);

  const fields = (widget.correlogramFields || []).filter(Boolean);
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {fields.length < 2 && <Placeholder text="Select at least 2 fields" />}
    </div>
  );
}

/* ── Tooltip ───────────────────────────────────────────────────────────────── */

const STAT_LABELS = { pearson: 'Pearson r', eta: 'Eta \u03b7', cramer: "Cram\u00e9r's V" };

function CorrTip({ fi, fj, cell }) {
  const absV = Math.abs(cell.value);
  let strength = 'None';
  if (absV >= 0.8) strength = 'Very strong';
  else if (absV >= 0.6) strength = 'Strong';
  else if (absV >= 0.4) strength = 'Moderate';
  else if (absV >= 0.2) strength = 'Weak';
  else if (absV > 0.05) strength = 'Very weak';

  return (
    <>
      <div className="chart-tooltip-title">{fi} vs {fj}</div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{STAT_LABELS[cell.kind]}</span>
        <span className="tt-value">{cell.value.toFixed(4)}</span>
      </div>
      {cell.kind === 'pearson' && (
        <div className="chart-tooltip-row">
          <span className="tt-label">r\u00b2</span>
          <span className="tt-value">{(cell.value * cell.value).toFixed(4)}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">Strength</span>
        <span className="tt-value">{strength}{cell.signed ? (cell.value >= 0 ? ' (+)' : ' (-)') : ''}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Observations</span>
        <span className="tt-value">{cell.n}</span>
      </div>
    </>
  );
}
