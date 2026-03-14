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
