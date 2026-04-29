import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function WordCloud({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || w < 40 || h < 40) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    // ── Build word frequencies ──────────────────────────────────────────
    const freqMap = new Map();
    const mode = widget.wordCloudMode || 'cell';

    if (widget.valueField) {
      // Use valueField as weight — aggregate per unique term
      for (const row of data) {
        const raw = row[widget.xField];
        if (raw == null || raw === '') continue;
        const val = +row[widget.valueField] || 0;
        const terms = mode === 'split'
          ? String(raw).split(/\s+/).filter(Boolean)
          : [String(raw)];
        for (const t of terms) {
          const key = t.trim();
          if (!key) continue;
          if (!freqMap.has(key)) freqMap.set(key, []);
          freqMap.get(key).push(val);
        }
      }
    } else {
      // Count occurrences
      for (const row of data) {
        const raw = row[widget.xField];
        if (raw == null || raw === '') continue;
        const terms = mode === 'split'
          ? String(raw).split(/\s+/).filter(Boolean)
          : [String(raw)];
        for (const t of terms) {
          const key = t.trim();
          if (!key) continue;
          freqMap.set(key, (freqMap.get(key) || 0) + 1);
        }
      }
    }

    // Resolve to { word, value } array
    let words;
    if (widget.valueField) {
      words = Array.from(freqMap, ([word, vals]) => ({
        word,
        value: aggregate(vals, 'sum'),
        count: vals.length,
      }));
    } else {
      words = Array.from(freqMap, ([word, count]) => ({
        word,
        value: count,
        count,
      }));
    }

    words.sort((a, b) => b.value - a.value);
    const maxWords = widget.wordCloudMaxWords || 100;
    words = words.slice(0, maxWords);

    if (!words.length) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    // ── Font size scale ─────────────────────────────────────────────────
    const minVal = d3.min(words, d => d.value);
    const maxVal = d3.max(words, d => d.value);
    const minFont = 12;
    const maxFont = Math.min(48, Math.max(24, Math.min(w, h) / 8));
    const fontScale = d3.scaleSqrt()
      .domain([minVal, Math.max(maxVal, minVal + 1)])
      .range([minFont, maxFont]);

    // ── Colors ──────────────────────────────────────────────────────────
    let colorFn;
    const opacity = widget.opacity ?? 1;

    if (widget.colorMode === 'gradient') {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const seq = getSequentialScale(gradKey, minVal, maxVal, widget.invertGradient, widget.logGradient);
      colorFn = d => seq(d.value);
    } else {
      const scale = getColorScaleWithOverrides(
        widget.colorScheme,
        words.map(d => d.word),
        widget.dimensionColors,
      );
      colorFn = d => scale(d.word);
    }

    // ── Placement using SVG getBBox for pixel-perfect measurement ───────
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    // Seed pseudo-random from word list length for deterministic rotation
    const seedRng = d3.randomLcg(words.length);
    const rng = d3.randomUniform.source(seedRng)(0, 1);

    // 1. Classic word cloud: mostly horizontal, some vertical
    const rotateMode = widget.wordCloudRotate !== false; // default on
    const ANGLES = [0, 0, 0, 0, 0, -90, 90]; // ~70% horizontal, ~30% vertical

    // 1b. Measure every word by rendering it off-screen in the SVG, then getBBox()
    const measureG = svg.append('g').attr('opacity', 0);
    const wordData = words.map(d => {
      const fontSize = fontScale(d.value);
      const rotate = rotateMode ? ANGLES[Math.floor(rng() * ANGLES.length)] : 0;
      const el = measureG.append('text')
        .attr('x', 0).attr('y', 0)
        .attr('font-size', fontSize).attr('font-weight', 600)
        .attr('font-family', 'var(--font, sans-serif)')
        .text(d.word);
      const bb = el.node().getBBox();
      el.remove();
      const tw = bb.width;
      const th = bb.height;
      // Axis-aligned bounding box after rotation
      const rad = (rotate * Math.PI) / 180;
      const cosA = Math.abs(Math.cos(rad));
      const sinA = Math.abs(Math.sin(rad));
      const bw = tw * cosA + th * sinA;
      const bh = tw * sinA + th * cosA;
      return { ...d, fontSize, rotate, bw, bh, tw, th };
    });
    measureG.remove();

    // 2. Grid occupancy map — each cell is ~3px; tight packing
    const CELL = 3;
    const gridCols = Math.ceil(w / CELL);
    const gridRows = Math.ceil(h / CELL);
    const grid = new Uint8Array(gridCols * gridRows);

    function markGrid(x, y, bw, bh) {
      const c0 = Math.max(0, Math.floor(x / CELL));
      const c1 = Math.min(gridCols - 1, Math.floor((x + bw) / CELL));
      const r0 = Math.max(0, Math.floor(y / CELL));
      const r1 = Math.min(gridRows - 1, Math.floor((y + bh) / CELL));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          grid[r * gridCols + c] = 1;
    }

    function testGrid(x, y, bw, bh) {
      const c0 = Math.max(0, Math.floor(x / CELL));
      const c1 = Math.min(gridCols - 1, Math.floor((x + bw) / CELL));
      const r0 = Math.max(0, Math.floor(y / CELL));
      const r1 = Math.min(gridRows - 1, Math.floor((y + bh) / CELL));
      if (c0 < 0 || r0 < 0 || c1 >= gridCols || r1 >= gridRows) return true;
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          if (grid[r * gridCols + c]) return true;
      return false;
    }

    const cx = w / 2;
    const cy = h / 2;
    const PAD = 4; // px padding around each word

    // Archimedean spiral — tighter growth for compact packing
    for (const wd of wordData) {
      wd.px = null;
      const pw = wd.bw + PAD * 2;
      const ph = wd.bh + PAD * 2;
      for (let t = 0; t < 2500; t++) {
        const angle = t * 0.18;
        const r = 1.5 * angle;
        const tx = cx + r * Math.cos(angle) - pw / 2;
        const ty = cy + r * Math.sin(angle) - ph / 2;
        if (tx < 0 || ty < 0 || tx + pw > w || ty + ph > h) {
          if (r > Math.hypot(w, h)) break;
          continue;
        }
        if (!testGrid(tx, ty, pw, ph)) {
          markGrid(tx, ty, pw, ph);
          wd.px = tx + pw / 2;
          wd.py = ty + ph / 2;
          break;
        }
      }
    }

    const visible = wordData.filter(d => d.px !== null);

    // ── Render SVG ──────────────────────────────────────────────────────
    const g = svg.append('g');

    const texts = g.selectAll('text')
      .data(visible)
      .join('text')
      .attr('x', d => d.px)
      .attr('y', d => d.py)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => d.fontSize)
      .attr('font-weight', 600)
      .attr('font-family', 'var(--font, sans-serif)')
      .attr('fill', d => colorFn(d))
      .attr('opacity', 0)
      .attr('transform', d => d.rotate ? `rotate(${d.rotate},${d.px},${d.py})` : null)
      .text(d => d.word)
      .style('cursor', onCrossFilter ? 'pointer' : 'default')
      .style('user-select', 'none');

    // Animate in
    texts.transition().duration(400).ease(d3.easeCubicOut)
      .attr('opacity', opacity);

    // Interactions
    texts
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(80)
          .attr('opacity', 1);
        showTooltip(ev, <WordTip d={d} widget={widget} color={colorFn(d)} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(100)
          .attr('opacity', opacity);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => {
        ev.stopPropagation();
        onCrossFilter({ field: widget.xField, value: d.word });
      } : null);

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {!widget.xField && <Placeholder text="Select a text field" />}
    </div>
  );
}

function WordTip({ d, widget, color }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.word}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{widget.valueField || 'Count'}</span>
        <span className="tt-value">{formatValue(d.value, widget.numberFormat)}</span>
      </div>
      <div className="chart-tooltip-stat">
        {d.count.toLocaleString()} records
      </div>
    </>
  );
}
