import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { formatValue } from '../../utils/dataUtils';
import { getSequentialScale, resolveGradient } from '../../utils/colorUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, styledAxis, Placeholder } from './chartHelpers';

// Inverse distance weighting interpolation onto a regular grid
function rasterize(pts, gridW, gridH, xDomain, yDomain) {
  const grid = new Float64Array(gridW * gridH);
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const xRange = x1 - x0 || 1;
  const yRange = y1 - y0 || 1;
  const power = 2;

  for (let r = 0; r < gridH; r++) {
    for (let c = 0; c < gridW; c++) {
      const gx = x0 + (c / (gridW - 1)) * xRange;
      const gy = y0 + (r / (gridH - 1)) * yRange;
      let weightSum = 0, valueSum = 0;
      let exactMatch = false;
      for (const pt of pts) {
        const dx = pt.x - gx, dy = pt.y - gy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 1e-20) { grid[r * gridW + c] = pt.z; exactMatch = true; break; }
        const w = 1 / Math.pow(dist2, power / 2);
        weightSum += w;
        valueSum += w * pt.z;
      }
      if (!exactMatch) grid[r * gridW + c] = weightSum > 0 ? valueSum / weightSum : 0;
    }
  }
  return grid;
}

export default function TopoMap({ widget, data }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, hideTooltip } = useTooltip();

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!data?.length || !widget.xField || !widget.yField || !widget.zField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const is3D = widget.topoView === '3d';

    // Parse data points
    const pts = data.map(d => ({ x: +d[widget.xField], y: +d[widget.yField], z: +d[widget.zField] }))
      .filter(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z));
    if (pts.length < 3) return;

    const xExt = d3.extent(pts, p => p.x);
    const yExt = d3.extent(pts, p => p.y);
    const zExt = d3.extent(pts, p => p.z);

    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);

    // SVG
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    if (is3D) {
      // ── 3D surface mesh (isometric projection, R²→R) ──────────────────────
      const m3d = { top: 20, right: 55, bottom: 24, left: 20 };
      const W3d = w - m3d.left - m3d.right;
      const H3d = h - m3d.top - m3d.bottom;
      if (W3d <= 0 || H3d <= 0) return;

      const gridW3d = Math.min(35, Math.max(8, Math.round(W3d / 6)));
      const gridH3d = Math.min(28, Math.max(6, Math.round(H3d / 6)));
      const grid3d = rasterize(pts, gridW3d, gridH3d, xExt, yExt);
      const zMin3d = d3.min(grid3d), zMax3d = d3.max(grid3d);
      const zRange3d = Math.max(zMax3d - zMin3d, 1);
      const colorScale3d = getSequentialScale(gradKey, zMin3d, zMax3d, widget.invertGradient);

      // Isometric projection: az=-135°, el=-20°  →  X right, Y left, Z up
      const az3d = -135 * Math.PI / 180;
      const el3d = -20 * Math.PI / 180;
      const sinAz = Math.sin(az3d), cosAz = Math.cos(az3d);
      const sinEl = Math.sin(el3d), cosEl = Math.cos(el3d);
      const proj3d = (nx, ny, nz) => ({
        sx: -sinAz * nx + cosAz * ny,
        sy: cosAz * sinEl * nx + sinAz * sinEl * ny - cosEl * nz,
      });

      // Auto-scale to fill chart area
      const cube = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
      const pc = cube.map(([nx,ny,nz]) => proj3d(nx, ny, nz));
      const sxMin = Math.min(...pc.map(p => p.sx)), sxMax = Math.max(...pc.map(p => p.sx));
      const syMin = Math.min(...pc.map(p => p.sy)), syMax = Math.max(...pc.map(p => p.sy));
      const scaleS = Math.min(W3d / (sxMax - sxMin), H3d / (syMax - syMin)) * 0.86;
      const offX = m3d.left + W3d / 2 - ((sxMin + sxMax) / 2) * scaleS;
      const offY = m3d.top  + H3d / 2 - ((syMin + syMax) / 2) * scaleS;
      const toScr = ({ sx, sy }) => ({ x: offX + sx * scaleS, y: offY + sy * scaleS });

      const g3d = svg.append('g');

      // Build quad faces
      const quads = [];
      for (let r = 0; r < gridH3d - 1; r++) {
        for (let c = 0; c < gridW3d - 1; c++) {
          const z00 = grid3d[r * gridW3d + c];
          const z10 = grid3d[r * gridW3d + c + 1];
          const z01 = grid3d[(r + 1) * gridW3d + c];
          const z11 = grid3d[(r + 1) * gridW3d + c + 1];
          const avgZ = (z00 + z10 + z01 + z11) / 4;
          const nx0 = c / (gridW3d - 1), nx1 = (c + 1) / (gridW3d - 1);
          const ny0 = r / (gridH3d - 1), ny1 = (r + 1) / (gridH3d - 1);
          const p00 = toScr(proj3d(nx0, ny0, (z00 - zMin3d) / zRange3d));
          const p10 = toScr(proj3d(nx1, ny0, (z10 - zMin3d) / zRange3d));
          const p11 = toScr(proj3d(nx1, ny1, (z11 - zMin3d) / zRange3d));
          const p01 = toScr(proj3d(nx0, ny1, (z01 - zMin3d) / zRange3d));
          const depth = p00.y + p10.y + p11.y + p01.y;
          quads.push({ p00, p10, p11, p01, avgZ, depth });
        }
      }
      quads.sort((a, b) => a.depth - b.depth);  // painter's algorithm: back first

      for (const { p00, p10, p11, p01, avgZ } of quads) {
        g3d.append('path')
          .attr('d', `M${p00.x},${p00.y}L${p10.x},${p10.y}L${p11.x},${p11.y}L${p01.x},${p01.y}Z`)
          .attr('fill', colorScale3d(avgZ))
          .attr('stroke', 'var(--bg)')
          .attr('stroke-width', 0.4);
      }

      // Axes (slightly extended beyond [0,1] for arrow clearance)
      const origin3d = toScr(proj3d(0, 0, 0));
      const endX = toScr(proj3d(1.08, 0, 0));
      const endY = toScr(proj3d(0, 1.08, 0));
      const endZ = toScr(proj3d(0, 0, 1.08));

      const defs3d = svg.append('defs');
      const arrId = `topo3d-arr-${Math.random().toString(36).slice(2, 6)}`;
      defs3d.append('marker')
        .attr('id', arrId).attr('markerWidth', 5).attr('markerHeight', 5)
        .attr('refX', 4).attr('refY', 2.5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,0 L0,5 L5,2.5 Z')
        .attr('fill', 'var(--chart-axis-color)');

      const drawAx = (a, b) => g3d.append('line')
        .attr('x1', a.x).attr('y1', a.y).attr('x2', b.x).attr('y2', b.y)
        .attr('stroke', 'var(--chart-axis-color)').attr('stroke-width', 1.5)
        .attr('marker-end', `url(#${arrId})`);
      drawAx(origin3d, endX);
      drawAx(origin3d, endY);
      drawAx(origin3d, endZ);

      // Tick marks + value labels (3 ticks per axis)
      const fmtAx = v => Math.abs(v) >= 1e4 ? d3.format('.2s')(v) : d3.format('.3~g')(v);
      const nTk = 3;
      for (let i = 1; i <= nTk; i++) {
        const t = i / nTk;
        const tkX = toScr(proj3d(t, 0, 0));
        g3d.append('circle').attr('cx', tkX.x).attr('cy', tkX.y).attr('r', 2).attr('fill', 'var(--chart-axis-color)');
        g3d.append('text').attr('x', tkX.x + 3).attr('y', tkX.y + 12)
          .attr('font-size', 9).attr('fill', 'var(--chart-axis-color)').attr('font-family', 'var(--font)')
          .attr('text-anchor', 'middle').text(fmtAx(xExt[0] + t * (xExt[1] - xExt[0])));

        const tkY = toScr(proj3d(0, t, 0));
        g3d.append('circle').attr('cx', tkY.x).attr('cy', tkY.y).attr('r', 2).attr('fill', 'var(--chart-axis-color)');
        g3d.append('text').attr('x', tkY.x - 4).attr('y', tkY.y + 12)
          .attr('font-size', 9).attr('fill', 'var(--chart-axis-color)').attr('font-family', 'var(--font)')
          .attr('text-anchor', 'middle').text(fmtAx(yExt[0] + t * (yExt[1] - yExt[0])));

        const tkZ = toScr(proj3d(0, 0, t));
        g3d.append('circle').attr('cx', tkZ.x).attr('cy', tkZ.y).attr('r', 2).attr('fill', 'var(--chart-axis-color)');
        g3d.append('text').attr('x', tkZ.x - 6).attr('y', tkZ.y + 4)
          .attr('font-size', 9).attr('fill', 'var(--chart-axis-color)').attr('font-family', 'var(--font)')
          .attr('text-anchor', 'end').text(fmtAx(zMin3d + t * zRange3d));
      }

      // Field name labels at axis ends
      g3d.append('text').attr('x', endX.x + 4).attr('y', endX.y + 4)
        .attr('font-size', 10).attr('font-weight', 600)
        .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)').text(widget.xField);
      g3d.append('text').attr('x', endY.x - 4).attr('y', endY.y + 4)
        .attr('font-size', 10).attr('font-weight', 600)
        .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)').attr('text-anchor', 'end').text(widget.yField);
      g3d.append('text').attr('x', endZ.x - 6).attr('y', endZ.y)
        .attr('font-size', 10).attr('font-weight', 600)
        .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)').attr('text-anchor', 'end').text(widget.zField);

      // Gradient legend on right
      const legH3d = Math.min(120, H3d * 0.55);
      const legX3d = w - 44;
      const legY3d = (h - legH3d) / 2;
      const gradId3d = `topo-grad3d-${Math.random().toString(36).slice(2, 8)}`;
      const grad3d = defs3d.append('linearGradient').attr('id', gradId3d).attr('x1', 0).attr('x2', 0).attr('y1', 1).attr('y2', 0);
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        grad3d.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale3d(zMin3d + t * zRange3d));
      }
      g3d.append('rect').attr('x', legX3d).attr('y', legY3d).attr('width', 10).attr('height', legH3d)
        .attr('fill', `url(#${gradId3d})`).attr('rx', 2);
      g3d.append('text').attr('x', legX3d + 13).attr('y', legY3d + 8)
        .attr('font-size', 9).attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
        .text(formatValue(zMax3d, widget.numberFormat));
      g3d.append('text').attr('x', legX3d + 13).attr('y', legY3d + legH3d)
        .attr('font-size', 9).attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
        .text(formatValue(zMin3d, widget.numberFormat));

      return;
    }

    // ── 2D contour view (original) ──────────────────────────────────────────
    const m = { top: 16, right: 24, bottom: 52, left: 60 };
    const W = w - m.left - m.right;
    const H = h - m.top - m.bottom;
    if (W <= 0 || H <= 0) return;

    // Raster grid size (scales with chart area, capped for perf)
    const gridW = Math.min(120, Math.round(W / 4));
    const gridH = Math.min(100, Math.round(H / 4));
    const grid = rasterize(pts, gridW, gridH, xExt, yExt);

    // Contours
    const thresholds = widget.topoThresholds || 10;
    const zMin = d3.min(grid), zMax = d3.max(grid);
    const contourFn = d3.contours()
      .size([gridW, gridH])
      .smooth(widget.topoSmooth !== false)
      .thresholds(d3.range(zMin, zMax, (zMax - zMin) / thresholds));
    const contourData = contourFn(grid);

    // Color scale
    const colorScale = getSequentialScale(gradKey, zMin, zMax, widget.invertGradient);

    // Pixel scales for axes (data space → screen)
    const xScale = d3.scaleLinear().domain(xExt).range([0, W]).nice();
    const yScale = d3.scaleLinear().domain(yExt).range([H, 0]).nice();

    // Transform from grid coordinates [0..gridW-1, 0..gridH-1] → pixel space
    const gridToPixel = d3.geoTransform({
      point(gx, gy) {
        const dataX = xExt[0] + (gx / (gridW - 1)) * (xExt[1] - xExt[0]);
        const dataY = yExt[0] + (gy / (gridH - 1)) * (yExt[1] - yExt[0]);
        this.stream.point(xScale(dataX), yScale(dataY));
      },
    });
    const pathGen = d3.geoPath(gridToPixel);

    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Clip chart area
    const clipId = `topo-clip-${Math.random().toString(36).slice(2, 8)}`;
    svg.append('defs').append('clipPath').attr('id', clipId)
      .append('rect').attr('width', W).attr('height', H);

    // Draw filled contour bands
    const contourG = g.append('g').attr('clip-path', `url(#${clipId})`);
    contourData.forEach(contour => {
      contourG.append('path')
        .datum(contour)
        .attr('d', pathGen)
        .attr('fill', colorScale(contour.value))
        .attr('opacity', 0.82)
        .attr('stroke', 'var(--bg)')
        .attr('stroke-width', widget.topoShowLines !== false ? 0.5 : 0);
    });

    // Contour level labels (every other level to avoid clutter)
    if (widget.topoShowLabels) {
      contourData.filter((_, i) => i % 2 === 0).forEach(contour => {
        const labelVal = contour.value.toFixed(zExt[1] > 100 ? 0 : 1);
        if (!contour.coordinates?.[0]?.[0]?.length) return;
        const ring = contour.coordinates[0][0];
        const centroid = d3.polygonCentroid(ring);
        if (!centroid || !isFinite(centroid[0]) || !isFinite(centroid[1])) return;
        const pt = { x: centroid[0], y: centroid[1] };
        const dataX = xExt[0] + (pt.x / (gridW - 1)) * (xExt[1] - xExt[0]);
        const dataY = yExt[0] + (pt.y / (gridH - 1)) * (yExt[1] - yExt[0]);
        const px = xScale(dataX), py = yScale(dataY);
        if (px < 0 || px > W || py < 0 || py > H) return;
        g.append('text').attr('x', px).attr('y', py)
          .attr('font-size', 9).attr('font-family', 'var(--font)')
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .attr('fill', 'rgba(0,0,0,0.7)').attr('stroke', 'white').attr('stroke-width', 2).attr('paint-order', 'stroke')
          .text(labelVal);
      });
    }

    // Data points overlay
    if (widget.topoShowPoints) {
      g.append('g').attr('clip-path', `url(#${clipId})`)
        .selectAll('circle').data(pts).join('circle')
        .attr('cx', d => xScale(d.x)).attr('cy', d => yScale(d.y)).attr('r', 3)
        .attr('fill', 'var(--text)')
        .attr('opacity', 0.5)
        .attr('stroke', 'var(--bg)').attr('stroke-width', 1)
        .on('mouseover', (ev, d) => {
          showTooltip(ev, (
            <>
              <div className="chart-tooltip-row"><span className="tt-label">{widget.xField}</span><span className="tt-value">{formatValue(d.x, widget.numberFormat)}</span></div>
              <div className="chart-tooltip-row"><span className="tt-label">{widget.yField}</span><span className="tt-value">{formatValue(d.y, widget.numberFormat)}</span></div>
              <div className="chart-tooltip-row"><span className="tt-label">{widget.zField}</span><span className="tt-value">{formatValue(d.z, widget.numberFormat)}</span></div>
            </>
          ));
        })
        .on('mouseleave', hideTooltip);
    }

    // Axes
    g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(xScale).ticks(5)).call(styledAxis);
    g.append('g').call(d3.axisLeft(yScale).ticks(5)).call(styledAxis);

    // Axis labels
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('x', W / 2).attr('y', H + 42).text(widget.xField);
    g.append('text').attr('fill', 'var(--chart-axis-color)').attr('font-size', 11)
      .attr('text-anchor', 'middle').attr('transform', `translate(-44,${H / 2}) rotate(-90)`).text(widget.yField);

    // Gradient legend (right side)
    const legH = Math.min(140, H * 0.7);
    const legY = (H - legH) / 2;
    const legX = W + 8;
    const legW = 10;
    const gradId = `topo-grad-${Math.random().toString(36).slice(2, 8)}`;
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', 0).attr('x2', 0).attr('y1', 1).attr('y2', 0);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale(zMin + t * (zMax - zMin)));
    }
    g.append('rect').attr('x', legX).attr('y', legY).attr('width', legW).attr('height', legH)
      .attr('fill', `url(#${gradId})`).attr('rx', 2);
    g.append('text').attr('x', legX + legW + 3).attr('y', legY + 8).attr('font-size', 9)
      .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
      .text(formatValue(zMax, widget.numberFormat));
    g.append('text').attr('x', legX + legW + 3).attr('y', legY + legH).attr('font-size', 9)
      .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
      .text(formatValue(zMin, widget.numberFormat));
    g.append('text').attr('x', legX + legW / 2).attr('y', legY - 4).attr('font-size', 9)
      .attr('fill', 'var(--text-muted)').attr('font-family', 'var(--font)')
      .attr('text-anchor', 'middle').text(widget.zField);
  }, [data, widget, dims, showTooltip, hideTooltip]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
      {tooltipEl}
      {(!widget.xField || !widget.yField || !widget.zField) && (
        <Placeholder text="Select X, Y coordinate fields and a Z (height) field" />
      )}
    </div>
  );
}
