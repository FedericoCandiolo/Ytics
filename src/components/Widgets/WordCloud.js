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
      const seq = getSequentialScale(gradKey, minVal, maxVal);
      colorFn = d => seq(d.value);
    } else {
      const scale = getColorScaleWithOverrides(
        widget.colorScheme,
        words.map(d => d.word),
        widget.dimensionColors,
      );
      colorFn = d => scale(d.word);
    }

    // ── Spiral placement (no d3-cloud) ──────────────────────────────────
    // Measure text widths using a temporary canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Seed pseudo-random from word list length for deterministic rotation
    const seedRng = d3.randomLcg(words.length);
    const rng = d3.randomUniform.source(seedRng)(0, 1);

    const placed = []; // { x, y, w, h } bounding boxes

    const wordData = words.map(d => {
      const fontSize = fontScale(d.value);
      const rotate = (widget.wordCloudRotate !== false) ? (rng() > 0.7 ? 90 : 0) : 0;
      ctx.font = `600 ${fontSize}px var(--font, sans-serif)`;
      const measured = ctx.measureText(d.word);
      const tw = measured.width + 4;
      const th = fontSize * 1.2;
      // For rotated words, swap width/height
      const bw = rotate === 90 ? th : tw;
      const bh = rotate === 90 ? tw : th;
      return { ...d, fontSize, rotate, bw, bh, tw };
    });

    const cx = w / 2;
    const cy = h / 2;

    function intersects(r1, r2, pad = 0) {
      return !(r1.x + r1.w + pad < r2.x - pad || r2.x + r2.w + pad < r1.x - pad ||
               r1.y + r1.h + pad < r2.y - pad || r2.y + r2.h + pad < r1.y - pad);
    }

    function inBounds(rect) {
      return rect.x >= 0 && rect.y >= 0 &&
             rect.x + rect.w <= w && rect.y + rect.h <= h;
    }

    // Archimedean spiral placement
    for (const wd of wordData) {
      let foundSpot = false;
      const pad = Math.max(4, wd.fontSize * 0.15);
      // Try spiral positions
      for (let t = 0; t < 800; t++) {
        const angle = t * 0.1;
        const spiralR = 1.5 * t * 0.1;
        const tx = cx + spiralR * Math.cos(angle) - wd.bw / 2;
        const ty = cy + spiralR * Math.sin(angle) - wd.bh / 2;
        const candidate = { x: tx, y: ty, w: wd.bw, h: wd.bh };

        if (!inBounds(candidate)) {
          if (spiralR > Math.max(w, h)) break; // too far out
          continue;
        }
        if (placed.every(p => !intersects(p, candidate, pad))) {
          wd.px = tx + wd.bw / 2;
          wd.py = ty + wd.bh / 2;
          placed.push(candidate);
          foundSpot = true;
          break;
        }
      }
      if (!foundSpot) {
        wd.px = null; // skip this word
      }
    }

    const visible = wordData.filter(d => d.px !== null);

    // ── Render SVG ──────────────────────────────────────────────────────
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

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
          .attr('opacity', 1)
          .attr('font-size', d.fontSize * 1.1);
        showTooltip(ev, <WordTip d={d} widget={widget} color={colorFn(d)} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev, d) => {
        d3.select(ev.currentTarget).transition().duration(100)
          .attr('opacity', opacity)
          .attr('font-size', d.fontSize);
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
        <span className="tt-value">{formatValue(d.value)}</span>
      </div>
      <div className="chart-tooltip-stat">
        {d.count.toLocaleString()} records
      </div>
    </>
  );
}
