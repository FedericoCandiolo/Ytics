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

// Build a smooth interpolator from an array of color stops
function interpFromColors(colors) {
  const scale = d3.scaleLinear()
    .domain(colors.map((_, i) => i / (colors.length - 1)))
    .range(colors)
    .interpolate(d3.interpolateRgb)
    .clamp(true);
  return t => scale(t);
}

// D3 interpolators for sequential / diverging schemes
const INTERPOLATORS = {
  // Standard d3 sequential
  blues:      d3.interpolateBlues,
  greens:     d3.interpolateGreens,
  reds:       d3.interpolateReds,
  purples:    d3.interpolatePurples,
  oranges:    d3.interpolateOranges,
  // Diverging
  warmCool:   d3.interpolateRdYlBu,
  brownGreen: d3.interpolateBrBG,
  // Perceptual
  viridis:    d3.interpolateViridis,
  plasma:     d3.interpolatePlasma,
  inferno:    d3.interpolateInferno,
  turbo:      d3.interpolateTurbo,
  spectral:   d3.interpolateSpectral,
  // Palette-derived gradients: ordered low → mid → high (danger → warning → good)
  // Each uses colors from its own palette in a red → yellow → green semantic order
  vivid:    interpFromColors([d3.schemeTableau10[2], d3.schemeTableau10[1], d3.schemeTableau10[5], d3.schemeTableau10[4], d3.schemeTableau10[0]]),  // red → orange → yellow → green → blue
  spectrum: interpFromColors([d3.schemeCategory10[3], d3.schemeCategory10[1], d3.schemeCategory10[8], d3.schemeCategory10[2], d3.schemeCategory10[0]]),  // red → orange → olive → green → blue
  muted:    interpFromColors([d3.schemeSet2[1], d3.schemeSet2[5], d3.schemeSet2[4], d3.schemeSet2[0]]),                                // coral → yellow → lime → teal
  soft:     interpFromColors([d3.schemeSet3[3], d3.schemeSet3[5], d3.schemeSet3[1], d3.schemeSet3[6], d3.schemeSet3[0]]),              // salmon → orange → cream → lime → teal
  pastel:   interpFromColors([d3.schemePastel1[0], d3.schemePastel1[4], d3.schemePastel1[5], d3.schemePastel1[2], d3.schemePastel1[1]]),  // pink → peach → cream → mint → sky
  contrast: interpFromColors([d3.schemeDark2[1], d3.schemeDark2[5], d3.schemeDark2[4], d3.schemeDark2[0]]),                          // orange → gold → green → teal
  duo:      interpFromColors([d3.schemePaired[5], d3.schemePaired[7], d3.schemePaired[6], d3.schemePaired[10], d3.schemePaired[3], d3.schemePaired[1]]),  // red → orange → peach → yellow → green → blue
  bold:     interpFromColors([d3.schemeAccent[6], d3.schemeAccent[2], d3.schemeAccent[3], d3.schemeAccent[0], d3.schemeAccent[4]]),    // brown → peach → yellow → green → blue
};

// Gradient schemes available in the UI
export const GRADIENT_SCHEMES = {
  // Palette-derived (shown first, matching categorical palettes)
  vivid: 'Vivid', spectrum: 'Spectrum', muted: 'Muted', soft: 'Soft',
  pastel: 'Pastel', contrast: 'Contrast', duo: 'Duo', bold: 'Bold',
  // Standard sequential
  blues: 'Blues', greens: 'Greens', reds: 'Reds', purples: 'Purples', oranges: 'Oranges',
  // Diverging
  warmCool: 'Red → Yellow → Blue', brownGreen: 'Brown → Green',
  // Perceptual
  viridis: 'Viridis', plasma: 'Plasma', inferno: 'Inferno', turbo: 'Turbo', spectral: 'Spectral',
};

// Maps each categorical palette to its own gradient (same key)
const PALETTE_DEFAULT_GRADIENT = {
  vivid:    'vivid',
  spectrum: 'spectrum',
  muted:    'muted',
  soft:     'soft',
  pastel:   'pastel',
  contrast: 'contrast',
  duo:      'duo',
  bold:     'bold',
  // Sequential palettes map to themselves
  blues: 'blues', greens: 'greens', reds: 'reds', purples: 'purples', oranges: 'oranges',
  // Diverging
  warmCool: 'warmCool', brownGreen: 'brownGreen',
};

/** Resolves the gradient key: explicit override → palette default → 'blues' fallback */
export function resolveGradient(colorScheme, gradientOverride) {
  if (gradientOverride) return gradientOverride;
  return PALETTE_DEFAULT_GRADIENT[colorScheme] || 'blues';
}

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
export function getSequentialScale(schemeKey, min, max, invert, log) {
  const interp = INTERPOLATORS[schemeKey] || d3.interpolateBlues;
  if (log) {
    // Symmetric log scale: handles zero and negative values via log1p transform
    const domain = invert ? [max, min] : [min, max];
    return d3.scaleSequentialSymlog(interp).domain(domain);
  }
  return d3.scaleSequential(interp).domain(invert ? [max, min] : [min, max]);
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
