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

export default function GeoMap({ widget, data, onCrossFilter }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
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

    const countries = topojson.feature(worldData, worldData.objects.countries);
    const opacity = widget.opacity ?? 1;

    // Aggregate data by geo field
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
      // Try partial match
      for (const [key, entry] of aggMap) {
        if (lower.includes(key) || key.includes(lower)) return entry;
      }
      return null;
    };

    const values = [...aggMap.values()].map(v => v.value);
    const [minVal, maxVal] = [d3.min(values) || 0, d3.max(values) || 1];

    // Color scale — use palette-linked gradient
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

    const ProjFn = PROJECTIONS[widget.mapProjection] || PROJECTIONS.naturalEarth;
    const projection = ProjFn().fitSize([w - 20, h - 40], countries);
    const pathGen = d3.geoPath(projection);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', w).attr('height', h);
    const g = svg.append('g').attr('transform', 'translate(10, 10)');

    // Draw countries
    g.selectAll('path').data(countries.features).join('path')
      .attr('d', pathGen)
      .attr('fill', d => {
        const match = matchCountry(d.properties.name);
        return match ? colorScale(match.value) : '#e5e7eb';
      })
      .attr('stroke', '#fff').attr('stroke-width', 0.5)
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

    // Color legend bar
    const legendW = Math.min(200, w * 0.4);
    const legendH = 10;
    const lx = w - legendW - 20;
    const ly = h - 30;
    const defs = svg.append('defs');
    const gradId = 'geo-grad';
    const grad = defs.append('linearGradient').attr('id', gradId);
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      grad.append('stop')
        .attr('offset', `${(i / steps) * 100}%`)
        .attr('stop-color', colorScale(minVal + (maxVal - minVal) * (i / steps)));
    }

    svg.append('rect').attr('x', lx).attr('y', ly).attr('width', legendW).attr('height', legendH)
      .attr('fill', `url(#${gradId})`).attr('rx', 3);
    svg.append('text').attr('x', lx).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
      .text(formatValue(minVal));
    svg.append('text').attr('x', lx + legendW).attr('y', ly - 4).attr('font-size', 9).attr('fill', 'var(--text-muted)')
      .attr('text-anchor', 'end').text(formatValue(maxVal));
  }, [worldData, data, widget, dims, showTooltip, moveTooltip, hideTooltip, onCrossFilter]);

  useEffect(render, [render]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ overflow: 'visible' }} />
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
