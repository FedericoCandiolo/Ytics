import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';

const SCHEMES = {
  tableau10: d3.schemeTableau10, category10: d3.schemeCategory10,
  set2: d3.schemeSet2, set3: d3.schemeSet3, pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2, paired: d3.schemePaired, accent: d3.schemeAccent,
};

export default function ScatterPlot({ widget, data }) {
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
    if (!data?.length || !widget.xField || !widget.yField || w < 10 || h < 10) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 14, right: 20, bottom: 50, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const pts = data
      .map(d => ({
        x: +d[widget.xField],
        y: +d[widget.yField],
        color: widget.colorField ? String(d[widget.colorField] ?? '') : null,
        size: widget.sizeField ? +d[widget.sizeField] || 0 : null,
        raw: d,
      }))
      .filter(d => !isNaN(d.x) && !isNaN(d.y));

    const opacity = widget.opacity ?? 1;
    const colors = d3.scaleOrdinal(SCHEMES[widget.colorScheme] || d3.schemeTableau10);
    const sizeMin = widget.dotSizeMin ?? 4;
    const sizeMax = widget.dotSizeMax ?? 20;

    const sizeExtent = widget.sizeField ? d3.extent(pts, d => d.size) : [1, 1];
    const sizeScale = d3.scaleSqrt().domain(sizeExtent).range([sizeMin, sizeMax]).clamp(true);

    const xScale = d3.scaleLinear().domain(d3.extent(pts, d => d.x)).range([0, W]).nice();
    const yScale = d3.scaleLinear().domain(d3.extent(pts, d => d.y)).range([H, 0]).nice();

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
      g.append('g').call(d3.axisBottom(xScale).tickSize(-H).tickFormat(''))
        .attr('transform', `translate(0,${H})`)
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
    }

    g.append('g').attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(formatValue)).call(styled);
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styled);

    g.selectAll('.dot').data(pts).join('circle').attr('class', 'dot')
      .attr('cx', d => xScale(d.x))
      .attr('cy', d => yScale(d.y))
      .attr('r', d => widget.sizeField ? sizeScale(d.size) : sizeMin + 2)
      .attr('fill', d => widget.colorField ? colors(d.color) : (SCHEMES[widget.colorScheme] || d3.schemeTableau10)[0])
      .attr('opacity', opacity)
      .attr('stroke', '#fff').attr('stroke-width', 1)
      .on('mouseenter', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 2.5).attr('opacity', 1);
        setTooltip({ x: ev.offsetX, y: ev.offsetY, d });
      })
      .on('mousemove', ev => setTooltip(t => t ? { ...t, x: ev.offsetX, y: ev.offsetY } : t))
      .on('mouseleave', ev => { d3.select(ev.currentTarget).attr('stroke-width', 1).attr('opacity', opacity); setTooltip(null); });

    // Axis labels
    g.append('text').attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', W / 2).attr('y', H + 44).text(widget.xField);
    g.append('text').attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('transform', `translate(-42,${H / 2}) rotate(-90)`).text(widget.yField);

    // Legend for color
    if (widget.showLegend && widget.colorField) {
      const categories = [...new Set(pts.map(d => d.color))];
      const leg = g.append('g').attr('transform', `translate(${W - 10},0)`);
      categories.slice(0, 8).forEach((cat, i) => {
        leg.append('circle').attr('cx', 0).attr('cy', i * 16 + 5).attr('r', 4).attr('fill', colors(cat));
        leg.append('text').attr('x', 7).attr('y', i * 16 + 9).attr('font-size', 10).attr('fill', '#64748b')
          .text(cat.length > 12 ? cat.slice(0, 12) + '…' : cat);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, widget, dims]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="100%" />
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <strong>{widget.colorField ? tooltip.d.color : 'Point'}</strong>
          <div>{widget.xField}: {formatValue(tooltip.d.x)}</div>
          <div>{widget.yField}: {formatValue(tooltip.d.y)}</div>
          {widget.sizeField && <div>{widget.sizeField}: {formatValue(tooltip.d.size)}</div>}
        </div>
      )}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select X and Y fields (numeric)" />}
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
