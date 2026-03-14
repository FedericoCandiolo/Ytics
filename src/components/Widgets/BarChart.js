import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';

const SCHEMES = {
  tableau10: d3.schemeTableau10,
  category10: d3.schemeCategory10,
  set2: d3.schemeSet2,
  set3: d3.schemeSet3,
  pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2,
  paired: d3.schemePaired,
  accent: d3.schemeAccent,
};

export default function BarChart({ widget, data }) {
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

    const isH = widget.orientation === 'horizontal';
    const m = { top: 14, right: 14, bottom: isH ? 44 : 64, left: isH ? 120 : 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Aggregate
    const groups = new Map();
    for (const row of data) {
      const key = String(row[widget.xField] ?? '');
      const val = +row[widget.yField] || 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(val);
    }
    let pts = Array.from(groups, ([key, vals]) => ({ key, value: aggregate(vals, widget.aggregation || 'sum') }));

    // Sort
    if (widget.sortBy === 'label') {
      pts.sort((a, b) => widget.sortOrder === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key));
    } else {
      pts.sort((a, b) => widget.sortOrder === 'desc' ? b.value - a.value : a.value - b.value);
    }

    const colors = d3.scaleOrdinal(SCHEMES[widget.colorScheme] || d3.schemeTableau10);
    const opacity = widget.opacity ?? 1;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    const maxVal = d3.max(pts, d => d.value) * 1.05 || 1;

    if (isH) {
      const y = d3.scaleBand().domain(pts.map(d => d.key)).range([0, H]).padding(0.2);
      const x = d3.scaleLinear().domain([0, maxVal]).range([0, W]).nice();

      if (widget.showGrid) {
        g.append('g').call(d3.axisTop(x).tickSize(-H).tickFormat(''))
          .call(a => a.select('.domain').remove())
          .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
      }

      g.append('g').attr('transform', `translate(0,${H})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(formatValue))
        .call(styled);

      g.append('g')
        .call(d3.axisLeft(y).tickFormat(d => d.length > 16 ? d.slice(0, 16) + '…' : d))
        .call(styled);

      g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
        .attr('y', d => y(d.key)).attr('x', 0)
        .attr('height', y.bandwidth()).attr('width', d => x(d.value))
        .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 3)
        .on('mouseenter', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', Math.min(1, opacity + 0.15)); showTip(ev, d); })
        .on('mousemove', ev => moveTip(ev))
        .on('mouseleave', ev => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTip(); });

    } else {
      const x = d3.scaleBand().domain(pts.map(d => d.key)).range([0, W]).padding(0.2);
      const y = d3.scaleLinear().domain([0, maxVal]).range([H, 0]).nice();

      if (widget.showGrid) {
        g.append('g').call(d3.axisLeft(y).tickSize(-W).tickFormat(''))
          .call(a => a.select('.domain').remove())
          .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
      }

      g.append('g').attr('transform', `translate(0,${H})`)
        .call(d3.axisBottom(x).tickFormat(d => d.length > 10 ? d.slice(0, 10) + '…' : d))
        .call(styled)
        .selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end');

      g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(formatValue)).call(styled);

      g.selectAll('.bar').data(pts).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.key)).attr('y', d => y(d.value))
        .attr('width', x.bandwidth()).attr('height', d => H - y(d.value))
        .attr('fill', d => colors(d.key)).attr('opacity', opacity).attr('rx', 3)
        .on('mouseenter', (ev, d) => { d3.select(ev.currentTarget).attr('opacity', Math.min(1, opacity + 0.15)); showTip(ev, d); })
        .on('mousemove', ev => moveTip(ev))
        .on('mouseleave', ev => { d3.select(ev.currentTarget).attr('opacity', opacity); hideTip(); });
    }

    // Axis labels
    g.append('text').attr('class', 'axis-label')
      .attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', isH ? W / 2 : W / 2)
      .attr('y', isH ? H + 38 : H + 52)
      .text(isH ? widget.yField : widget.xField);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, widget, dims]);

  const showTip = (ev, d) => setTooltip({ x: ev.offsetX, y: ev.offsetY, key: d.key, value: d.value });
  const moveTip = (ev) => setTooltip(t => t ? { ...t, x: ev.offsetX, y: ev.offsetY } : t);
  const hideTip = () => setTooltip(null);

  const noData = !widget.xField || !widget.yField;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="100%" />
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <strong>{tooltip.key}</strong>
          {widget.yField}: {formatValue(tooltip.value)}
        </div>
      )}
      {noData && (
        <Placeholder text={`Select X field and Y field${!widget.datasetId ? ' (no dataset)' : ''}`} />
      )}
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
