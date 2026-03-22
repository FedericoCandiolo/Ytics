import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';
import { resolveGradient, getColorArray, getSequentialScale } from '../../utils/colorUtils';

const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const PROJECTIONS = {
  naturalEarth: d3.geoNaturalEarth1,
  mercator: d3.geoMercator,
  equalEarth: d3.geoEqualEarth,
  orthographic: d3.geoOrthographic,
};

const ALIASES = {
  'usa': 'United States of America', 'us': 'United States of America', 'united states': 'United States of America',
  'uk': 'United Kingdom', 'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'russia': 'Russia', 'russian federation': 'Russia',
  'south korea': 'South Korea', 'korea': 'South Korea',
  'china': 'China', "people's republic of china": 'China',
  'uae': 'United Arab Emirates',
};

const SCOPE_BOUNDS = {
  'north-america': [[-170, 7], [170, 84]],
  'south-america': [[-82, -56], [-34, 13]],
  'europe': [[-25, 34], [50, 72]],
  'africa': [[-18, -35], [52, 37]],
  'asia': [[25, -12], [180, 75]],
  'oceania': [[110, -50], [180, 5]],
};

function parseScopeType(scope) {
  if (!scope || scope === 'world') return { type: 'world' };
  const lower = scope.toLowerCase();
  if (SCOPE_BOUNDS[lower]) return { type: 'continent', key: lower };
  return { type: 'country', name: scope };
}

function filterFeaturesByBounds(features, bounds) {
  const [[west, south], [east, north]] = bounds;
  return features.filter(f => {
    const centroid = d3.geoCentroid(f);
    if (!centroid || isNaN(centroid[0])) return false;
    const [lon, lat] = centroid;
    return lon >= west && lon <= east && lat >= south && lat <= north;
  });
}

function findCountryFeature(features, name) {
  const lower = name.toLowerCase();
  let found = features.find(f => (f.properties.name || '').toLowerCase() === lower);
  if (found) return found;
  const aliased = ALIASES[lower];
  if (aliased) found = features.find(f => (f.properties.name || '').toLowerCase() === aliased.toLowerCase());
  if (found) return found;
  return features.find(f => {
    const fn = (f.properties.name || '').toLowerCase();
    return fn.includes(lower) || lower.includes(fn);
  });
}

// ── Mini-chart drawing ─────────────────────────────────────────────────

function drawMiniPie(g, cx, cy, radius, slices, colors) {
  if (!slices.length) return;
  const total = slices.reduce((s, sl) => s + Math.abs(sl.value), 0);
  if (total === 0) return;
  const pie = d3.pie().value(d => Math.abs(d.value)).sort(null);
  const arc = d3.arc().innerRadius(0).outerRadius(radius);
  g.append('g')
    .attr('transform', `translate(${cx},${cy})`)
    .selectAll('path')
    .data(pie(slices))
    .join('path')
    .attr('d', arc)
    .attr('fill', (d, i) => colors[i % colors.length])
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.5)
    .attr('opacity', 0.9);
}

function drawMiniBar(g, cx, cy, radius, slices, colors, vertical) {
  if (!slices.length) return;
  const total = slices.reduce((s, sl) => s + Math.abs(sl.value), 0);
  if (total === 0) return;

  const barW = radius * 1.6;
  const barH = radius * 1.6;

  if (vertical) {
    // Stacked vertical bar
    const maxVal = Math.max(...slices.map(s => Math.abs(s.value)));
    const scale = barH / (maxVal || 1);
    const segW = barW / slices.length;
    const startX = cx - barW / 2;
    const baseY = cy + barH / 2;

    slices.forEach((sl, i) => {
      const h = Math.abs(sl.value) * scale;
      g.append('rect')
        .attr('x', startX + i * segW)
        .attr('y', baseY - h)
        .attr('width', Math.max(1, segW - 1))
        .attr('height', h)
        .attr('fill', colors[i % colors.length])
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.3)
        .attr('opacity', 0.9);
    });
  } else {
    // Stacked horizontal segments
    let startX = cx - barW / 2;
    const startY = cy - barH / 4;
    const segH = barH / 2;

    slices.forEach((sl, i) => {
      const w = (Math.abs(sl.value) / total) * barW;
      g.append('rect')
        .attr('x', startX)
        .attr('y', startY)
        .attr('width', Math.max(1, w))
        .attr('height', segH)
        .attr('fill', colors[i % colors.length])
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.3)
        .attr('opacity', 0.9)
        .attr('rx', i === 0 ? 2 : 0);
      startX += w;
    });
  }
}

