/**
 * DensityChart — 2D density visualization with three modes:
 *   shading   — filled contour regions (contour lines always visible)
 *   hexbin    — hexagonal binning
 *   histogram — rectangular 2D binning
 *
 * Multi-series: optional colorField splits data into series.
 * Color modes: auto, palette, analog (nearby hues), complementary (opposite hues),
 *              cmy (Cyan/Magenta/Yellow triad).
 * Overlap blending uses multiply (CMYK-like subtractive from white).
 * Legend position: top, bottom, or hidden.
 */
import { useRef, useEffect, useCallback, useId } from 'react';
import * as d3 from 'd3';
import { getColorArray, getPrimaryColor, resolveGradient, getSequentialScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

/* ── Series color strategies ──────────────────────────────────────────────── */

/** Analog colors — nearby hues from the palette, works for any N */
function analogColors(schemeKey, n) {
  const arr = getColorArray(schemeKey);
  // Pick colors that are close in the palette (adjacent)
  const step = Math.max(1, Math.floor(arr.length / (n + 1)));
  return Array.from({ length: n }, (_, i) => arr[(i * step) % arr.length]);
}

/** True complementary — opposite hue, same saturation/lightness. Based on palette's first color. */
function complementaryColors(schemeKey, n) {
  const arr = getColorArray(schemeKey);
  const base = d3.hsl(arr[0]);
  const h = isNaN(base.h) ? 220 : base.h;
  const s = Math.max(0.5, Math.min(0.85, isNaN(base.s) ? 0.7 : base.s));
  const l = Math.max(0.4, Math.min(0.65, isNaN(base.l) ? 0.55 : base.l));
  if (n === 2) {
    return [
      d3.hsl(h, s, l).formatHex(),
      d3.hsl((h + 180) % 360, s, l).formatHex(),
    ];
  }
  // For N colors, spread evenly around the wheel
  return Array.from({ length: n }, (_, i) =>
    d3.hsl((h + (360 / n) * i) % 360, s, l).formatHex()
  );
}

/** CMY triad tuned to the active palette's lightness */
function cmyTriad(schemeKey) {
  const arr = getColorArray(schemeKey);
  const base = d3.hsl(arr[0]);
  const l = Math.max(0.45, Math.min(0.65, isNaN(base.l) ? 0.55 : base.l));
  const s = Math.max(0.6, Math.min(0.85, isNaN(base.s) ? 0.7 : base.s));
  return [
    d3.hsl(190, s, l).formatHex(), // Cyan
    d3.hsl(320, s, l).formatHex(), // Magenta
    d3.hsl(55,  s, l).formatHex(), // Yellow
  ];
}

/** Resolve base colors for each series */
function resolveSeriesColors(seriesKeys, schemeKey, colorMode) {
  const n = seriesKeys.length;
  const mode = colorMode || 'auto';

  if (mode === 'analog') return analogColors(schemeKey, n);
  if (mode === 'complementary') return complementaryColors(schemeKey, n);
  if (mode === 'cmy' && n <= 3) return cmyTriad(schemeKey).slice(0, n);

  if (mode === 'auto') {
    if (n === 2) return complementaryColors(schemeKey, 2);
    if (n === 3) return cmyTriad(schemeKey);
  }

  // Palette fallback
  const arr = getColorArray(schemeKey);
  return seriesKeys.map((_, i) => arr[i % arr.length]);
}

/* ── Hexbin geometry helpers ──────────────────────────────────────────────── */

function hexPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

function hexBin(points, radius, W, H) {
  const dx = radius * Math.sqrt(3);
  const dy = radius * 1.5;
  const bins = new Map();
  for (const p of points) {
    const col = Math.round(p.px / dx);
    const row = Math.round(p.py / dy);
    const cx = col * dx + (row % 2 ? dx / 2 : 0);
    const cy = row * dy;
    const key = `${col},${row}`;
    if (!bins.has(key)) bins.set(key, { cx, cy, points: [] });
    bins.get(key).points.push(p);
  }
  return [...bins.values()].filter(b =>
    b.cx >= -radius && b.cx <= W + radius && b.cy >= -radius && b.cy <= H + radius
  );
}

/* ── 2D histogram binning ─────────────────────────────────────────────────── */

function rectBin(points, binsX, binsY, W, H) {
  const cellW = W / binsX, cellH = H / binsY;
  const grid = new Map();
  for (const p of points) {
    const col = Math.min(binsX - 1, Math.max(0, Math.floor(p.px / cellW)));
    const row = Math.min(binsY - 1, Math.max(0, Math.floor(p.py / cellH)));
    const key = `${col},${row}`;
    if (!grid.has(key)) grid.set(key, { x: col * cellW, y: row * cellH, w: cellW, h: cellH, points: [] });
    grid.get(key).points.push(p);
  }
  return [...grid.values()];
}

/* ── Legend renderer ──────────────────────────────────────────────────────── */

function drawLegend(g, seriesKeys, seriesColors, position, W, H) {
  if (position === 'hidden' || seriesKeys.length < 2) return;
  const isBottom = position === 'bottom';
  const spacing = 14;

  // Measure how wide each entry is (rough estimate: 12px swatch + 4px gap + label)
  const entries = seriesKeys.slice(0, 12).filter(k => k !== '__all__');
  if (!entries.length) return;

  // Horizontal legend centered
  const leg = g.append('g');
  let xOff = 0;
  const items = [];
  entries.forEach((key, i) => {
    const label = key.length > 16 ? key.slice(0, 16) + '\u2026' : key;
    items.push({ key, label, color: seriesColors[i % seriesColors.length], x: xOff });
    xOff += 12 + 4 + label.length * 6.5 + spacing;
  });
  const totalW = xOff - spacing;
  const startX = (W - totalW) / 2;
  const yPos = isBottom ? H + 52 : -14;

  leg.attr('transform', `translate(${startX},${yPos})`);
  items.forEach(item => {
    const row = leg.append('g').attr('transform', `translate(${item.x},0)`);
    row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2)
      .attr('fill', item.color).attr('opacity', 0.85);
    row.append('text').attr('x', 14).attr('y', 9).attr('font-size', 10)
      .attr('font-family', 'var(--font)').attr('fill', 'var(--text-muted)')
      .text(item.label);
  });
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function DensityChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();
  const reactId = useId();
  const clipId = `density-clip-${reactId.replace(/:/g, '')}`;

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const legendPos = widget.densityLegendPosition || 'bottom'; // 'top' | 'bottom' | 'hidden'
    const hasMultiSeries = !!widget.colorField;
    const legendSpace = hasMultiSeries && legendPos !== 'hidden' ? 22 : 0;
    const m = {
      top: 16 + (legendPos === 'top' ? legendSpace : 0),
      right: 20,
      bottom: 54 + (legendPos === 'bottom' ? legendSpace : 0),
      left: 62,
    };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Parse points
    const pts = data
      .map(d => ({
        x: +d[widget.xField],
        y: +d[widget.yField],
        series: widget.colorField ? String(d[widget.colorField] ?? '') : '__all__',
      }))
      .filter(d => isFinite(d.x) && isFinite(d.y));
    if (!pts.length) return;

    const opacity = widget.opacity ?? 0.85;
    const bandwidth = widget.densityBandwidth ?? 30;
    const thresholds = widget.densityThresholds ?? 10;
    const mode = widget.densityMode || 'shading'; // 'shading' | 'hexbin' | 'histogram'
    const filled = widget.densityFilled !== false;

    // Scales
    const xScale = d3.scaleLinear().domain(d3.extent(pts, d => d.x)).range([0, W]).nice();
    const yScale = d3.scaleLinear().domain(d3.extent(pts, d => d.y)).range([H, 0]).nice();

    // Pixel coords
    for (const p of pts) { p.px = xScale(p.x); p.py = yScale(p.y); }

    // Series
    const seriesKeys = widget.colorField ? [...new Set(pts.map(d => d.series))] : ['__all__'];
    const isSingle = seriesKeys.length === 1 && seriesKeys[0] === '__all__';

    // Colors
    const seriesColors = isSingle
      ? [getPrimaryColor(widget.colorScheme)]
      : resolveSeriesColors(seriesKeys, widget.colorScheme, widget.densityColorMode);

    // SVG
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('rect').attr('width', W).attr('height', H);

    // Grid
    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
      g.append('g').call(d3.axisBottom(xScale).tickSize(-H).tickFormat(''))
        .attr('transform', `translate(0,${H})`)
        .call(a => { a.select('.domain').remove(); a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'); });
    }

    // Axes
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6).tickFormat(fmtTick)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

    // Density group
    const densG = g.append('g').attr('clip-path', `url(#${clipId})`);

    // Render
    if (mode === 'shading') {
      renderShading(densG, svg, g, pts, seriesKeys, isSingle, seriesColors,
        xScale, yScale, W, H, bandwidth, thresholds, filled, opacity, widget, clipId,
        showTooltip, moveTooltip, hideTooltip);
    } else if (mode === 'hexbin') {
      renderHexbin(densG, pts, seriesKeys, isSingle, seriesColors,
        xScale, yScale, W, H, filled, opacity, widget,
        showTooltip, moveTooltip, hideTooltip);
    } else if (mode === 'histogram') {
      renderHistogram(densG, pts, seriesKeys, isSingle, seriesColors,
        xScale, yScale, W, H, filled, opacity, widget,
        showTooltip, moveTooltip, hideTooltip);
    }

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 44).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-46,${H / 2}) rotate(-90)`).text(widget.yField);

    // Data point overlay
    if (widget.densityShowPoints) {
      const dotG = g.append('g').attr('clip-path', `url(#${clipId})`);
      dotG.selectAll('circle').data(pts).join('circle')
        .attr('cx', d => d.px).attr('cy', d => d.py)
        .attr('r', 1.5)
        .attr('fill', d => {
          if (isSingle) return 'var(--chart-axis-color)';
          const si = seriesKeys.indexOf(d.series);
          return seriesColors[si % seriesColors.length];
        })
        .attr('opacity', 0.4);
    }

    // Legend
    if (!isSingle && legendPos !== 'hidden') {
      drawLegend(g, seriesKeys, seriesColors, legendPos, W, H);
    }

    // Cross-filter
    if (onCrossFilter && widget.colorField) {
      densG.style('cursor', 'pointer')
        .on('click', (ev) => {
          const [mx, my] = d3.pointer(ev);
          let nearest = null, minDist = Infinity;
          for (const p of pts) {
            const dist = (p.px - mx) ** 2 + (p.py - my) ** 2;
            if (dist < minDist) { minDist = dist; nearest = p; }
          }
          if (nearest && minDist < 2500) {
            ev.stopPropagation();
            onCrossFilter({ field: widget.colorField, value: nearest.series });
          }
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

/* ═══════════════════════════════════════════════════════════════════════════
   Shading renderer (contour lines always visible, fill is optional)
   ═══════════════════════════════════════════════════════════════════════════ */
function renderShading(densG, svg, g, pts, seriesKeys, isSingle, seriesColors,
  xScale, yScale, W, H, bandwidth, thresholds, filled, opacity, widget, clipId,
  showTooltip, moveTooltip, hideTooltip) {

  const renderSeries = (seriesPts, baseColor, key, useBlend) => {
    const contourGen = d3.contourDensity()
      .x(d => d.px).y(d => d.py)
      .size([W, H]).bandwidth(bandwidth).thresholds(thresholds);
    const contours = contourGen(seriesPts);
    if (!contours.length) return;

    const maxVal = d3.max(contours, c => c.value);
    const seriesG = densG.append('g');
    if (useBlend) seriesG.style('mix-blend-mode', 'multiply');

    if (filled) {
      const c = d3.color(baseColor);
      seriesG.selectAll('path.density-fill')
        .data(contours).join('path')
        .attr('class', 'density-fill')
        .attr('d', d3.geoPath())
        .attr('fill', d => {
          const t = maxVal > 0 ? d.value / maxVal : 0;
          const out = c.copy();
          out.opacity = t * 0.65 * opacity;
          return out.formatRgb();
        })
        .attr('stroke', 'none');
    }

    // Contour lines always
    seriesG.selectAll('path.density-line')
      .data(contours).join('path')
      .attr('class', 'density-line')
      .attr('d', d3.geoPath())
      .attr('fill', 'none')
      .attr('stroke', baseColor)
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', d => {
        const t = maxVal > 0 ? d.value / maxVal : 0;
        return 0.15 + t * 0.85 * opacity;
      });

    seriesG.selectAll('path.density-line')
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2.5);
        showTooltip(ev, <DensityTip value={d.value} series={key === '__all__' ? null : key} widget={widget} color={baseColor} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1.2);
        hideTooltip();
      });
  };

  if (isSingle) {
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const contourGen = d3.contourDensity()
      .x(d => d.px).y(d => d.py)
      .size([W, H]).bandwidth(bandwidth).thresholds(thresholds);
    const contours = contourGen(pts);
    if (!contours.length) return;

    const maxVal = d3.max(contours, c => c.value);
    const colorFn = getSequentialScale(gradKey, 0, maxVal, widget.invertGradient, widget.logGradient);

    if (filled) {
      densG.selectAll('path.density-fill')
        .data(contours).join('path')
        .attr('class', 'density-fill')
        .attr('d', d3.geoPath())
        .attr('fill', d => colorFn(d.value))
        .attr('fill-opacity', opacity * 0.65)
        .attr('stroke', 'none');
    }

    densG.selectAll('path.density-line')
      .data(contours).join('path')
      .attr('class', 'density-line')
      .attr('d', d3.geoPath())
      .attr('fill', 'none')
      .attr('stroke', d => colorFn(d.value))
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', opacity);

    densG.selectAll('path.density-line')
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2.5);
        showTooltip(ev, <DensityTip value={d.value} series={null} widget={widget} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1.2);
        hideTooltip();
      });

    // Gradient legend
    const legH = 8, legW = Math.min(W * 0.4, 120);
    const legG = g.append('g').attr('transform', `translate(${W - legW},${-12})`);
    const defs = svg.select('defs');
    const gradId = `dens-grad-${clipId}`;
    const grad = defs.append('linearGradient').attr('id', gradId);
    for (let i = 0; i <= 10; i++) {
      grad.append('stop').attr('offset', `${i * 10}%`).attr('stop-color', colorFn(maxVal * i / 10));
    }
    legG.append('rect').attr('width', legW).attr('height', legH).attr('rx', 3).attr('fill', `url(#${gradId})`);
    legG.append('text').attr('x', 0).attr('y', -2).attr('font-size', 9).attr('fill', 'var(--chart-axis-color)').text('Low');
    legG.append('text').attr('x', legW).attr('y', -2).attr('text-anchor', 'end').attr('font-size', 9).attr('fill', 'var(--chart-axis-color)').text('High');
  } else {
    const useBlend = filled && seriesKeys.length <= 3;
    seriesKeys.forEach((key, si) => {
      const seriesPts = pts.filter(d => d.series === key);
      if (seriesPts.length < 2) return;
      renderSeries(seriesPts, seriesColors[si % seriesColors.length], key, useBlend);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Hexbin renderer
   ═══════════════════════════════════════════════════════════════════════════ */
function renderHexbin(densG, pts, seriesKeys, isSingle, seriesColors,
  xScale, yScale, W, H, filled, opacity, widget,
  showTooltip, moveTooltip, hideTooltip) {

  const hexRadius = widget.densityHexRadius ?? Math.max(8, Math.min(30, Math.min(W, H) / 20));

  const renderBins = (binPts, baseColor, key, useBlend) => {
    const bins = hexBin(binPts, hexRadius, W, H);
    if (!bins.length) return;
    const maxCount = d3.max(bins, b => b.points.length);
    const seriesG = densG.append('g');
    if (useBlend) seriesG.style('mix-blend-mode', 'multiply');

    seriesG.selectAll('path.hex')
      .data(bins).join('path')
      .attr('class', 'hex')
      .attr('d', d => hexPath(d.cx, d.cy, hexRadius - 0.5))
      .attr('fill', d => {
        if (!filled) return 'none';
        const t = maxCount > 0 ? d.points.length / maxCount : 0;
        const c = d3.color(baseColor);
        c.opacity = t * 0.8 * opacity;
        return c.formatRgb();
      })
      .attr('stroke', baseColor)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', d => {
        const t = maxCount > 0 ? d.points.length / maxCount : 0;
        return 0.2 + t * 0.6 * opacity;
      })
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2.5);
        showTooltip(ev, <BinTip count={d.points.length} series={key === '__all__' ? null : key} widget={widget} color={baseColor} points={d.points} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1);
        hideTooltip();
      });
  };

  if (isSingle) {
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const bins = hexBin(pts, hexRadius, W, H);
    if (!bins.length) return;
    const maxCount = d3.max(bins, b => b.points.length);
    const colorFn = getSequentialScale(gradKey, 0, maxCount, widget.invertGradient, widget.logGradient);

    densG.selectAll('path.hex')
      .data(bins).join('path')
      .attr('class', 'hex')
      .attr('d', d => hexPath(d.cx, d.cy, hexRadius - 0.5))
      .attr('fill', d => filled ? colorFn(d.points.length) : 'none')
      .attr('fill-opacity', filled ? opacity * 0.75 : 0)
      .attr('stroke', d => colorFn(d.points.length))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', opacity)
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2.5);
        showTooltip(ev, <BinTip count={d.points.length} series={null} widget={widget} points={d.points} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1);
        hideTooltip();
      });
  } else {
    const useBlend = filled && seriesKeys.length <= 3;
    seriesKeys.forEach((key, si) => {
      const seriesPts = pts.filter(d => d.series === key);
      if (!seriesPts.length) return;
      renderBins(seriesPts, seriesColors[si % seriesColors.length], key, useBlend);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2D Histogram renderer
   ═══════════════════════════════════════════════════════════════════════════ */
function renderHistogram(densG, pts, seriesKeys, isSingle, seriesColors,
  xScale, yScale, W, H, filled, opacity, widget,
  showTooltip, moveTooltip, hideTooltip) {

  const binsX = widget.densityBinsX ?? Math.max(5, Math.round(Math.sqrt(pts.length / 3)));
  const binsY = widget.densityBinsY ?? binsX;

  const renderBins = (binPts, baseColor, key, useBlend) => {
    const bins = rectBin(binPts, binsX, binsY, W, H);
    if (!bins.length) return;
    const maxCount = d3.max(bins, b => b.points.length);
    const seriesG = densG.append('g');
    if (useBlend) seriesG.style('mix-blend-mode', 'multiply');

    seriesG.selectAll('rect.histbin')
      .data(bins).join('rect')
      .attr('class', 'histbin')
      .attr('x', d => d.x + 0.5).attr('y', d => d.y + 0.5)
      .attr('width', d => d.w - 1).attr('height', d => d.h - 1)
      .attr('rx', 2)
      .attr('fill', d => {
        if (!filled) return 'none';
        const t = maxCount > 0 ? d.points.length / maxCount : 0;
        const c = d3.color(baseColor);
        c.opacity = t * 0.8 * opacity;
        return c.formatRgb();
      })
      .attr('stroke', baseColor)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', d => {
        const t = maxCount > 0 ? d.points.length / maxCount : 0;
        return 0.15 + t * 0.6 * opacity;
      })
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2);
        showTooltip(ev, <BinTip count={d.points.length} series={key === '__all__' ? null : key} widget={widget} color={baseColor} points={d.points} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1);
        hideTooltip();
      });
  };

  if (isSingle) {
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const bins = rectBin(pts, binsX, binsY, W, H);
    if (!bins.length) return;
    const maxCount = d3.max(bins, b => b.points.length);
    const colorFn = getSequentialScale(gradKey, 0, maxCount, widget.invertGradient, widget.logGradient);

    densG.selectAll('rect.histbin')
      .data(bins).join('rect')
      .attr('class', 'histbin')
      .attr('x', d => d.x + 0.5).attr('y', d => d.y + 0.5)
      .attr('width', d => d.w - 1).attr('height', d => d.h - 1)
      .attr('rx', 2)
      .attr('fill', d => filled ? colorFn(d.points.length) : 'none')
      .attr('fill-opacity', filled ? opacity * 0.75 : 0)
      .attr('stroke', d => colorFn(d.points.length))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', opacity)
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2);
        showTooltip(ev, <BinTip count={d.points.length} series={null} widget={widget} points={d.points} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1);
        hideTooltip();
      });
  } else {
    const useBlend = filled && seriesKeys.length <= 3;
    seriesKeys.forEach((key, si) => {
      const seriesPts = pts.filter(d => d.series === key);
      if (!seriesPts.length) return;
      renderBins(seriesPts, seriesColors[si % seriesColors.length], key, useBlend);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Tooltips
   ═══════════════════════════════════════════════════════════════════════════ */
function DensityTip({ value, series, widget, color }) {
  return (
    <>
      <div className="chart-tooltip-title">
        {color && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />}
        {series || 'Density'}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Density</span>
        <span className="tt-value">{value.toExponential(2)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Fields</span>
        <span className="tt-value">{widget.xField} x {widget.yField}</span>
      </div>
    </>
  );
}

function BinTip({ count, series, widget, color, points }) {
  const xMean = d3.mean(points, p => p.x);
  const yMean = d3.mean(points, p => p.y);
  return (
    <>
      <div className="chart-tooltip-title">
        {color && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />}
        {series || 'Bin'}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Count</span>
        <span className="tt-value">{count}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Avg {widget.xField}</span>
        <span className="tt-value">{xMean?.toFixed(2)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">Avg {widget.yField}</span>
        <span className="tt-value">{yMean?.toFixed(2)}</span>
      </div>
    </>
  );
}
