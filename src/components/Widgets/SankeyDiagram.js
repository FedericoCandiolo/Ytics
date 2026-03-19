import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScale } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function SankeyDiagram({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.sourceField || !widget.targetField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const m = { top: 10, right: 10, bottom: 10, left: 10 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    const opacity = widget.opacity ?? 1;

    // Aggregate links: (source, target) → value
    const linkMap = new Map();
    for (const row of data) {
      const src = String(row[widget.sourceField] ?? '');
      const tgt = String(row[widget.targetField] ?? '');
      if (!src || !tgt || src === tgt) continue;
      const key = `${src}|||${tgt}`;
      if (!linkMap.has(key)) linkMap.set(key, { src, tgt, vals: [] });
      linkMap.get(key).vals.push(+row[widget.valueField] || 0);
    }

    // Build node set
    const nodeSet = new Set();
    const links = [];
    for (const { src, tgt, vals } of linkMap.values()) {
      nodeSet.add(src);
      nodeSet.add(tgt);
      links.push({ source: src, target: tgt, value: aggregate(vals, widget.aggregation || 'sum') });
    }

    if (links.length === 0) return;

    const nodeNames = [...nodeSet];
    const nodeIndex = new Map(nodeNames.map((n, i) => [n, i]));
    const nodes = nodeNames.map(name => ({ name }));
    const sankeyLinks = links.map(l => ({
      source: nodeIndex.get(l.source),
      target: nodeIndex.get(l.target),
      value: Math.max(l.value, 0.001), // sankey needs positive values
    }));

    const sankeyGen = d3Sankey()
      .nodeId(d => d.index)
      .nodeWidth(16)
      .nodePadding(12)
      .extent([[0, 0], [W, H]]);

    let graph;
    try {
      graph = sankeyGen({ nodes: nodes.map((n, i) => ({ ...n, index: i })), links: sankeyLinks });
    } catch {
      return; // circular links or other sankey issues
    }

    const colors = getColorScale(widget.colorScheme, nodeNames);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Links
    g.append('g').attr('fill', 'none')
      .selectAll('path').data(graph.links).join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', d => colors(d.source.name))
      .attr('stroke-opacity', 0.3 * opacity)
      .attr('stroke-width', d => Math.max(1, d.width))
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-opacity', 0.6);
        showTooltip(ev, <LinkTip d={d} widget={widget} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-opacity', 0.3 * opacity);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.sourceField, value: d.source.name }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Nodes
    g.append('g').selectAll('rect').data(graph.nodes).join('rect')
      .attr('x', d => d.x0).attr('y', d => d.y0)
      .attr('width', d => d.x1 - d.x0).attr('height', d => Math.max(1, d.y1 - d.y0))
      .attr('fill', d => colors(d.name)).attr('opacity', opacity).attr('rx', 3)
      .on('mouseover', (ev, d) => {
        showTooltip(ev, <NodeTip d={d} widget={widget} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.sourceField, value: d.name }); } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

    // Node labels
    g.append('g').selectAll('text').data(graph.nodes).join('text')
      .attr('x', d => d.x0 < W / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('y', d => (d.y0 + d.y1) / 2)
      .attr('text-anchor', d => d.x0 < W / 2 ? 'start' : 'end')
      .attr('dominant-baseline', 'central')
      .attr('font-size', 10.5).attr('font-family', 'var(--font)').attr('fill', 'var(--text)')
      .text(d => d.name.length > 20 ? d.name.slice(0, 20) + '…' : d.name);
  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.sourceField || !widget.targetField || !widget.valueField) && <Placeholder text="Select Source, Target, and Value fields" />}
    </div>
  );
}

function LinkTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{d.source.name} → {d.target.name}</div>
      <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(d.value)}</span></div>
    </>
  );
}

function NodeTip({ d, widget }) {
  const inflow = (d.targetLinks || []).reduce((s, l) => s + l.value, 0);
  const outflow = (d.sourceLinks || []).reduce((s, l) => s + l.value, 0);
  return (
    <>
      <div className="chart-tooltip-title">{d.name}</div>
      {inflow > 0 && <div className="chart-tooltip-row"><span className="tt-label">Inflow</span><span className="tt-value">{formatValue(inflow)}</span></div>}
      {outflow > 0 && <div className="chart-tooltip-row"><span className="tt-label">Outflow</span><span className="tt-value">{formatValue(outflow)}</span></div>}
    </>
  );
}
