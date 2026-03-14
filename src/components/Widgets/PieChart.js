import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';

const SCHEMES = {
  tableau10: d3.schemeTableau10, category10: d3.schemeCategory10,
  set2: d3.schemeSet2, set3: d3.schemeSet3, pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2, paired: d3.schemePaired, accent: d3.schemeAccent,
};

export default function PieChart({ widget, data }) {
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
    if (!data?.length || !widget.labelField || !widget.valueField || w < 10 || h < 10) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const legendWidth = widget.showLegend ? 120 : 0;
    const availW = w - legendWidth;
    const radius = Math.min(availW, h) / 2 - 16;
    if (radius < 10) return;

    const innerRadius = ((widget.innerRadius ?? 0) / 100) * radius;
    const cx = availW / 2;
    const cy = h / 2;

    // Aggregate
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.labelField] ?? '');
      const val = +row[widget.valueField] || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(val);
    }
    let pts = Array.from(groups, ([key, vals]) => ({ key, value: aggregate(vals, 'sum') }));
    if (widget.sortByValue !== false) pts.sort((a, b) => b.value - a.value);

    const total = pts.reduce((s, d) => s + d.value, 0);
    const colors = d3.scaleOrdinal(SCHEMES[widget.colorScheme] || d3.schemeTableau10).domain(pts.map(d => d.key));
    const opacity = widget.opacity ?? 1;

    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcHover = d3.arc().innerRadius(innerRadius).outerRadius(radius + 6);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const arcs = pie(pts);
    g.selectAll('.slice').data(arcs).join('path').attr('class', 'slice')
      .attr('d', arc)
      .attr('fill', d => colors(d.data.key))
      .attr('opacity', opacity)
      .attr('stroke', '#fff').attr('stroke-width', 2)
      .on('mouseenter', (ev, d) => {
        d3.select(ev.currentTarget).attr('d', arcHover).attr('opacity', 1);
        const pct = ((d.data.value / total) * 100).toFixed(1);
        setTooltip({ x: ev.offsetX, y: ev.offsetY, key: d.data.key, value: d.data.value, pct });
      })
      .on('mousemove', ev => setTooltip(t => t ? { ...t, x: ev.offsetX, y: ev.offsetY } : t))
      .on('mouseleave', ev => {
        d3.select(ev.currentTarget).attr('d', arc).attr('opacity', opacity);
        setTooltip(null);
      });

    // Center label for donut
    if (innerRadius > 0) {
      g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 14).attr('font-weight', 600).attr('fill', '#0f172a')
        .text(formatValue(total));
      g.append('text').attr('text-anchor', 'middle').attr('dy', '1.5em')
        .attr('font-size', 11).attr('fill', '#64748b').text('total');
    }

    // Legend
    if (widget.showLegend) {
      const leg = svg.append('g').attr('transform', `translate(${availW + 8}, ${Math.max(8, cy - pts.length * 9)})`);
      pts.slice(0, 12).forEach((d, i) => {
        leg.append('rect').attr('x', 0).attr('y', i * 18).attr('width', 10).attr('height', 10)
          .attr('fill', colors(d.key)).attr('rx', 2);
        leg.append('text').attr('x', 14).attr('y', i * 18 + 9)
          .attr('font-size', 10).attr('fill', '#64748b')
          .text(d.key.length > 14 ? d.key.slice(0, 14) + '…' : d.key);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, widget, dims]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="100%" />
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <strong>{tooltip.key}</strong>
          <div>{widget.valueField}: {formatValue(tooltip.value)}</div>
          <div>{tooltip.pct}% of total</div>
        </div>
      )}
      {(!widget.labelField || !widget.valueField) && <Placeholder text="Select Label and Value fields" />}
    </div>
  );
}

function Placeholder({ text }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#94a3b8', fontSize: 12, pointerEvents: 'none',
    }}>{text}</div>
  );
}
