import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

function NodeTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{d.label}{d.label !== d.id ? ` (${d.id})` : ''}</div>
      {d.group != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">Group</span><span className="tt-value">{d.group}</span>
        </div>
      )}
      {d.size != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField || 'Size'}</span>
          <span className="tt-value">{formatValue(d.size, widget.numberFormat)}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">Connections</span><span className="tt-value">{d.degree}</span>
      </div>
    </>
  );
}

function EdgeTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        {d.source.id ?? d.source} {widget.graphDirected ? '→' : '—'} {d.target.id ?? d.target}
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

// Compute SVG path string for an edge
function computePath(d, curved, nodeRadius) {
  const src = d.source, tgt = d.target;
  const sx = src.x ?? 0, sy = src.y ?? 0;
  const tx = tgt.x ?? 0, ty = tgt.y ?? 0;
  const srcId = src.id ?? src;
  const tgtId = tgt.id ?? tgt;

  // Self-loop
  if (srcId === tgtId) {
    const r = nodeRadius(src) + 4;
    const loop = r * 2.5;
    return `M ${sx} ${sy - r} C ${sx + loop} ${sy - loop} ${sx + loop} ${sy + loop} ${sx} ${sy + r}`;
  }

  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  if (!curved) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  // Bezier — offset control point perpendicular to the edge
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const off = Math.min(dist * 0.3, 70);
  const cx = mx - (dy / dist) * off;
  const cy = my + (dx / dist) * off;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

// Shorten path endpoint so arrowhead sits on the node perimeter
function computeArrowPath(d, curved, nodeRadius) {
  const src = d.source, tgt = d.target;
  const srcId = src.id ?? src;
  const tgtId = tgt.id ?? tgt;
  if (srcId === tgtId) return computePath(d, curved, nodeRadius); // self-loop: arrow at end of arc

  const sx = src.x ?? 0, sy = src.y ?? 0;
  const tx = tgt.x ?? 0, ty = tgt.y ?? 0;
  const dx = tx - sx, dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const r = nodeRadius(tgt) + 3;
  const ux = dx / dist, uy = dy / dist;
  const ex = tx - ux * r, ey = ty - uy * r;

  if (!curved) return `M ${sx} ${sy} L ${ex} ${ey}`;

  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const off = Math.min(dist * 0.3, 70);
  const cx = mx - (dy / dist) * off;
  const cy = my + (dx / dist) * off;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
}

export default function GraphChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const zoomRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!data?.length || !widget.sourceField || !widget.targetField || w < 20 || h < 20) return;
    if (simRef.current) simRef.current.stop();

    const agg = widget.aggregation || 'sum';
    const directed = !!widget.graphDirected;
    const curved = !!widget.graphCurvedLinks;
    const cx = w / 2, cy = h / 2;

    // ── Build graph data ──────────────────────────────────────────────────
    const edgeMap = new Map();
    const nodeSet = new Map();

    for (const row of data) {
      const src = row[widget.sourceField];
      const tgt = row[widget.targetField];
      if (src == null || tgt == null || String(src) === '' || String(tgt) === '') continue;
      const s = String(src), t = String(tgt);
      for (const id of [s, t]) {
        if (!nodeSet.has(id)) nodeSet.set(id, { groupVals: [], sizeVals: [], labelVals: [] });
      }
      if (widget.labelField && row[widget.labelField] != null)
        nodeSet.get(s).labelVals.push(String(row[widget.labelField]));
      if (widget.colorField && row[widget.colorField] != null) {
        nodeSet.get(s).groupVals.push(row[widget.colorField]);
        nodeSet.get(t).groupVals.push(row[widget.colorField]);
      }
      if (widget.sizeField) {
        const sv = +row[widget.sizeField];
        if (isFinite(sv)) { nodeSet.get(s).sizeVals.push(sv); nodeSet.get(t).sizeVals.push(sv); }
      }
      const key = directed ? `${s}\0${t}` : [s, t].sort().join('\0');
      if (!edgeMap.has(key)) edgeMap.set(key, { source: s, target: t, values: [] });
      if (widget.valueField) {
        const ev = +row[widget.valueField];
        if (isFinite(ev)) edgeMap.get(key).values.push(ev);
      }
    }

    if (nodeSet.size === 0) return;

    // Phyllotactic initial positions so nodes spread from center
    const nodeArr = [...nodeSet.keys()];
    const phi = Math.PI * (3 - Math.sqrt(5));
    const nodes = nodeArr.map((id, i) => {
      const info = nodeSet.get(id);
      const group = info.groupVals.length > 0
        ? d3.mode(info.groupVals.map(String)) ?? String(info.groupVals[0]) : null;
      const size = info.sizeVals.length > 0 ? aggregate(info.sizeVals, agg) : null;
      const label = info.labelVals.length > 0
        ? d3.mode(info.labelVals) ?? info.labelVals[0] : id;
      const r0 = Math.sqrt(i + 0.5) * 40;
      const a = phi * i;
      return { id, label, group, size, degree: 0, x: cx + r0 * Math.cos(a), y: cy + r0 * Math.sin(a) };
    });

    const edges = [...edgeMap.values()].map(e => ({
      source: e.source, target: e.target,
      value: e.values.length > 0 ? aggregate(e.values, agg) : null,
    }));

    for (const e of edges) {
      const sn = nodes.find(n => n.id === e.source);
      const tn = nodes.find(n => n.id === e.target);
      if (sn) sn.degree++;
      if (tn) tn.degree++;
    }

    // ── Scales ────────────────────────────────────────────────────────────
    const groups = [...new Set(nodes.map(n => n.group).filter(Boolean))];
    const colorScale = getColorScaleWithOverrides(widget.colorScheme, groups, widget.dimensionColors);

    const nodeSzMin = widget.graphNodeSizeMin ?? 6;
    const nodeSzMax = widget.graphNodeSizeMax ?? 24;
    const sizeExt = d3.extent(nodes, n => n.size);
    const sizeScale = sizeExt[0] != null && sizeExt[0] !== sizeExt[1]
      ? d3.scaleSqrt().domain(sizeExt).range([nodeSzMin, nodeSzMax])
      : () => (nodeSzMin + nodeSzMax) / 2;
    const nodeRadius = d => sizeScale(d.size) || 8;

    let nodeColorScale;
    const useNodeGradient = widget.colorMode === 'gradient' && sizeExt[0] != null;
    if (useNodeGradient) {
      const gk = resolveGradient(widget.colorScheme, widget.colorGradient);
      nodeColorScale = getSequentialScale(gk, sizeExt[0] ?? 0, sizeExt[1] ?? 1, widget.invertGradient, widget.logGradient);
    }

    const valExt = d3.extent(edges, e => e.value);
    const edgeWMin = widget.graphEdgeWidthMin ?? 1, edgeWMax = widget.graphEdgeWidthMax ?? 8;
    const edgeWScale = valExt[0] != null && valExt[0] !== valExt[1]
      ? d3.scaleLinear().domain(valExt).range([edgeWMin, edgeWMax])
      : () => widget.graphEdgeWidth ?? 2;

    const linkDistMode = widget.graphLinkDistanceMode || 'constant';
    const ldMin = widget.graphLinkDistanceMin ?? 60, ldMax = widget.graphLinkDistanceMax ?? 200;
    const ldScale = linkDistMode === 'measure' && valExt[0] != null && valExt[0] !== valExt[1]
      ? d3.scaleLinear().domain(valExt).range(widget.graphLinkDistanceInvert ? [ldMax, ldMin] : [ldMin, ldMax])
      : null;

    const edgeColorMode = widget.graphEdgeColorMode || 'source';
    const edgeConstColor = widget.graphEdgeColor || 'var(--text-muted)';
    let edgeColorScale = null;
    if (edgeColorMode === 'measure' && valExt[0] != null) {
      const gk = resolveGradient(widget.colorScheme, widget.colorGradient);
      edgeColorScale = getSequentialScale(gk, valExt[0], valExt[1], widget.invertGradient, widget.logGradient);
    }

    const edgeColor = e => {
      const nb = id => nodes.find(n => n.id === (id?.id ?? id));
      if (edgeColorMode === 'source') { const sn = nb(e.source); return sn?.group ? colorScale(sn.group) : edgeConstColor; }
      if (edgeColorMode === 'target') { const tn = nb(e.target); return tn?.group ? colorScale(tn.group) : edgeConstColor; }
      if (edgeColorMode === 'measure' && edgeColorScale && e.value != null) return edgeColorScale(e.value);
      return edgeConstColor;
    };
    const edgeWidth = e => (widget.graphEdgeWidthMode === 'measure' && e.value != null)
      ? edgeWScale(e.value) : (widget.graphEdgeWidth ?? 2);

    // ── SVG structure ─────────────────────────────────────────────────────
    svg.attr('width', w).attr('height', h);
    const defs = svg.append('defs');
    const clipId = `gc-${w}-${h}-${Date.now()}`;
    defs.append('clipPath').attr('id', clipId)
      .append('rect').attr('width', w).attr('height', h);

    if (directed) {
      defs.append('marker')
        .attr('id', `ga-${clipId}`)
        .attr('viewBox', '0 0 10 6').attr('refX', 10).attr('refY', 3)
        .attr('markerWidth', 8).attr('markerHeight', 6).attr('orient', 'auto')
        .append('path').attr('d', 'M0,0 L10,3 L0,6 Z').attr('fill', 'var(--text-muted)');
    }

    // Zoom layer (clips to SVG bounds)
    const zoomG = svg.append('g').attr('clip-path', `url(#${clipId})`);
    const graphG = zoomG.append('g'); // receives zoom transform

    // Fixed overlay for legend (not affected by zoom/pan)
    const overlayG = svg.append('g').attr('pointer-events', 'none');

    // ── Zoom ─────────────────────────────────────────────────────────────
    const zoom = d3.zoom()
      .scaleExtent([0.05, 10])
      .on('zoom', ev => graphG.attr('transform', ev.transform));
    svg.call(zoom);
    zoomRef.current = zoom;

    // Zoom control buttons rendered as SVG elements in the overlay
    const btnG = overlayG.append('g').attr('transform', 'translate(10, 10)').attr('pointer-events', 'all');
    const btnData = [
      { label: '+', dy: 0,  title: 'Zoom in',   fn: () => svg.transition().duration(300).call(zoom.scaleBy, 1.5) },
      { label: '−', dy: 26, title: 'Zoom out',  fn: () => svg.transition().duration(300).call(zoom.scaleBy, 0.67) },
      { label: '⊡', dy: 52, title: 'Reset zoom', fn: () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity) },
    ];
    btnData.forEach(({ label, dy, title, fn }) => {
      const bg = btnG.append('g').attr('transform', `translate(0,${dy})`).style('cursor', 'pointer').attr('title', title);
      bg.append('rect').attr('width', 22).attr('height', 22).attr('rx', 4)
        .attr('fill', 'var(--bg-card,#fff)').attr('stroke', 'var(--border,#e2e8f0)').attr('stroke-width', 1);
      bg.append('text').attr('x', 11).attr('y', 15).attr('text-anchor', 'middle')
        .attr('font-size', 14).attr('fill', 'var(--text,#333)').attr('pointer-events', 'none').text(label);
      bg.on('click', fn)
        .on('mouseenter', function() { d3.select(this).select('rect').attr('fill', 'var(--bg-hover,#f1f5f9)'); })
        .on('mouseleave', function() { d3.select(this).select('rect').attr('fill', 'var(--bg-card,#fff)'); });
    });

    // ── Force simulation ──────────────────────────────────────────────────
    const linkForce = d3.forceLink(edges).id(d => d.id).strength(widget.graphLinkStrength ?? 0.4);
    if (ldScale) {
      linkForce.distance(e => e.value != null ? ldScale(e.value) : (ldMin + ldMax) / 2);
    } else {
      linkForce.distance(widget.graphLinkDistance ?? 80);
    }

    const simulation = d3.forceSimulation(nodes)
      .force('link', linkForce)
      .force('charge', d3.forceManyBody().strength(widget.graphCharge ?? -200))
      .force('center', d3.forceCenter(cx, cy))
      .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 2));
    simRef.current = simulation;

    // ── Draw edges ────────────────────────────────────────────────────────
    const linkSel = graphG.append('g').attr('class', 'graph-links')
      .selectAll('path').data(edges).join('path')
      .attr('fill', 'none')
      .attr('stroke', e => edgeColor(e))
      .attr('stroke-width', e => edgeWidth(e))
      .attr('stroke-opacity', widget.opacity ?? 0.6)
      .attr('marker-end', directed ? `url(#ga-${clipId})` : null)
      .on('mouseover', (ev, d) => showTooltip(ev, <EdgeTip d={d} widget={widget} />))
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip);

    // ── Draw nodes ────────────────────────────────────────────────────────
    const nodeSel = graphG.append('g').attr('class', 'graph-nodes')
      .selectAll('circle').data(nodes).join('circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => useNodeGradient && d.size != null ? nodeColorScale(d.size)
        : d.group != null ? colorScale(d.group) : 'var(--accent)')
      .attr('stroke', 'var(--card-bg)').attr('stroke-width', 1.5).attr('cursor', 'pointer')
      .on('mouseover', (ev, d) => { d3.select(ev.currentTarget).attr('stroke-width', 3); showTooltip(ev, <NodeTip d={d} widget={widget} />); })
      .on('mousemove', moveTooltip)
      .on('mouseleave', ev => { d3.select(ev.currentTarget).attr('stroke-width', 1.5); hideTooltip(); })
      .on('click', (ev, d) => { if (onCrossFilter && widget.sourceField) onCrossFilter({ field: widget.sourceField, value: d.id }); });

    nodeSel.call(d3.drag()
      .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

    // ── Labels ────────────────────────────────────────────────────────────
    let labelSel = null;
    if (widget.graphShowLabels !== false) {
      labelSel = graphG.append('g').attr('class', 'graph-labels')
        .selectAll('text').data(nodes).join('text')
        .text(d => d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label)
        .attr('font-size', 'var(--chart-label-size)')
        .attr('fill', 'var(--chart-axis-color)')
        .attr('font-family', 'var(--font)')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -nodeRadius(d) - 4)
        .attr('pointer-events', 'none');
    }

    // ── Legend (fixed overlay, not affected by zoom) ───────────────────────
    if (widget.showLegend && groups.length > 0) {
      const legendG = overlayG.append('g').attr('transform', `translate(${w - 12}, 10)`).attr('text-anchor', 'end');
      groups.forEach((grp, i) => {
        const row = legendG.append('g').attr('transform', `translate(0,${i * 18})`);
        row.append('circle').attr('r', 5).attr('cx', -8).attr('cy', 0).attr('fill', colorScale(grp));
        row.append('text').text(grp)
          .attr('font-size', 11).attr('fill', 'var(--chart-axis-color)')
          .attr('font-family', 'var(--font)').attr('dy', '0.35em').attr('x', -18);
      });
    }

    // ── Tick handler ──────────────────────────────────────────────────────
    simulation.on('tick', () => {
      linkSel.attr('d', e => directed ? computeArrowPath(e, curved, nodeRadius) : computePath(e, curved, nodeRadius));
      nodeSel.attr('cx', d => d.x).attr('cy', d => d.y);
      if (labelSel) labelSel.attr('x', d => d.x).attr('y', d => d.y);
    });

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  useEffect(() => () => { if (simRef.current) simRef.current.stop(); }, []);

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
