import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';

const SCHEMES = {
  tableau10: d3.schemeTableau10, category10: d3.schemeCategory10,
  set2: d3.schemeSet2, set3: d3.schemeSet3, pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2, paired: d3.schemePaired, accent: d3.schemeAccent,
};

export default function Histogram({ widget, data }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ w: width, h: height });
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || w < 10 || h < 10) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const vals = data.map(d => +d[widget.xField]).filter(v => !isNaN(v));
    if (!vals.length) return;

    const m = { top: 14, right: 14, bottom: 50, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const xScale = d3.scaleLinear().domain(d3.extent(vals)).nice().range([0, W]);
    const bins = d3.bin().domain(xScale.domain()).thresholds(xScale.ticks(widget.bins ?? 20))(vals);
    const yScale = d3.scaleLinear().domain([0, d3.max(bins, d => d.length)]).range([H, 0]).nice();

    const colors = SCHEMES[widget.colorScheme] || d3.schemeTableau10;
    const fillColor = colors[0];
    const opacity = widget.opacity ?? 1;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
    }

    g.append('g').attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(xScale).ticks(6).tickFormat(formatValue)).call(styled);
    g.append('g').call(d3.axisLeft(yScale).ticks(5)).call(styled);

    g.selectAll('.bin').data(bins).join('rect').attr('class', 'bin')
      .attr('x', d => xScale(d.x0) + 1)
      .attr('y', d => yScale(d.length))
      .attr('width', d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 2))
      .attr('height', d => H - yScale(d.length))
      .attr('fill', fillColor)
      .attr('opacity', opacity)
      .attr('rx', 2)
      .on('mouseenter', (ev, d) => {
        d3.select(ev.currentTarget).attr('opacity', Math.min(1, opacity + 0.2));
        setTooltip({
          x: ev.offsetX, y: ev.offsetY,
          range: `${formatValue(d.x0)} – ${formatValue(d.x1)}`,
          count: d.length,
        });
      })
      .on('mousemove', ev => setTooltip(t => t ? { ...t, x: ev.offsetX, y: ev.offsetY } : t))
      .on('mouseleave', ev => { d3.select(ev.currentTarget).attr('opacity', opacity); setTooltip(null); });

    // Axis labels
    g.append('text').attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', W / 2).attr('y', H + 44).text(widget.xField);
    g.append('text').attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('transform', `translate(-42,${H / 2}) rotate(-90)`).text('Count');

    // Normal curve overlay (optional)
    const mean = d3.mean(vals) || 0;
    const std = d3.deviation(vals) || 1;
    const binWidth = bins[0] ? xScale(bins[0].x1) - xScale(bins[0].x0) : 1;
    const normalLine = d3.line()
      .x(d => xScale(d))
      .y(d => {
        const prob = (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((d - mean) / std) ** 2);
        return yScale(prob * vals.length * binWidth);
      })
      .curve(d3.curveBasis);

    const ticks = xScale.ticks(60);
    g.append('path').datum(ticks)
      .attr('fill', 'none').attr('stroke', '#94a3b8').attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3').attr('opacity', 0.6)
      .attr('d', normalLine);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, widget, dims]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="100%" />
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <strong>{tooltip.range}</strong>
          <div>Count: {tooltip.count}</div>
        </div>
      )}
      {!widget.xField && <Placeholder text="Select a numeric field" />}
    </div>
  );
}

function styled(g) {
  g.select('.domain').attr('stroke', '#e2e8f0');
  g.selectAll('.tick line').attr('stroke', '#e2e8f0');
  g.selectAll('text').attr('fill', '#64748b').attr('font-size', 11);
}

function Placeholder({ text }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#94a3b8', fontSize: 12, pointerEvents: 'none',
    }}>{text}</div>
  );
}