// ── Component ────────────────────────────────────────────────────────

export default function GeoMap({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();

  const [worldData, setWorldData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(WORLD_TOPO_URL)
      .then(r => r.json())
      .then(topo => { if (!cancelled) setWorldData(topo); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  const render = useCallback(() => {
    const { w, h } = dims;
    if (!worldData || !data?.length || !widget.geoField || !widget.valueField || w < 20 || h < 20) {
      d3.select(svgRef.current).selectAll('*').remove();
      return;
    }

    const allCountries = topojson.feature(worldData, worldData.objects.countries);
    const opacity = widget.opacity ?? 1;
    const scope = parseScopeType(widget.mapScope);
    const schemeKey = widget.colorScheme || 'vivid';
    const paletteColors = getColorArray(schemeKey);

    // ── Determine display features ──
    let displayFeatures = allCountries.features;
    let fitTarget = allCountries;

    if (scope.type === 'continent') {
      const filtered = filterFeaturesByBounds(allCountries.features, SCOPE_BOUNDS[scope.key]);
      if (filtered.length > 0) {
        displayFeatures = filtered;
        fitTarget = { type: 'FeatureCollection', features: filtered };
      }
    } else if (scope.type === 'country') {
      const cf = findCountryFeature(allCountries.features, scope.name);
      if (cf) {
        const centroid = d3.geoCentroid(cf);
        const nearby = allCountries.features.filter(f => {
          const c = d3.geoCentroid(f);
          if (!c || isNaN(c[0])) return false;
          return Math.sqrt((c[0] - centroid[0]) ** 2 + (c[1] - centroid[1]) ** 2) < 25;
        });
        displayFeatures = nearby.length > 1 ? nearby : allCountries.features;
        fitTarget = cf;
      }
    }

    // ── Aggregate data for choropleth ──
    const valueMap = new Map();
    for (const row of data) {
      const key = String(row[widget.geoField] ?? '').trim();
      if (!key) continue;
      if (!valueMap.has(key)) valueMap.set(key, []);
      valueMap.get(key).push(+row[widget.valueField] || 0);
    }
    const aggMap = new Map();
    for (const [key, vals] of valueMap) {
      aggMap.set(key.toLowerCase(), { name: key, value: aggregate(vals, widget.aggregation || 'sum') });
    }

    const matchRegion = (name) => {
      const lower = (name || '').toLowerCase();
      if (aggMap.has(lower)) return aggMap.get(lower);
      if (ALIASES[lower] && aggMap.has(ALIASES[lower].toLowerCase())) return aggMap.get(ALIASES[lower].toLowerCase());
      for (const [key, entry] of aggMap) {
        if (lower.includes(key) || key.includes(lower)) return entry;
      }
      return null;
    };

    const values = [...aggMap.values()].map(v => v.value);
    const [minVal, maxVal] = [d3.min(values) || 0, d3.max(values) || 1];

    // ── Color scale for choropleth ──
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const colorScale = getSequentialScale(gradKey, minVal, maxVal, widget.invertGradient);

    // ── Projection ──
    const ProjFn = PROJECTIONS[widget.mapProjection] || PROJECTIONS.naturalEarth;
    const projection = ProjFn().fitSize([w - 20, h - 50], fitTarget);
    const pathGen = d3.geoPath(projection);

    // ── SVG ──
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'geo-clip')
      .append('rect').attr('width', w).attr('height', h);

    const zoomGroup = svg.append('g').attr('clip-path', 'url(#geo-clip)');
    const mapGroup = zoomGroup.append('g').attr('transform', 'translate(10, 10)');

    // ── Choropleth ──
    mapGroup.selectAll('path.geo-region')
      .data(displayFeatures)
      .join('path')
      .attr('class', 'geo-region')
      .attr('d', pathGen)
      .attr('fill', d => {
        const match = matchRegion(d.properties.name);
        return match ? colorScale(match.value) : '#e5e7eb';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .attr('opacity', opacity)
      .style('cursor', onCrossFilter ? 'pointer' : 'default')
      .on('click', (ev, d) => {
        if (onCrossFilter) onCrossFilter({ field: widget.geoField, value: d.properties.name });
      })
      .on('mouseover', (ev, d) => {
        d3.select(ev.currentTarget).attr('stroke', '#333').attr('stroke-width', 1.5);
        const match = matchRegion(d.properties.name);
        showTooltip(ev, <GeoTip name={d.properties.name} match={match} widget={widget} />);
      })
      .on('mousemove', moveTooltip)
      .on('mouseleave', (ev) => {
        d3.select(ev.currentTarget).attr('stroke', '#fff').attr('stroke-width', 0.5);
        hideTooltip();
      });

    // ── Country overlay: mini pie / mini bar ──
    const overlayType = widget.overlayType; // 'pie' | 'bar' | null
    const overlayFields = widget.overlayFields || [];
    const overlaySizeField = widget.overlaySizeField || widget.valueField;
    const overlaySource = widget.overlaySource || 'fields';
    const overlayBreakdownField = widget.overlayBreakdownField;

    const hasOverlay = overlayType && (
      (overlaySource === 'fields' && overlayFields.length > 0) ||
      (overlaySource === 'dimension' && overlayBreakdownField)
    );

    if (hasOverlay) {
      // Build overlayAgg: Map<regionLower, { name, slices: [{label, value}], size }>
      const overlayAgg = new Map();
      let sliceLegendLabels = [];

      if (overlaySource === 'dimension') {
        // Breakdown mode: slices = distinct values of breakdownField within each region
        const regionMap = new Map(); // lower -> { name, breakdown: Map<dimVal, [nums]>, sizeVals: [] }
        for (const row of data) {
          const key = String(row[widget.geoField] ?? '').trim();
          if (!key) continue;
          const lower = key.toLowerCase();
          if (!regionMap.has(lower)) regionMap.set(lower, { name: key, breakdown: new Map(), sizeVals: [] });
          const entry = regionMap.get(lower);
          const dimVal = String(row[overlayBreakdownField] ?? '').trim();
          if (!dimVal) continue;
          if (!entry.breakdown.has(dimVal)) entry.breakdown.set(dimVal, []);
          entry.breakdown.get(dimVal).push(+row[widget.valueField] || 0);
          entry.sizeVals.push(+row[overlaySizeField] || 0);
        }
        // Collect all dimension values for consistent ordering/coloring
        const allDimVals = new Set();
        for (const [, entry] of regionMap) {
          for (const k of entry.breakdown.keys()) allDimVals.add(k);
        }
        sliceLegendLabels = [...allDimVals];

        for (const [lower, entry] of regionMap) {
          const slices = sliceLegendLabels.map(dv => ({
            label: dv,
            value: aggregate(entry.breakdown.get(dv) || [], widget.aggregation || 'sum'),
          }));
          const size = aggregate(entry.sizeVals, widget.aggregation || 'sum');
          overlayAgg.set(lower, { name: entry.name, slices, size });
        }
      } else {
        // Fields mode: slices = one per numeric field
        sliceLegendLabels = overlayFields;
        const regionOverlayData = new Map();
        for (const row of data) {
          const key = String(row[widget.geoField] ?? '').trim();
          if (!key) continue;
          const lower = key.toLowerCase();
          if (!regionOverlayData.has(lower)) regionOverlayData.set(lower, { name: key, fields: {}, sizeVals: [] });
          const entry = regionOverlayData.get(lower);
          for (const field of overlayFields) {
            if (!entry.fields[field]) entry.fields[field] = [];
            entry.fields[field].push(+row[field] || 0);
          }
          entry.sizeVals.push(+row[overlaySizeField] || 0);
        }
        for (const [lower, entry] of regionOverlayData) {
          const slices = overlayFields.map(f => ({
            label: f,
            value: aggregate(entry.fields[f] || [], widget.aggregation || 'sum'),
          }));
          const size = aggregate(entry.sizeVals, widget.aggregation || 'sum');
          overlayAgg.set(lower, { name: entry.name, slices, size });
        }
      }

      let maxSize = 0;
      for (const [, entry] of overlayAgg) maxSize = Math.max(maxSize, Math.abs(entry.size));

      const minR = 6, maxR = Math.min(30, Math.max(12, w / 30));
      const sizeScale = maxSize > 0
        ? d3.scaleSqrt().domain([0, maxSize]).range([minR, maxR])
        : () => minR;

      const overlayGroup = mapGroup.append('g').attr('class', 'overlay-charts');

      const matchOverlay = (name) => {
        const lower = (name || '').toLowerCase();
        let entry = overlayAgg.get(lower);
        if (!entry && ALIASES[lower]) entry = overlayAgg.get(ALIASES[lower].toLowerCase());
        if (!entry) {
          for (const [k, v] of overlayAgg) {
            if (lower.includes(k) || k.includes(lower)) { entry = v; break; }
          }
        }
        return entry;
      };

      for (const feature of displayFeatures) {
        const entry = matchOverlay(feature.properties.name);
        if (!entry) continue;

        const centroid = pathGen.centroid(feature);
        if (!centroid || isNaN(centroid[0])) continue;

        const r = sizeScale(Math.abs(entry.size));

        if (overlayType === 'pie') {
          drawMiniPie(overlayGroup, centroid[0], centroid[1], r, entry.slices, paletteColors);
        } else {
          drawMiniBar(overlayGroup, centroid[0], centroid[1], r, entry.slices, paletteColors, true);
        }

        // Hit area for tooltip
        overlayGroup.append('circle')
          .attr('cx', centroid[0]).attr('cy', centroid[1])
          .attr('r', r + 2).attr('fill', 'transparent')
          .style('cursor', 'pointer')
          .on('mouseover', (ev) => {
            showTooltip(ev, <OverlayTip name={entry.name} slices={entry.slices} size={entry.size} sizeField={overlaySizeField} widget={widget} />);
          })
          .on('mousemove', moveTooltip)
          .on('mouseleave', hideTooltip)
          .on('click', () => {
            if (onCrossFilter) onCrossFilter({ field: widget.geoField, value: entry.name });
          });
      }

      // Slice legend
      if (sliceLegendLabels.length > 1) {
        const lg = svg.append('g').attr('class', 'overlay-legend')
          .attr('transform', `translate(10, ${h - 14 * Math.min(sliceLegendLabels.length, 12) - 10})`);
        sliceLegendLabels.slice(0, 12).forEach((f, i) => {
          lg.append('rect').attr('x', 0).attr('y', i * 14).attr('width', 10).attr('height', 10)
            .attr('fill', paletteColors[i % paletteColors.length]).attr('rx', 2);
          lg.append('text').attr('x', 14).attr('y', i * 14 + 9).attr('font-size', 9).attr('fill', 'var(--text-muted)')
            .text(f.length > 20 ? f.slice(0, 20) + '…' : f);
        });
      }
    }

    // ── Point layer ──
    if (widget.pointLayerEnabled && widget.pointLatField && widget.pointLngField) {
      const pointType = widget.pointType || 'circle'; // 'circle' | 'pie' | 'bar'
      const pointColorField = widget.pointColorField;
      const pointSizeField = widget.pointSizeField;
      const pointLabelField = widget.pointLabelField;
      const pointFields = widget.pointOverlayFields || [];

      // Gather points
      const points = [];
      for (const row of data) {
        const lat = +row[widget.pointLatField];
        const lng = +row[widget.pointLngField];
        if (isNaN(lat) || isNaN(lng)) continue;
        points.push({ row, lat, lng });
      }

      // Group by lat/lng (to allow aggregation at same location)
      const pointGroups = new Map();
      for (const pt of points) {
        const key = `${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`;
        if (!pointGroups.has(key)) pointGroups.set(key, { lat: pt.lat, lng: pt.lng, rows: [] });
        pointGroups.get(key).rows.push(pt.row);
      }

      const pointLayer = mapGroup.append('g').attr('class', 'point-layer');

      if (pointType === 'circle') {
        // Size & color mapping
        let sizeValues = [];
        for (const [, grp] of pointGroups) {
          if (pointSizeField) {
            const vals = grp.rows.map(r => +r[pointSizeField] || 0);
            grp.size = aggregate(vals, widget.aggregation || 'sum');
            sizeValues.push(grp.size);
          }
        }

        const maxPtSize = d3.max(sizeValues) || 1;
        const ptMinR = 3, ptMaxR = Math.min(20, Math.max(8, w / 50));
        const ptSizeScale = pointSizeField
          ? d3.scaleSqrt().domain([0, maxPtSize]).range([ptMinR, ptMaxR])
          : () => 5;

        // Color: use categorical if colorField, or a single color
        const colorDomain = pointColorField
          ? [...new Set(points.map(p => String(p.row[pointColorField] ?? '')))]
          : [];
        const ptColorScale = pointColorField
          ? d3.scaleOrdinal(paletteColors).domain(colorDomain)
          : () => (widget.pointColor || paletteColors[0]);

        for (const [, grp] of pointGroups) {
          const [px, py] = projection([grp.lng, grp.lat]);
          if (isNaN(px) || isNaN(py)) continue;

          const r = ptSizeScale(grp.size ?? 1);
          const color = pointColorField
            ? ptColorScale(String(grp.rows[0][pointColorField] ?? ''))
            : ptColorScale();
          const label = pointLabelField ? String(grp.rows[0][pointLabelField] ?? '') : '';

          pointLayer.append('circle')
            .attr('cx', px).attr('cy', py)
            .attr('r', r)
            .attr('fill', color)
            .attr('fill-opacity', 0.75)
            .attr('stroke', '#fff')
            .attr('stroke-width', 0.7)
            .style('cursor', 'pointer')
            .on('mouseover', (ev) => {
              showTooltip(ev, <PointTip label={label} grp={grp} widget={widget} pointSizeField={pointSizeField} pointColorField={pointColorField} />);
            })
            .on('mousemove', moveTooltip)
            .on('mouseleave', hideTooltip);
        }
      } else if (pointType === 'pie' || pointType === 'bar') {
        if (pointFields.length === 0) return;

        // Aggregate each field per location
        let maxPtSize = 0;
        for (const [, grp] of pointGroups) {
          grp.slices = pointFields.map(f => ({
            label: f,
            value: aggregate(grp.rows.map(r => +r[f] || 0), widget.aggregation || 'sum'),
          }));
          const sizeField = pointSizeField || pointFields[0];
          grp.size = aggregate(grp.rows.map(r => +r[sizeField] || 0), widget.aggregation || 'sum');
          maxPtSize = Math.max(maxPtSize, Math.abs(grp.size));
        }

        const ptMinR = 6, ptMaxR = Math.min(25, Math.max(10, w / 40));
        const ptSizeScale = maxPtSize > 0
          ? d3.scaleSqrt().domain([0, maxPtSize]).range([ptMinR, ptMaxR])
          : () => ptMinR;

        for (const [, grp] of pointGroups) {
          const [px, py] = projection([grp.lng, grp.lat]);
          if (isNaN(px) || isNaN(py)) continue;
          const r = ptSizeScale(Math.abs(grp.size));
          const label = pointLabelField ? String(grp.rows[0][pointLabelField] ?? '') : `${grp.lat.toFixed(2)}, ${grp.lng.toFixed(2)}`;

          if (pointType === 'pie') {
            drawMiniPie(pointLayer, px, py, r, grp.slices, paletteColors);
          } else {
            drawMiniBar(pointLayer, px, py, r, grp.slices, paletteColors, true);
          }

          // Hit area
          pointLayer.append('circle')
            .attr('cx', px).attr('cy', py)
            .attr('r', r + 2)
            .attr('fill', 'transparent')
            .style('cursor', 'pointer')
            .on('mouseover', (ev) => {
              showTooltip(ev, <OverlayTip name={label} slices={grp.slices} size={grp.size} sizeField={pointSizeField || pointFields[0]} widget={widget} />);
            })
            .on('mousemove', moveTooltip)
            .on('mouseleave', hideTooltip);
        }
      }
    }

    // ── Legend ──
    renderLegend(svg, colorScale, minVal, maxVal, w, h, widget);

    // ── Zoom ──
    const zoom = d3.zoom()
      .scaleExtent([0.5, 12])
      .on('zoom', (event) => mapGroup.attr('transform', event.transform));
    zoomRef.current = zoom;
    svg.call(zoom);

    if (widget.mapZoom != null || widget.mapCenter != null) {
      const k = widget.mapZoom ?? 1;
      const cx = widget.mapCenter?.[0] ?? 10;
      const cy = widget.mapCenter?.[1] ?? 10;
      svg.call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(k));
    }
  }, [worldData, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  const handleReset = useCallback(() => {
    const svg = d3.select(svgRef.current);
    if (zoomRef.current) {
      svg.transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity.translate(10, 10).scale(1));
    }
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'hidden' }} />

      {worldData && widget.geoField && widget.valueField && (
        <button
          onClick={handleReset}
          title="Reset zoom"
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 26, height: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #ddd)',
            borderRadius: 4, cursor: 'pointer', padding: 0,
            color: 'var(--text-muted, #888)', fontSize: 12, lineHeight: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)', zIndex: 2,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      )}

      {tooltipEl}
      {loadError && <Placeholder text="Failed to load map data" />}
      {!worldData && !loadError && <Placeholder text="Loading map..." />}
      {worldData && (!widget.geoField || !widget.valueField) && <Placeholder text="Select Geography and Value fields" />}
    </div>
  );
}

function renderLegend(svg, colorScale, minVal, maxVal, w, h, widget) {
  const legendW = Math.min(200, w * 0.4);
  const legendH = 10;
  const lx = w - legendW - 20;
  const ly = h - 30;
  const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
  defs.select('#geo-grad').remove();
  const grad = defs.append('linearGradient').attr('id', 'geo-grad');
  for (let i = 0; i <= 10; i++) {
    grad.append('stop')
      .attr('offset', `${i * 10}%`)
      .attr('stop-color', colorScale(minVal + (maxVal - minVal) * (i / 10)));
  }
  const legend = svg.append('g').attr('class', 'geo-legend');
  legend.append('rect').attr('x', lx).attr('y', ly).attr('width', legendW).attr('height', legendH)
    .attr('fill', 'url(#geo-grad)').attr('rx', 3);
  legend.append('text').attr('x', lx).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
    .text(formatValue(minVal, widget.numberFormat));
  legend.append('text').attr('x', lx + legendW).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
    .attr('text-anchor', 'end').text(formatValue(maxVal, widget.numberFormat));
}

// ── Tooltip components ──

function GeoTip({ name, match, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{name}</div>
      {match ? (
        <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(match.value, widget.numberFormat)}</span></div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No data</div>
      )}
    </>
  );
}

function OverlayTip({ name, slices, size, sizeField, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{name}</div>
      {slices.map((s, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="tt-label">{s.label}</span>
          <span className="tt-value">{formatValue(s.value, widget?.numberFormat)}</span>
        </div>
      ))}
      {sizeField && (
        <div className="chart-tooltip-row" style={{ borderTop: '1px solid var(--border)', marginTop: 2, paddingTop: 2 }}>
          <span className="tt-label">Size ({sizeField})</span>
          <span className="tt-value">{formatValue(size, widget?.numberFormat)}</span>
        </div>
      )}
    </>
  );
}

function PointTip({ label, grp, widget, pointSizeField, pointColorField }) {
  return (
    <>
      {label && <div className="chart-tooltip-title">{label}</div>}
      <div className="chart-tooltip-row">
        <span className="tt-label">Location</span>
        <span className="tt-value">{grp.lat.toFixed(3)}, {grp.lng.toFixed(3)}</span>
      </div>
      {pointSizeField && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{pointSizeField}</span>
          <span className="tt-value">{formatValue(grp.size, widget.numberFormat)}</span>
        </div>
      )}
      {pointColorField && grp.rows[0] && (
        <div className="chart-tooltip-row">
          <span className="tt-label">{pointColorField}</span>
          <span className="tt-value">{String(grp.rows[0][pointColorField] ?? '')}</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span className="tt-label">Records</span>
        <span className="tt-value">{grp.rows.length}</span>
      </div>
    </>
  );
}
