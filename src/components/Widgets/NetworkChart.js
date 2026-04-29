import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

// ── Tooltip components ──────────────────────────────────────────────────────

function NodeTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{d.data.label}</div>
      {d.data.label !== d.data.id && (
        <div className="chart-tooltip-row">
          <span className="tt-label">ID</span>
          <span className="tt-value">{d.data.id}</span>
        </div>
      )}
      {d.data.group != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">Group</span>
          <span className="tt-value">{d.data.group}</span>
        </div>
      )}
      {d.data.size != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField || 'Size'}</span>
          <span className="tt-value">{formatValue(d.data.size, widget.numberFormat)}</span>
        </div>
      )}
      {d.children && (
        <div className="chart-tooltip-row">
          <span className="tt-label">Children</span>
          <span className="tt-value">{d.children.length}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">Depth</span>
        <span className="tt-value">{d.depth}</span>
      </div>
    </>
  );
}

function LinkTip({ d, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">
        {d.source.data.label} → {d.target.data.label}
      </div>
      {d.target.data.size != null && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.sizeField || 'Value'}</span>
          <span className="tt-value">{formatValue(d.target.data.size, widget.numberFormat)}</span>
        </div>
      )}
    </>
  );
}

export default function NetworkChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (!data?.length || !widget.sourceField || !widget.targetField || w < 20 || h < 20) return;

    const agg = widget.aggregation || 'sum';
    const layout = widget.networkLayout || 'top-down';
    const nodeRadius = widget.networkNodeRadius ?? 8;

    // ── Build parent→child map from data ──────────────────────────────────
    // sourceField = parent/manager, targetField = child/employee
    const childMap = new Map();    // parentId → Set of childIds
    const nodeInfo = new Map();    // id → { groupVals[], sizeVals[], labelVals[] }

    for (const row of data) {
      const parent = row[widget.sourceField];
      const child = row[widget.targetField];
      if (child == null || String(child) === '') continue;

      const parentStr = parent != null && String(parent) !== '' ? String(parent) : null;
      const childStr = String(child);

      // Ensure both nodes exist
      for (const id of [parentStr, childStr].filter(Boolean)) {
        if (!nodeInfo.has(id)) nodeInfo.set(id, { groupVals: [], sizeVals: [], labelVals: [] });
      }

      // Label
      if (widget.labelField && row[widget.labelField] != null) {
        nodeInfo.get(childStr).labelVals.push(String(row[widget.labelField]));
      }

      // Group
      if (widget.colorField && row[widget.colorField] != null) {
        nodeInfo.get(childStr).groupVals.push(row[widget.colorField]);
      }

      // Size
      if (widget.sizeField) {
        const sv = +row[widget.sizeField];
        if (isFinite(sv)) nodeInfo.get(childStr).sizeVals.push(sv);
      }

      // Parent-child relationship
      if (parentStr) {
        if (!childMap.has(parentStr)) childMap.set(parentStr, new Set());
        childMap.get(parentStr).add(childStr);
      }
    }

    if (nodeInfo.size === 0) return;

    // Find root(s): nodes that are parents but never children
    const allChildren = new Set();
    for (const children of childMap.values()) {
      for (const c of children) allChildren.add(c);
    }
    const roots = [...nodeInfo.keys()].filter(id => !allChildren.has(id));
    // If no clear root, pick the node with the most descendants
    const rootId = roots.length > 0 ? roots[0] : [...nodeInfo.keys()][0];

    // Build hierarchical data structure
    const visited = new Set();
    function buildTree(id) {
      visited.add(id);
      const info = nodeInfo.get(id) || { groupVals: [], sizeVals: [], labelVals: [] };
      const group = info.groupVals.length > 0
        ? d3.mode(info.groupVals.map(String)) ?? String(info.groupVals[0])
        : null;
      const size = info.sizeVals.length > 0 ? aggregate(info.sizeVals, agg) : null;
      const label = info.labelVals.length > 0
        ? d3.mode(info.labelVals) ?? info.labelVals[0]
        : id;

      const node = { id, label, group, size, children: [] };
      const kids = childMap.get(id);
      if (kids) {
        for (const kid of kids) {
          if (!visited.has(kid)) {
            node.children.push(buildTree(kid));
          }
        }
      }
      return node;
    }

    // If multiple roots, create a virtual root
    let treeData;
    if (roots.length > 1) {
      treeData = { id: '__root__', label: '', group: null, size: null, children: roots.map(r => buildTree(r)) };
    } else {
      treeData = buildTree(rootId);
      // Add any remaining unvisited nodes as children of root
      for (const id of nodeInfo.keys()) {
        if (!visited.has(id)) {
          treeData.children.push(buildTree(id));
        }
      }
    }

    const root = d3.hierarchy(treeData);

    // ── Scales ────────────────────────────────────────────────────────────
    const allNodes = root.descendants().filter(d => d.data.id !== '__root__');
    const groups = [...new Set(allNodes.map(d => d.data.group).filter(g => g != null))];
    let nodeGradientScale;
    const useNodeGradient = widget.colorMode === 'gradient';
    if (useNodeGradient) {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const ext = d3.extent(allNodes, d => d.data.size);
      if (ext[0] != null) {
        nodeGradientScale = getSequentialScale(gradKey, ext[0], ext[1] ?? 1, widget.invertGradient, widget.logGradient);
      }
    }
    const colorScale = getColorScaleWithOverrides(
      widget.colorScheme, groups, widget.dimensionColors
    );

    const sizeExtent = d3.extent(allNodes, d => d.data.size);
    const nodeSizeMin = widget.networkNodeSizeMin ?? 6;
    const nodeSizeMax = widget.networkNodeSizeMax ?? 20;
    const sizeScale = sizeExtent[0] != null && sizeExtent[0] !== sizeExtent[1]
      ? d3.scaleSqrt().domain(sizeExtent).range([nodeSizeMin, nodeSizeMax])
      : () => nodeRadius;

    function nodeSize(d) {
      return d.data.size != null ? sizeScale(d.data.size) : nodeRadius;
    }

    function nodeColor(d) {
      if (useNodeGradient && nodeGradientScale && d.data.size != null) return nodeGradientScale(d.data.size);
      return d.data.group != null ? colorScale(d.data.group) : 'var(--accent)';
    }

    // ── Layout ────────────────────────────────────────────────────────────
    const margin = { top: 30, right: 30, bottom: 30, left: 30 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    let getX, getY;

    if (layout === 'radial') {
      const treeLayout = d3.tree()
        .size([2 * Math.PI, Math.min(innerW, innerH) / 2 - 40])
        .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth || 1);
      treeLayout(root);

      getX = d => d.y * Math.cos(d.x - Math.PI / 2);
      getY = d => d.y * Math.sin(d.x - Math.PI / 2);
    } else {
      // top-down, left-right, bottom-up, right-left
      const isHorizontal = layout === 'left-right' || layout === 'right-left';
      const treeW = isHorizontal ? innerH : innerW;
      const treeH = isHorizontal ? innerW : innerH;
      const treeLayout = d3.tree().size([treeW, treeH]);
      treeLayout(root);

      if (layout === 'top-down') {
        getX = d => d.x;
        getY = d => d.y;
      } else if (layout === 'bottom-up') {
        getX = d => d.x;
        getY = d => innerH - d.y;
      } else if (layout === 'left-right') {
        getX = d => d.y;
        getY = d => d.x;
      } else { // right-left
        getX = d => innerW - d.y;
        getY = d => d.x;
      }
    }

    // ── SVG groups ────────────────────────────────────────────────────────
    const g = svg
      .attr('width', w).attr('height', h)
      .append('g')
      .attr('transform', layout === 'radial'
        ? `translate(${w / 2}, ${h / 2})`
        : `translate(${margin.left}, ${margin.top})`);

    // ── Draw links ────────────────────────────────────────────────────────
    const linkColor = widget.networkLinkColor || 'var(--border)';
    const linkWidth = widget.networkLinkWidth ?? 1.5;

    const linkGen = layout === 'radial'
      ? d3.linkRadial().angle(d => d.x).radius(d => d.y)
      : (function() {
          const isHorizontal = layout === 'left-right' || layout === 'right-left';
          return d3.link(isHorizontal ? d3.curveBumpX : d3.curveBumpY)
            .x(d => getX(d))
            .y(d => getY(d));
        })();

    const links = root.links().filter(l => l.source.data.id !== '__root__' && l.target.data.id !== '__root__');
    // For virtual root, connect root's children directly
    const virtualLinks = root.links().filter(l => l.source.data.id === '__root__');
    const allLinks = [...links];
    // Skip virtual root links in drawing

    g.append('g').attr('class', 'network-links')
      .selectAll('path')
      .data(allLinks)
      .join('path')
      .attr('d', linkGen)
      .attr('fill', 'none')
      .attr('stroke', linkColor)
      .attr('stroke-width', linkWidth)
      .attr('stroke-opacity', widget.opacity ?? 0.5)
      .on('mouseover', (ev, d) => showTooltip(ev, <LinkTip d={d} widget={widget} />))
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip);

    // ── Draw nodes ────────────────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'network-nodes');

    const nodeStyle = widget.networkNodeStyle || 'circle';

    const nodeEls = nodeGroup.selectAll('g.node')
      .data(allNodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => layout === 'radial'
        ? `translate(${getX(d)}, ${getY(d)})`
        : `translate(${getX(d)}, ${getY(d)})`
      )
      .attr('cursor', 'pointer')
      .on('mouseover', (ev, d) => showTooltip(ev, <NodeTip d={d} widget={widget} />))
      .on('mousemove', moveTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (ev, d) => {
        if (onCrossFilter && widget.targetField) {
          onCrossFilter({ field: widget.targetField, value: d.data.id });
        }
      });

    if (nodeStyle === 'card') {
      // Card style: rounded rectangle with text inside
      const cardW = widget.networkCardWidth ?? 100;
      const cardH = widget.networkCardHeight ?? 36;

      nodeEls.append('rect')
        .attr('x', -cardW / 2).attr('y', -cardH / 2)
        .attr('width', cardW).attr('height', cardH)
        .attr('rx', 6).attr('ry', 6)
        .attr('fill', d => nodeColor(d))
        .attr('stroke', 'var(--card-bg)')
        .attr('stroke-width', 1.5)
        .attr('opacity', widget.opacity ?? 0.9);

      nodeEls.append('text')
        .text(d => {
          const lbl = d.data.label;
          return lbl.length > 14 ? lbl.slice(0, 13) + '…' : lbl;
        })
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('font-size', 11)
        .attr('fill', 'white')
        .attr('font-family', 'var(--font)')
        .attr('pointer-events', 'none');
    } else {
      // Circle style
      nodeEls.append('circle')
        .attr('r', d => nodeSize(d))
        .attr('fill', d => nodeColor(d))
        .attr('stroke', 'var(--card-bg)')
        .attr('stroke-width', 1.5);

      // Labels
      if (widget.networkShowLabels !== false) {
        const isHorizontal = layout === 'left-right' || layout === 'right-left';
        nodeEls.append('text')
          .text(d => { const l = d.data.label; return l.length > 20 ? l.slice(0, 19) + '…' : l; })
          .attr('font-size', 'var(--chart-label-size)')
          .attr('fill', 'var(--chart-axis-color)')
          .attr('font-family', 'var(--font)')
          .attr('pointer-events', 'none')
          .attr('text-anchor', d => {
            if (isHorizontal) return d.children ? 'end' : 'start';
            return 'middle';
          })
          .attr('dx', d => {
            if (isHorizontal) return d.children ? -(nodeSize(d) + 4) : (nodeSize(d) + 4);
            return 0;
          })
          .attr('dy', d => {
            if (isHorizontal) return '0.35em';
            return -(nodeSize(d) + 4);
          });
      }
    }

    // ── Legend ─────────────────────────────────────────────────────────────
    if (widget.showLegend && groups.length > 0) {
      const legendG = svg.append('g')
        .attr('transform', `translate(${w - 10}, 10)`)
        .attr('text-anchor', 'end');
      groups.forEach((grp, i) => {
        const row = legendG.append('g').attr('transform', `translate(0, ${i * 18})`);
        row.append('circle').attr('r', 5).attr('cx', -8).attr('cy', 0)
          .attr('fill', colorScale(grp));
        row.append('text').text(grp)
          .attr('font-size', 11).attr('fill', 'var(--chart-axis-color)')
          .attr('font-family', 'var(--font)')
          .attr('dy', '0.35em').attr('x', -18);
      });
    }

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  if (!widget.sourceField || !widget.targetField) {
    return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <Placeholder text="Set Parent and Child fields" />
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
