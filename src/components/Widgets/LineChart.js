import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';

const SCHEMES = {
  tableau10: d3.schemeTableau10, category10: d3.schemeCategory10,
  set2: d3.schemeSet2, set3: d3.schemeSet3, pastel1: d3.schemePastel1,
  dark2: d3.schemeDark2, paired: d3.schemePaired, accent: d3.schemeAccent,
};

const CURVES = {
  linear: d3.curveLinear, monotone: d3.curveMonotoneX, step: d3.curveStep,
  stepBefore: d3.curveStepBefore, stepAfter: d3.curveStepAfter, cardinal: d3.curveCardinal,
};

export default function LineChart({ widget, data }) {
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

    // Group by colorField (series)
    const seriesMap = new Map();
    for (const row of data) {
      const key = widget.colorField ? String(row[widget.colorField] ?? '') : '__all__';
      if (!seriesMap.has(key)) seriesMap.set(key, []);
      seriesMap.get(key).push({ x: row[widget.xField], y: +row[widget.yField] || 0 });
    }
    const seriesNames = Array.from(seriesMap.keys());
    const colors = d3.scaleOrdinal(SCHEMES[widget.colorScheme] || d3.schemeTableau10).domain(seriesNames);
    const opacity = widget.opacity ?? 1;

    // Determine X scale type
    const allX = Array.from(seriesMap.values()).flat().map(d => d.x);
    const isNumericX = allX.every(v => typeof v === 'number' && !isNaN(v));
    const isDateX = !isNumericX && allX.every(v => !isNaN(Date.parse(String(v))));

    let xScale;
    if (isNumericX) {
      xScale = d3.scaleLinear().domain(d3.extent(allX)).range([0, W]).nice();
    } else if (isDateX) {
      xScale = d3.scaleTime().domain(d3.extent(allX.map(v => new Date(v)))).range([0, W]).nice();
    } else {
      const domain = [...new Set(allX.map(String))];
      xScale = d3.scalePoint().domain(domain).range([0, W]).padding(0.1);
    }

    const allY = Array.from(seriesMap.values()).flat().map(d => d.y);
    const yScale = d3.scaleLinear().domain([d3.min(allY) * 0.95 || 0, d3.max(allY) * 1.05 || 1]).range([H, 0]).nice();

    const curve = CURVES[widget.lineType] || d3.curveLinear;
    const lineGen = d3.line()
      .x(d => isDateX ? xScale(new Date(d.x)) : isNumericX ? xScale(d.x) : xScale(String(d.x)))
      .y(d => yScale(d.y))
      .curve(curve)
      .defined(d => d.y !== null && !isNaN(d.y));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Grid
    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'));
    }

    // Axes
    const xAxis = isDateX ? d3.axisBottom(xScale).ticks(5) :
      isNumericX ? d3.axisBottom(xScale).ticks(5).tickFormat(formatValue) :
        d3.axisBottom(xScale);

    g.append('g').attr('transform', `translate(0,${H})`)
      .call(xAxis)
      .call(styled)
      .selectAll('text')
      .attr('transform', isDateX ? '' : 'rotate(-30)')
      .style('text-anchor', isDateX ? 'middle' : 'end')
      .attr('font-size', 11);

    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(formatValue)).call(styled);

    // Draw series
    const bisectX = (pts, mx) => {
      const xVal = xScale.invert ? xScale.invert(mx) : null;
      if (!xVal) return null;
      const bisect = d3.bisector(d => isDateX ? new Date(d.x) : d.x).left;
      const i = bisect(pts, xVal, 1);
      const a = pts[i - 1], b = pts[i];
      if (!a) return b;
      if (!b) return a;
      return (isDateX ? Math.abs(new Date(b.x) - xVal) : Math.abs(b.x - xVal)) <
        (isDateX ? Math.abs(new Date(a.x) - xVal) : Math.abs(a.x - xVal)) ? b : a;
    };

    seriesNames.forEach(name => {
      let pts = seriesMap.get(name);
      if (!isNumericX && !isDateX) {
        // keep order of domain for point scale
      } else {
        pts = [...pts].sort((a, b) => {
          const va = isDateX ? new Date(a.x) : a.x;
          const vb = isDateX ? new Date(b.x) : b.x;
          return va < vb ? -1 : va > vb ? 1 : 0;
        });
      }

      const color = colors(name);

      if (widget.showArea) {
        const area = d3.area()
          .x(d => isDateX ? xScale(new Date(d.x)) : isNumericX ? xScale(d.x) : xScale(String(d.x)))
          .y0(H).y1(d => yScale(d.y))
          .curve(curve)
          .defined(d => d.y !== null && !isNaN(d.y));
        g.append('path').datum(pts).attr('fill', color).attr('opacity', 0.15).attr('d', area);
      }

      g.append('path').datum(pts)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2.5)
        .attr('opacity', opacity)
        .attr('d', lineGen);

      if (widget.showPoints) {
        g.selectAll(`.dot-${name.replace(/\W/g, '_')}`)
          .data(pts.filter(d => d.y !== null && !isNaN(d.y)))
          .join('circle')
          .attr('cx', d => isDateX ? xScale(new Date(d.x)) : isNumericX ? xScale(d.x) : xScale(String(d.x)))
          .attr('cy', d => yScale(d.y))
          .attr('r', 4).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5)
          .attr('opacity', opacity);
      }
    });

    // Hover overlay
    const focus = g.append('g').style('display', 'none');
    focus.append('line').attr('class', 'focus-line').attr('y1', 0).attr('y2', H)
      .attr('stroke', '#94a3b8').attr('stroke-width', 1).attr('stroke-dasharray', '4,3');
    focus.append('circle').attr('r', 5).attr('fill', '#3b82f6').attr('stroke', '#fff').attr('stroke-width', 2);

    svg.append('rect')
      .attr('width', W).attr('height', H)
      .attr('transform', `translate(${m.left},${m.top})`)
      .attr('fill', 'none').attr('pointer-events', 'all')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev);
        const firstSeries = Array.from(seriesMap.values())[0];
        if (!firstSeries) return;
        const d = bisectX(firstSeries, mx);
        if (!d) return;
        const cx = isDateX ? xScale(new Date(d.x)) : isNumericX ? xScale(d.x) : xScale(String(d.x));
        focus.style('display', null);
        focus.select('line').attr('transform', `translate(${cx},0)`);
        focus.select('circle').attr('transform', `translate(${cx},${yScale(d.y)})`);
        const seriesVals = seriesNames.map(n => {
          const pt = seriesMap.get(n)?.find(p => String(p.x) === String(d.x));
          return { name: n, value: pt?.y };
        }).filter(s => s.value !== undefined);
        setTooltip({ x: ev.offsetX, y: ev.offsetY, x_val: d.x, series: seriesVals });
      })
      .on('mouseleave', () => { focus.style('display', 'none'); setTooltip(null); });

    // Legend
    if (widget.showLegend && widget.colorField && seriesNames.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W - 10},0)`);
      seriesNames.slice(0, 8).forEach((name, i) => {
        const ly = i * 16;
        leg.append('circle').attr('cx', 0).attr('cy', ly + 5).attr('r', 4).attr('fill', colors(name));
        leg.append('text').attr('x', 7).attr('y', ly + 9).attr('font-size', 10).attr('fill', '#64748b').text(name.length > 12 ? name.slice(0, 12) + '…' : name);
      });
    }

    g.append('text').attr('fill', '#94a3b8').attr('font-size', 11).attr('text-anchor', 'middle')
      .attr('x', W / 2).attr('y', H + 44).text(widget.xField);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, widget, dims]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="100%" />
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
          <strong>{String(tooltip.x_val)}</strong>
          {tooltip.series.map(s => (
            <div key={s.name}>{s.name === '__all__' ? widget.yField : s.name}: {formatValue(s.value)}</div>
          ))}
        </div>
      )}
      {(!widget.xField || !widget.yField) && (
        <Placeholder text="Select X and Y fields" />
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
