import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder, fmtTick } from './chartHelpers';

const CURVES = {
  linear: d3.curveLinear, monotone: d3.curveMonotoneX,
  step: d3.curveStep, stepBefore: d3.curveStepBefore,
  stepAfter: d3.curveStepAfter, cardinal: d3.curveCardinal,
};

export default function LineChart({ widget, data }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 16, right: widget.showLegend ? 110 : 20, bottom: 52, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Group into series
    const seriesMap = new Map();
    for (const row of data) {
      const key = widget.colorField ? String(row[widget.colorField] ?? '') : '__all__';
      if (!seriesMap.has(key)) seriesMap.set(key, []);
      seriesMap.get(key).push({ x: row[widget.xField], y: +row[widget.yField] || 0, raw: row });
    }
    const seriesNames = Array.from(seriesMap.keys());
    const colors = getColorScale(widget.colorScheme, seriesNames);
    const opacity = widget.opacity ?? 1;

    // X scale detection
    const allX = [...seriesMap.values()].flat().map(d => d.x);
    const isNum = allX.every(v => typeof v === 'number' && !isNaN(v));
    const isDate = !isNum && allX.every(v => !isNaN(Date.parse(String(v))));


    let xScale;
    if (isNum) xScale = d3.scaleLinear().domain(d3.extent(allX)).range([0, W]).nice();
    else if (isDate) xScale = d3.scaleTime().domain(d3.extent(allX.map(v => new Date(v)))).range([0, W]).nice();
    else xScale = d3.scalePoint().domain([...new Set(allX.map(String))]).range([0, W]).padding(0.1);

    const allY = [...seriesMap.values()].flat().map(d => d.y);
    const yScale = d3.scaleLinear().domain([Math.min(0, d3.min(allY)), d3.max(allY) * 1.08]).range([H, 0]).nice();

    const curve = CURVES[widget.lineType] || d3.curveMonotoneX;
    const xPos = d => (isDate ? xScale(new Date(d.x)) : isNum ? xScale(d.x) : xScale(String(d.x)));
    const lineGen = d3.line().x(xPos).y(d => yScale(d.y)).curve(curve).defined(d => !isNaN(d.y));
    const areaGen = d3.area().x(xPos).y0(H).y1(d => yScale(d.y)).curve(curve).defined(d => !isNaN(d.y));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Defs for gradient areas
    const defs = svg.append('defs');

    // Grid
    if (widget.showGrid) {
      g.append('g').call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)').attr('stroke-dasharray', '3,3'));
    }

    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(6))
      .call(styledAxis).selectAll('text').attr('dy', '1em')
      .attr('transform', isDate ? '' : 'rotate(-30)').style('text-anchor', isDate ? 'middle' : 'end');
    g.append('g').call(d3.axisLeft(yScale).ticks(5).tickFormat(fmtTick)).call(styledAxis);

    // Series
    seriesNames.forEach((name, si) => {
      const color = colors(name);
      let pts = seriesMap.get(name);
      if (isNum || isDate) pts = [...pts].sort((a, b) => (isDate ? new Date(a.x) - new Date(b.x) : a.x - b.x));

      if (widget.showArea) {
        const gradId = `area-grad-${si}`;
        const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
        grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.22);
        grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
        g.append('path').datum(pts).attr('fill', `url(#${gradId})`).attr('d', areaGen);
      }

      // Animate path draw
      const path = g.append('path').datum(pts)
        .attr('fill', 'none').attr('stroke', color)
        .attr('stroke-width', 2.5).attr('opacity', opacity).attr('d', lineGen);
      const len = path.node()?.getTotalLength() || 0;
      path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

      if (widget.showPoints) {
        g.selectAll(`.pt-${si}`).data(pts.filter(d => !isNaN(d.y))).join('circle')
          .attr('class', `pt-${si}`)
          .attr('cx', xPos).attr('cy', d => yScale(d.y))
          .attr('r', 0).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('opacity', opacity)
          .transition().delay(600).duration(200).attr('r', 4);
      }
    });

    // Legend
    if (widget.showLegend && widget.colorField && seriesNames.length > 1) {
      const leg = g.append('g').attr('transform', `translate(${W + 8}, 0)`);
      seriesNames.slice(0, 10).forEach((name, i) => {
        const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('line').attr('x1', 0).attr('y1', 7).attr('x2', 14).attr('y2', 7)
          .attr('stroke', colors(name)).attr('stroke-width', 2.5).attr('stroke-linecap', 'round');
        row.append('text').attr('x', 18).attr('y', 10.5)
          .attr('font-size', 10.5).attr('font-family', 'var(--font)').attr('fill', 'var(--text-muted)')
          .text(name.length > 13 ? name.slice(0, 13) + '…' : name);
      });
    }

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 46).text(widget.xField);

    // Hover overlay
    const sortedXs = isNum || isDate
      ? [...new Set(allX.map(v => isDate ? new Date(v).getTime() : +v))].sort((a, b) => a - b)
      : [...new Set(allX.map(String))];

    const focusLine = g.append('line').attr('y1', 0).attr('y2', H)
      .attr('stroke', 'var(--chart-axis-color)').attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,3').style('display', 'none').style('pointer-events', 'none');

    const focusDots = seriesNames.map(name => {
      const dot = g.append('circle').attr('r', 5).attr('stroke', '#fff').attr('stroke-width', 2)
        .attr('fill', colors(name)).style('display', 'none').style('pointer-events', 'none');
      return { name, dot };
    });

    svg.append('rect')
      .attr('width', W).attr('height', H)
      .attr('transform', `translate(${m.left},${m.top})`)
      .attr('fill', 'none').attr('pointer-events', 'all')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev, g.node());
        // Find nearest X
        let closestX;
        if (isNum || isDate) {
          const bisect = d3.bisectCenter(sortedXs, isDate ? mx + xScale.domain()[0].getTime() - xScale(xScale.domain()[0]) : xScale.invert(mx));
          closestX = sortedXs[Math.max(0, Math.min(sortedXs.length - 1, bisect))];
        } else {
          const each = W / sortedXs.length;
          const idx = Math.max(0, Math.min(sortedXs.length - 1, Math.round(mx / each)));
          closestX = sortedXs[idx];
        }

        const cx = isDate ? xScale(new Date(closestX)) : isNum ? xScale(closestX) : xScale(String(closestX));
        focusLine.style('display', null).attr('transform', `translate(${cx},0)`);

        const vals = seriesNames.map(name => {
          const pts = seriesMap.get(name);
          const pt = isNum || isDate
            ? pts.reduce((best, p) => {
                const pv = isDate ? new Date(p.x).getTime() : +p.x;
                const bv = isDate ? new Date(best.x).getTime() : +best.x;
                return Math.abs(pv - closestX) < Math.abs(bv - closestX) ? p : best;
              }, pts[0])
            : pts.find(p => String(p.x) === String(closestX));
          if (pt) focusDots.find(d => d.name === name)?.dot.style('display', null).attr('cx', cx).attr('cy', yScale(pt.y));
          return { name, value: pt?.y };
        }).filter(s => s.value !== undefined);

        const xLabel = isDate ? new Date(closestX).toLocaleDateString() : String(closestX);
        showTooltip(ev, <LineTip xLabel={xLabel} vals={vals} colors={colors} widget={widget} seriesNames={seriesNames} />);
        moveTooltip(ev);
      })
      .on('mouseleave', () => {
        focusLine.style('display', 'none');
        focusDots.forEach(d => d.dot.style('display', 'none'));
        hideTooltip();
      });
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField) && <Placeholder text="Select X and Y fields" />}
    </div>
  );
}

function LineTip({ xLabel, vals, colors, widget, seriesNames }) {
  return (
    <>
      <div className="chart-tooltip-title">{xLabel}</div>
      {vals.map(s => (
        <div key={s.name} className="chart-tooltip-row">
          <span className="tt-dot" style={{ background: colors(s.name) }} />
          <span className="tt-label">{s.name === '__all__' ? widget.yField : s.name}</span>
          <span className="tt-value">{formatValue(s.value)}</span>
        </div>
      ))}
      {vals.length > 1 && (
        <div className="chart-tooltip-stat">
          Σ {formatValue(vals.reduce((s, v) => s + (v.value || 0), 0))}
        </div>
      )}
    </>
  );
}
