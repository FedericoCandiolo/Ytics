import * as d3 from 'd3';

// ── Palette registry ──────────────────────────────────────────────────────────
// Maps our descriptive palette keys to d3 color arrays

const CATEGORICAL = {
  vivid:    d3.schemeTableau10,
  spectrum: d3.schemeCategory10,
  muted:    d3.schemeSet2,
  soft:     d3.schemeSet3,
  pastel:   d3.schemePastel1,
  contrast: d3.schemeDark2,
  duo:      d3.schemePaired,
  bold:     d3.schemeAccent,
};

const SEQUENTIAL = {
  blues:   d3.schemeBlues[9],
  greens:  d3.schemeGreens[9],
  reds:    d3.schemeReds[9],
  purples: d3.schemePurples[9],
  oranges: d3.schemeOranges[9],
};

const DIVERGING = {
  warmCool:   d3.schemeRdYlBu[9],
  brownGreen: d3.schemeBrBG[9],
};

export const ALL_SCHEMES = { ...CATEGORICAL, ...SEQUENTIAL, ...DIVERGING };

// D3 interpolators for sequential / diverging schemes
const INTERPOLATORS = {
  blues:      d3.interpolateBlues,
  greens:     d3.interpolateGreens,
  reds:       d3.interpolateReds,
  purples:    d3.interpolatePurples,
  oranges:    d3.interpolateOranges,
  warmCool:   d3.interpolateRdYlBu,
  brownGreen: d3.interpolateBrBG,
  viridis:    d3.interpolateViridis,
  plasma:     d3.interpolatePlasma,
  inferno:    d3.interpolateInferno,
  turbo:      d3.interpolateTurbo,
  spectral:   d3.interpolateSpectral,
};

// Gradient schemes available in the UI
export const GRADIENT_SCHEMES = {
  blues: 'Blues', greens: 'Greens', reds: 'Reds', purples: 'Purples', oranges: 'Oranges',
  warmCool: 'Red → Yellow → Blue', brownGreen: 'Brown → Green',
  viridis: 'Viridis', plasma: 'Plasma', inferno: 'Inferno', turbo: 'Turbo', spectral: 'Spectral',
};

// Returns a d3 ordinal scale for the given palette key
export function getColorScale(schemeKey, domain) {
  const arr = ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid;
  return d3.scaleOrdinal(arr).domain(domain || []);
}

// Returns first color of a palette (for single-series charts)
export function getPrimaryColor(schemeKey) {
  const arr = ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid;
  return arr[0];
}

// Returns the raw array
export function getColorArray(schemeKey) {
  return ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid;
}

// Convenience: swatch preview array (first 10 colors)
export function getSwatchColors(schemeKey) {
  return (ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid).slice(0, 10);
}

// ── Dimension-color overrides ─────────────────────────────────────────────────

/**
 * Like getColorScale but applies dimension-color overrides.
 * overrides: { 'Argentina': { type: 'custom', color: '#74b9ff' },
 *              'Brazil':    { type: 'palette', index: 2 } }
 */
export function getColorScaleWithOverrides(schemeKey, domain, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) {
    return getColorScale(schemeKey, domain);
  }
  const arr = ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid;
  const base = d3.scaleOrdinal(arr).domain(domain || []);
  return (val) => {
    const ov = overrides[val];
    if (!ov) return base(val);
    if (ov.type === 'custom') return ov.color;
    if (ov.type === 'palette') return arr[ov.index % arr.length];
    return base(val);
  };
}

/**
 * Like getColorArray-based ordinal but with overrides (for grouped/stacked).
 */
export function getOrdinalWithOverrides(schemeKey, domain, overrides) {
  const arr = ALL_SCHEMES[schemeKey] || CATEGORICAL.vivid;
  const base = d3.scaleOrdinal().domain(domain).range(arr);
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return (val) => {
    const ov = overrides[val];
    if (!ov) return base(val);
    if (ov.type === 'custom') return ov.color;
    if (ov.type === 'palette') return arr[ov.index % arr.length];
    return base(val);
  };
}

// ── Sequential / gradient scales ──────────────────────────────────────────────

/**
 * Returns a continuous color scale for a numeric [min, max] domain.
 * schemeKey: one of the GRADIENT_SCHEMES keys.
 */
export function getSequentialScale(schemeKey, min, max) {
  const interp = INTERPOLATORS[schemeKey] || d3.interpolateBlues;
  return d3.scaleSequential(interp).domain([min, max]);
}

/**
 * Build a sequential scale from custom gradient stops.
 * stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }]
 */
export function getCustomGradientScale(stops, min, max) {
  if (!stops?.length) return () => '#94a3b8';
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const colors = sorted.map(s => s.color);
  const offsets = sorted.map(s => s.offset);
  const domain = offsets.map(o => min + o * (max - min));
  return d3.scaleLinear().domain(domain).range(colors).clamp(true);
}

/**
 * Generates N swatch colors from a gradient for preview purposes.
 */
export function getGradientSwatches(schemeKey, n = 8) {
  const interp = INTERPOLATORS[schemeKey] || d3.interpolateBlues;
  return Array.from({ length: n }, (_, i) => interp(i / (n - 1)));
}

// ── Contrast helpers ──────────────────────────────────────────────────────────

/**
 * Returns '#fff' or '#000' for best text readability on the given background.
 */
export function contrastText(bgColor) {
  try {
    const c = d3.color(bgColor);
    if (!c) return '#000';
    const { r, g, b } = c.rgb();
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? '#000' : '#fff';
  } catch {
    return '#000';
  }
}
