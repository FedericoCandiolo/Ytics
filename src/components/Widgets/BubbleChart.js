import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getColorScaleWithOverrides, getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';

export default function BubbleChart({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    const labelField = widget.xField || widget.labelField;
    const valueField = widget.valueField || widget.sizeField || widget.yField;
    if (!data?.length || !labelField || !valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const hasColor = !!widget.colorField;

    // --- Aggregate data by label (and optionally color group) ---
    const aggType = widget.aggregation || 'sum';
    const aggFn = aggType === 'mean' || aggType === 'avg' ? d3.mean
      : aggType === 'min' ? d3.min
      : aggType === 'max' ? d3.max
      : aggType === 'median' ? d3.median
      : aggType === 'count' ? (arr) => arr.length
      : d3.sum;

    const groupKey = d => {
      const label = String(d[labelField] ?? '');
      const color = hasColor ? String(d[widget.colorField] ?? '') : '';
      return `${label}\0${color}`;
    };

    const groups = d3.group(data, groupKey);
    const nodes = Array.from(groups, ([key, items]) => {
      const [label, color] = key.split('\0');
      const val = aggType === 'count'
        ? aggFn(items)
        : aggFn(items, d => +d[valueField]);
      return { label, color: color || label, value: Math.max(0, val || 0), raw: items[0] };
    }).filter(d => d.value > 0);

    if (!nodes.length) return;

    // --- Color scale ---
    const categories = [...new Set(nodes.map(d => d.color))];
    let colors;
    if (widget.colorMode === 'gradient') {
      const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
      const ext = d3.extent(nodes, d => d.value);
      const seq = getSequentialScale(gradKey, ext[0], ext[1] || 1, widget.invertGradient, widget.logGradient);
      colors = d => seq(nodes.find(n => n.color === d)?.value ?? 0);
      colors._isGradient = true;
      colors._seq = seq;
    } else {
      colors = getColorScaleWithOverrides(widget.colorScheme, categories, widget.dimensionColors);
    }
    const isGradient = !!colors._isGradient;

    // --- Pack layout ---
    const margin = 2;
    const size = Math.min(w, h);

    const root = d3.pack()
      .size([size - margin * 2, size - margin * 2])
      .padding(3)(
      d3.hierarchy({ children: nodes })
        .sum(d => d.value)
    );

    const leaves = root.leaves();

    // --- SVG ---
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h)
      .attr('viewBox', `0 0 ${size} ${size}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g').attr('transform', `translate(${margin},${margin})`);

    const opacity = widget.opacity ?? 0.78;

    // --- Bubbles ---
    const node = g.selectAll('.bubble-node')
      .data(leaves)
      .join('g')
      .attr('class', 'bubble-node')
      .attr('transform', d => `translate(${d.x},${d.y})`);

    const bubbleColor = d => isGradient ? colors._seq(d.data.value) : colors(d.data.color);

    node.append('circle')
      .attr('r', 0)
      .attr('fill', d => bubbleColor(d))
      .attr('fill-opacity', opacity)
      .attr('stroke', d => d3.color(bubbleColor(d))?.darker(0.4)?.toString() || bubbleColor(d))
      .attr('stroke-width', 1)
      .transition().duration(600).delay((_, i) => i * 3).ease(d3.easeCubicOut)
      .attr('r', d => d.r);

    // --- Clip paths for text ---
    const defs = svg.append('defs');
    leaves.forEach((d, i) => {
      defs.append('clipPath')
        .attr('id', `bubble-clip-${i}`)
        .append('circle')
        .attr('r', d.r);
    });

    // --- Labels inside bubbles ---
    const labelGroups = node.append('g')
      .attr('clip-path', (_, i) => `url(#bubble-clip-${i})`)
      .attr('pointer-events', 'none');

    labelGroups.each(function (d, i) {
      const g = d3.select(this);
      const r = d.r;
      if (r < 12) return; // too small for any text

      const label = d.data.label;
      const fontSize = Math.min(12, Math.max(8, r * 0.32));
      const valueFontSize = Math.min(10, Math.max(7, fontSize * 0.85));

      // Split label into lines if it's long
      const maxChars = Math.floor((r * 2) / (fontSize * 0.55));
      let lines = [];
      if (label.length <= maxChars) {
        lines = [label];
      } else {
        // Try to split on spaces/camelCase
        const words = label.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s,_-]+/);
        let current = '';
        for (const word of words) {
          if (current && (current + ' ' + word).length > maxChars) {
            lines.push(current);
            current = word;
          } else {
            current = current ? current + ' ' + word : word;
          }
        }
        if (current) lines.push(current);
        // Truncate if too many lines
        if (lines.length > 3) {
          lines = lines.slice(0, 3);
          lines[2] = lines[2].slice(0, maxChars - 1) + '…';
        }
      }

      // Show value below label if enough room
      const showValue = r >= 20;
      const totalLines = lines.length + (showValue ? 1 : 0);
      const lineHeight = fontSize * 1.2;
      const startY = -(totalLines - 1) * lineHeight / 2;

      const text = g.append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#fff')
        .attr('font-family', 'var(--font)')
        .attr('opacity', 0);

      lines.forEach((line, j) => {
        text.append('tspan')
          .attr('x', 0)
          .attr('y', startY + j * lineHeight)
          .attr('font-size', fontSize)
          .attr('font-weight', 700)
          .text(line.length > maxChars + 2 ? line.slice(0, maxChars) + '…' : line);
      });

      if (showValue) {
        text.append('tspan')
          .attr('x', 0)
          .attr('y', startY + lines.length * lineHeight)
          .attr('font-size', valueFontSize)
          .attr('fill', 'rgba(255,255,255,0.8)')
          .attr('font-weight', 600)
          .text(formatValue(d.data.value, widget.numberFormat));
      }

      text.transition().duration(400).delay(leaves.length * 3 + 150)
        .attr('opacity', 0.95);
    });

    // --- Interactions ---
    node.selectAll('circle')
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget)
          .transition().duration(80)
          .attr('fill-opacity', 1)
          .attr('stroke-width', 2);
        showTooltip(ev, <BubbleTip d={d.data} widget={widget} valueField={valueField} color={bubbleColor(d)} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev, d) => {
        d3.select(ev.currentTarget)
          .transition().duration(120)
          .attr('fill-opacity', opacity)
          .attr('stroke-width', 1);
        hideTooltip();
      })
      .on('click', onCrossFilter ? (ev, d) => {
        ev.stopPropagation();
        onCrossFilter({
          field: widget.colorField || labelField,
          value: d.data.raw[widget.colorField || labelField],
        });
      } : null)
      .style('cursor', onCrossFilter ? 'pointer' : null);

  }, [data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  const labelField = widget.xField || widget.labelField;
  const valueField = widget.valueField || widget.sizeField || widget.yField;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ display: 'block', margin: '0 auto' }} />
      {tooltipEl}
      {(!labelField || !valueField) && <Placeholder text="Select Dimension and Measure fields" />}
    </div>
  );
}

function BubbleTip({ d, widget, valueField, color }) {
  return (
    <>
      <div className="chart-tooltip-title">
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6, verticalAlign: 'middle' }} />
        {d.label}
      </div>
      <div className="chart-tooltip-row">
        <span className="tt-label">{valueField}</span>
        <span className="tt-value">{formatValue(d.value, widget.numberFormat)}</span>
      </div>
      {widget.colorField && d.color !== d.label && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{widget.colorField}</span>
          <span className="tt-value">{d.color}</span>
        </div>
      )}
    </>
  );
}
