import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { aggregate, formatValue } from '../../utils/dataUtils';
import { useTooltip } from './useTooltip';
import { useChartDims, Placeholder } from './chartHelpers';
import { resolveGradient } from '../../utils/colorUtils';

const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const PROJECTIONS = {
  naturalEarth: d3.geoNaturalEarth1,
  mercator: d3.geoMercator,
  equalEarth: d3.geoEqualEarth,
  orthographic: d3.geoOrthographic,
};

// Country name aliases for matching
const ALIASES = {
  'usa': 'United States of America', 'us': 'United States of America', 'united states': 'United States of America',
  'uk': 'United Kingdom', 'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'russia': 'Russia', 'russian federation': 'Russia',
  'south korea': 'South Korea', 'korea': 'South Korea',
  'china': 'China', "people's republic of china": 'China',
  'uae': 'United Arab Emirates',
};

// ── Scope definitions: bounding boxes [west, south, east, north] ─────────
const SCOPE_BOUNDS = {
  'north-america': [[-170, 7], [170, 84]],
  'south-america': [[-82, -56], [-34, 13]],
  'europe': [[-25, 34], [50, 72]],
  'africa': [[-18, -35], [52, 37]],
  'asia': [[25, -12], [180, 75]],
  'oceania': [[110, -50], [180, 5]],
};

/** Determine whether a scope value is a continent key or a country name. */
function parseScopeType(scope) {
  if (!scope || scope === 'world') return { type: 'world' };
  const lower = scope.toLowerCase();
  if (SCOPE_BOUNDS[lower]) return { type: 'continent', key: lower };
  return { type: 'country', name: scope };
}

/** Filter features to those whose centroids fall inside the bounding box. */
function filterFeaturesByBounds(features, bounds) {
  const [[west, south], [east, north]] = bounds;
  return features.filter(f => {
    const centroid = d3.geoCentroid(f);
    if (!centroid || isNaN(centroid[0])) return false;
    const [lon, lat] = centroid;
    return lon >= west && lon <= east && lat >= south && lat <= north;
  });
}

/** Find a country feature by name (case-insensitive, alias-aware). */
function findCountryFeature(features, name) {
  const lower = name.toLowerCase();
  // Direct match
  let found = features.find(f => (f.properties.name || '').toLowerCase() === lower);
  if (found) return found;
  // Try alias
  const aliased = ALIASES[lower];
  if (aliased) {
    found = features.find(f => (f.properties.name || '').toLowerCase() === aliased.toLowerCase());
    if (found) return found;
  }
  // Partial match
  return features.find(f => {
    const fn = (f.properties.name || '').toLowerCase();
    return fn.includes(lower) || lower.includes(fn);
  });
}

// ── Rendering layers (modular architecture for future multi-layer support) ──

/** Render the base choropleth layer into the given <g> element. */
function renderChoroplethLayer(g, features, pathGen, matchCountry, colorScale, opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter) {
  g.selectAll('path.geo-country')
    .data(features)
    .join('path')
    .attr('class', 'geo-country')
    .attr('d', pathGen)
    .attr('fill', d => {
      const match = matchCountry(d.properties.name);
      return match ? colorScale(match.value) : '#e5e7eb';
    })
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.5)
    .attr('opacity', opacity)
    .on('mouseover', (ev, d) => {
      d3.select(ev.currentTarget).attr('stroke', '#333').attr('stroke-width', 1.5);
      const match = matchCountry(d.properties.name);
      showTooltip(ev, <GeoTip name={d.properties.name} match={match} widget={widget} />);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', (ev) => {
      d3.select(ev.currentTarget).attr('stroke', '#fff').attr('stroke-width', 0.5);
      hideTooltip();
    })
    .on('click', onCrossFilter ? (ev, d) => { ev.stopPropagation(); onCrossFilter({ field: widget.geoField, value: d.properties.name }); } : null)
    .style('cursor', onCrossFilter ? 'pointer' : null);
}

/** Render the color legend bar. */
function renderLegend(svg, colorScale, minVal, maxVal, w, h) {
  const legendW = Math.min(200, w * 0.4);
  const legendH = 10;
  const lx = w - legendW - 20;
  const ly = h - 30;
  const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
  // Remove old gradient if present
  defs.select('#geo-grad').remove();
  const grad = defs.append('linearGradient').attr('id', 'geo-grad');
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    grad.append('stop')
      .attr('offset', `${(i / steps) * 100}%`)
      .attr('stop-color', colorScale(minVal + (maxVal - minVal) * (i / steps)));
  }

  const legend = svg.append('g').attr('class', 'geo-legend');
  legend.append('rect').attr('x', lx).attr('y', ly).attr('width', legendW).attr('height', legendH)
    .attr('fill', 'url(#geo-grad)').attr('rx', 3);
  legend.append('text').attr('x', lx).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
    .text(formatValue(minVal));
  legend.append('text').attr('x', lx + legendW).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
    .attr('text-anchor', 'end').text(formatValue(maxVal));
}

