import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder, styledAxis, fmtTick } from './chartHelpers';

// ── Tooltip components ──────────────────────────────────────────────────────

function NodeTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{d.label}{d.label !== d.id ? ` (${d.id})` : ''}</div>
      {d.group != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">Group</span>
          <span className="tt-value">{d.group}</span>
        </div>
      )}
      {d.size != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField || 'Size'}</span>
          <span className="tt-value">{formatValue(d.size, widget.numberFormat)}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">Connections</span>
        <span className="tt-value">{d.degree}</span>
      </div>
    </>
  );
}

function EdgeTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        {d.source.id} {widget.graphDirected ? '→' : '—'} {d.target.id}
      </div>
      {d.value != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.valueField || 'Value'}</span>
          <span className="tt-value">{formatValue(d.value, widget.numberFormat)}</span>
        </div>
      )}
    </>
  );
}

export default function GraphChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!data?.length || !widget.sourceField || !widget.targetField || w < 20 || h < 20) return;

    // Stop any existing simulation
    if (simRef.current) simRef.current.stop();

    const agg = widget.aggregation || 'sum';
    const directed = !!widget.graphDirected;

    // ── Build nodes & edges from data ─────────────────────────────────────
    const edgeMap = new Map();
    const nodeSet = new Map(); // id → { groupVals[], sizeVals[], labelVals[] }

    for (const row of data) {
      const src = row[widget.sourceField];
      const tgt = row[widget.targetField];
      if (src == null || tgt == null || String(src) === '' || String(tgt) === '') continue;

      const srcStr = String(src);
      const tgtStr = String(tgt);

      // Collect node info
      for (const id of [srcStr, tgtStr]) {
        if (!nodeSet.has(id)) nodeSet.set(id, { groupVals: [], sizeVals: [], labelVals: [] });
      }
      if (widget.labelField) {
        // Assign label to the source node from the same row
        if (row[widget.labelField] != null) {
          nodeSet.get(srcStr).labelVals.push(String(row[widget.labelField]));
        }
      }
      if (widget.colorField && row[widget.colorField] != null) {
        nodeSet.get(srcStr).groupVals.push(row[widget.colorField]);
        nodeSet.get(tgtStr).groupVals.push(row[widget.colorField]);
      }
      if (widget.sizeField) {
        const sv = +row[widget.sizeField];
        if (isFinite(sv)) {
          nodeSet.get(srcStr).sizeVals.push(sv);
          nodeSet.get(tgtStr).sizeVals.push(sv);
        }
      }

      // Collect edge info
      const edgeKey = directed ? `${srcStr}\0${tgtStr}` : [srcStr, tgtStr].sort().join('\0');
      if (!edgeMap.has(edgeKey)) edgeMap.set(edgeKey, { source: srcStr, target: tgtStr, values: [] });
      if (widget.valueField) {
        const ev = +row[widget.valueField];
        if (isFinite(ev)) edgeMap.get(edgeKey).values.push(ev);
      }
    }

    if (nodeSet.size === 0) return;

    // Build node array
    const nodes = [];
    for (const [id, info] of nodeSet) {
      const group = info.groupVals.length > 0
        ? d3.mode(info.groupVals.map(String)) ?? String(info.groupVals[0])
        : null;
      const size = info.sizeVals.length > 0 ? aggregate(info.sizeVals, agg) : null;
      const label = info.labelVals.length > 0
        ? d3.mode(info.labelVals) ?? info.labelVals[0]
        : id;
      nodes.push({ id, label, group, size, degree: 0 });
    }

    // Build edge array
    const edges = [];
    for (const e of edgeMap.values()) {
      const value = e.values.length > 0 ? aggregate(e.values, agg) : null;
      edges.push({ source: e.source, target: e.target, value });
    }

    // Compute degree
    for (const e of edges) {
      const sn = nodes.find(n => n.id === e.source);
      const tn = nodes.find(n => n.id === e.target);
      if (sn) sn.degree++;
      if (tn) tn.degree++;
    }

    // ── Scales ────────────────────────────────────────────────────────────
    const groups = [...new Set(nodes.map(n => n.group).filter(g => g != null))];
    const colorScale = getColorScaleWithOverrides(
      widget.colorScheme, groups, widget.dimensionColors
    );

    const nodeSizeMin = widget.graphNodeSizeMin ?? 6;
    const nodeSizeMax = widget.graphNodeSizeMax ?? 24;
    const sizeExtent = d3.extent(nodes, n => n.size);

    let nodeColorScale;
    const useNodeGradient = widget.colorMode === 'gradient' && sizeExtent[0] != null;
    if (useNodeGradient) {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      nodeColorScale = getSequentialScale(gradKey, sizeExtent[0] ?? 0, sizeExtent[1] ?? 1, widget.invertGradient, widget.logGradient);
    }
    const sizeScale = sizeExtent[0] != null && sizeExtent[0] !== sizeExtent[1]
      ? d3.scaleSqrt().domain(sizeExtent).range([nodeSizeMin, nodeSizeMax])
      : () => (nodeSizeMin + nodeSizeMax) / 2;

    const edgeWidthMin = widget.graphEdgeWidthMin ?? 1;
    const edgeWidthMax = widget.graphEdgeWidthMax ?? 8;
    const valueExtent = d3.extent(edges, e => e.value);
    const edgeWidthScale = valueExtent[0] != null && valueExtent[0] !== valueExtent[1]
      ? d3.scaleLinear().domain(valueExtent).range([edgeWidthMin, edgeWidthMax])
      : () => widget.graphEdgeWidth ?? 2;

    // Edge color mode
    const edgeColorMode = widget.graphEdgeColorMode || 'source';
    const edgeConstantColor = widget.graphEdgeColor || 'var(--text-muted)';

    // Gradient scale for edge measure coloring
    let edgeColorScale = null;
    if (edgeColorMode === 'measure' && valueExtent[0] != null) {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      edgeColorScale = getSequentialScale(gradKey, valueExtent[0], valueExtent[1], widget.invertGradient, widget.logGradient);
    }

    function edgeColor(e) {
      const nodeById = id => nodes.find(n => n.id === (typeof id === 'object' ? id.id : id));
      if (edgeColorMode === 'source') {
        const sn = nodeById(e.source);
        return sn?.group != null ? colorScale(sn.group) : 'var(--text-muted)';
      }
      if (edgeColorMode === 'target') {
        const tn = nodeById(e.target);
        return tn?.group != null ? colorScale(tn.group) : 'var(--text-muted)';
      }
      if (edgeColorMode === 'measure' && edgeColorScale && e.value != null) {
        return edgeColorScale(e.value);
      }
      return edgeConstantColor;
    }

    function edgeWidth(e) {
      if (widget.graphEdgeWidthMode === 'measure' && e.value != null) {
        return edgeWidthScale(e.value);
      }
      return widget.graphEdgeWidth ?? 2;
    }

    // ── SVG setup ─────────────────────────────────────────────────────────
    const g = svg
      .attr('width', w).attr('height', h)
      .append('g');

    // Arrowhead marker for directed graphs
    if (directed) {
      svg.append('defs').append('marker')
        .attr('id', 'graph-arrow')
        .attr('viewBox', '0 0 10 6')
        .attr('refX', 10).attr('refY', 3)
        .attr('markerWidth', 8).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,0 L10,3 L0,6 Z')
        .attr('fill', 'var(--text-muted)');
    }

    // ── Force simulation ──────────────────────────────────────────────────
    const strength = widget.graphLinkStrength ?? 0.4;
    const charge = widget.graphCharge ?? -200;

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(80).strength(strength))
      .force('charge', d3.forceManyBody().strength(charge))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collision', d3.forceCollide().radius(d => (sizeScale(d.size) || 8) + 2));

    simRef.current = simulation;

    // ── Draw edges ────────────────────────────────────────────────────────
    const linkGroup = g.append('g').attr('class', 'graph-links');
    const link = linkGroup.selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', e => edgeColor(e))
      .attr('stroke-width', e => edgeWidth(e))
      .attr('stroke-opacity', widget.opacity ?? 0.6)
      .attr('marker-end', directed ? 'url(#graph-arrow)' : null)
      .on('mouseover', (ev, d) => showTooltip(ev, <EdgeTip d={d} widget={widget} />))
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip);

    // ── Draw nodes ────────────────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'graph-nodes');
    const node = nodeGroup.selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => sizeScale(d.size) || 8)
      .attr('fill', d => useNodeGradient && d.size != null ? nodeColorScale(d.size) : d.group != null ? colorScale(d.group) : 'var(--accent)')
      .attr('stroke', 'var(--card-bg)')
      .attr('stroke-width', 1.5)
      .attr('cursor', 'pointer')
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke-width', 3);
        showTooltip(ev, <NodeTip d={d} widget={widget} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke-width', 1.5);
        hideTooltip();
      })
      .on('click', (ev, d) => {
        if (onCrossFilter && widget.sourceField) {
          onCrossFilter({ field: widget.sourceField, value: d.id });
        }
      });

    // Drag behavior
    node.call(d3.drag()
      .on('start', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (ev, d) => {
        d.fx = ev.x; d.fy = ev.y;
      })
      .on('end', (ev, d) => {
        if (!ev.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      })
    );

    // ── Labels ────────────────────────────────────────────────────────────
    const showLabels = widget.graphShowLabels !== false;
    let label = null;
    if (showLabels) {
      label = g.append('g').attr('class', 'graph-labels')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .text(d => { const l = d.label; return l.length > 20 ? l.slice(0, 19) + '…' : l; })
        .attr('font-size', 'var(--chart-label-size)')
        .attr('fill', 'var(--chart-axis-color)')
        .attr('font-family', 'var(--font)')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -(sizeScale(d.size) || 8) - 4)
        .attr('pointer-events', 'none');
    }

    // ── Legend ─────────────────────────────────────────────────────────────
    if (widget.showLegend && groups.length > 0) {
      const legend = g.append('g')
        .attr('transform', `translate(${w - 10}, 10)`)
        .attr('text-anchor', 'end');
      groups.forEach((grp, i) => {
        const row = legend.append('g').attr('transform', `translate(0, ${i * 18})`);
        row.append('circle').attr('r', 5).attr('cx', -8).attr('cy', 0)
          .attr('fill', colorScale(grp));
        row.append('text').text(grp)
          .attr('font-size', 11).attr('fill', 'var(--chart-axis-color)')
          .attr('font-family', 'var(--font)')
          .attr('dy', '0.35em').attr('x', -18);
      });
    }

    // ── Tick handler ──────────────────────────────────────────────────────
    simulation.on('tick', () => {
      // Clamp nodes within bounds
      for (const d of nodes) {
        const r = sizeScale(d.size) || 8;
        d.x = Math.max(r, Math.min(w - r, d.x));
        d.y = Math.max(r, Math.min(h - r, d.y));
      }

      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => {
          if (!directed) return d.target.x;
          // Shorten line for arrowhead
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const r = sizeScale(d.target.size) || 8;
          return d.target.x - (dx / dist) * (r + 2);
        })
        .attr('y2', d => {
          if (!directed) return d.target.y;
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const r = sizeScale(d.target.size) || 8;
          return d.target.y - (dy / dist) * (r + 2);
        });

      node.attr('cx', d => d.x).attr('cy', d => d.y);

      if (label) {
        label.attr('x', d => d.x).attr('y', d => d.y);
      }
    });

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  // Cleanup simulation on unmount
  useEffect(() => {
    return () => { if (simRef.current) simRef.current.stop(); };
  }, []);

  if (!widget.sourceField || !widget.targetField) {
    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Placeholder text="Set Source and Target fields" />
        <svg ref={svgRef} />
        {tooltipEl}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      {tooltipEl}
    </div>
  );
}