export default function GeoMap({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);        // d3.zoom instance
  const zoomGroupRef = useRef(null);    // the <g> that gets transformed by zoom
  const dims = useChartDims(containerRef);
  const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();
  const [worldData, setWorldData] = useState(null);
  const [loadError, setLoadError] = useState(false);

  // Load world topology once
  useEffect(() => {
    let cancelled = false;
    fetch(WORLD_TOPO_URL)
      .then(r => r.json())
      .then(topo => {
        if (!cancelled) setWorldData(topo);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
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

    // ── Scope: determine which features to show and how to fit ──
    const scope = parseScopeType(widget.mapScope);
    let displayFeatures = allCountries.features;
    let fitTarget = allCountries; // GeoJSON object to fit the projection to

    if (scope.type === 'continent') {
      const filtered = filterFeaturesByBounds(allCountries.features, SCOPE_BOUNDS[scope.key]);
      if (filtered.length > 0) {
        displayFeatures = filtered;
        fitTarget = { type: 'FeatureCollection', features: filtered };
      }
    } else if (scope.type === 'country') {
      const countryFeature = findCountryFeature(allCountries.features, scope.name);
      if (countryFeature) {
        // Show the target country plus its neighbors (features whose centroids are within ~15 degrees)
        const centroid = d3.geoCentroid(countryFeature);
        const nearby = allCountries.features.filter(f => {
          const c = d3.geoCentroid(f);
          if (!c || isNaN(c[0])) return false;
          const dist = Math.sqrt((c[0] - centroid[0]) ** 2 + (c[1] - centroid[1]) ** 2);
          return dist < 25;
        });
        displayFeatures = nearby.length > 1 ? nearby : allCountries.features;
        fitTarget = countryFeature;
      }
    }

    // ── Aggregate data by geo field ──
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

    // Match function
    const matchCountry = (featureName) => {
      const lower = (featureName || '').toLowerCase();
      if (aggMap.has(lower)) return aggMap.get(lower);
      if (ALIASES[lower] && aggMap.has(ALIASES[lower].toLowerCase())) return aggMap.get(ALIASES[lower].toLowerCase());
      for (const [key, entry] of aggMap) {
        if (lower.includes(key) || key.includes(lower)) return entry;
      }
      return null;
    };

    const values = [...aggMap.values()].map(v => v.value);
    const [minVal, maxVal] = [d3.min(values) || 0, d3.max(values) || 1];

    // ── Color scale ──
    const INTERP_MAP = {
      blues: d3.interpolateBlues, greens: d3.interpolateGreens, reds: d3.interpolateReds,
      purples: d3.interpolatePurples, oranges: d3.interpolateOranges,
      warmCool: d3.interpolateRdYlBu, brownGreen: d3.interpolateBrBG,
      viridis: d3.interpolateViridis, plasma: d3.interpolatePlasma,
      inferno: d3.interpolateInferno, turbo: d3.interpolateTurbo, spectral: d3.interpolateSpectral,
    };
    const gradKey = resolveGradient(widget.colorScheme, widget.colorGradient);
    const colorInterp = INTERP_MAP[gradKey] || d3.interpolateBlues;
    const colorScale = d3.scaleSequential(colorInterp).domain([minVal, maxVal]);

    // ── Projection ──
    const ProjFn = PROJECTIONS[widget.mapProjection] || PROJECTIONS.naturalEarth;
    const projection = ProjFn().fitSize([w - 20, h - 40], fitTarget);
    const pathGen = d3.geoPath(projection);

    // ── SVG setup ──
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);

    // Clip path so zoom doesn't overflow
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'geo-clip')
      .append('rect').attr('width', w).attr('height', h);

    // Main group with clipping — this is the zoom target
    const zoomGroup = svg.append('g')
      .attr('clip-path', 'url(#geo-clip)');
    const mapGroup = zoomGroup.append('g')
      .attr('transform', 'translate(10, 10)');
    zoomGroupRef.current = mapGroup.node();

    // ── Render choropleth layer ──
    const choroplethLayer = mapGroup.append('g').attr('class', 'layer-choropleth');
    renderChoroplethLayer(
      choroplethLayer, displayFeatures, pathGen, matchCountry, colorScale,
      opacity, widget, showTooltip, moveTooltip, hideTooltip, onCrossFilter
    );

    // ── Legend (rendered outside the zoom group so it stays fixed) ──
    renderLegend(svg, colorScale, minVal, maxVal, w, h);

    // ── Pan & Zoom via d3.zoom ──
    const zoom = d3.zoom()
      .scaleExtent([0.5, 12])
      .on('zoom', (event) => {
        mapGroup.attr('transform', event.transform);
      });
    zoomRef.current = zoom;

    svg.call(zoom);

    // Apply initial zoom/center from widget props if provided
    const initialZoom = widget.mapZoom;
    const initialCenter = widget.mapCenter;
    if (initialZoom != null || initialCenter != null) {
      const k = initialZoom ?? 1;
      const cx = initialCenter?.[0] ?? 10;
      const cy = initialCenter?.[1] ?? 10;
      const initialTransform = d3.zoomIdentity.translate(cx, cy).scale(k);
      svg.call(zoom.transform, initialTransform);
    }
  }, [worldData, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  /** Reset zoom to initial (identity + offset) transform. */
  const handleReset = useCallback(() => {
    const svg = d3.select(svgRef.current);
    if (zoomRef.current) {
      svg.transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity.translate(10, 10).scale(1));
    }
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'hidden' }} />
      {/* Reset zoom button */}
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
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            zIndex: 2,
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

function GeoTip({ name, match, widget }) {
  return (
    <>
      <div className="chart-tooltip-title">{name}</div>
      {match ? (
        <div className="chart-tooltip-row"><span className="tt-label">{widget.valueField}</span><span className="tt-value">{formatValue(match.value)}</span></div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No data</div>
      )}
    </>
  );
}
