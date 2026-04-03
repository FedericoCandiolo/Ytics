/**
 * Pre-compute responsive layouts from the canonical `lg` layout.
 *
 * react-grid-layout auto-generates missing breakpoint layouts, but it does so
 * AFTER the first paint — causing a visible flash.  By supplying all layouts
 * up-front, the grid renders correctly on the very first frame.
 *
 * Strategy: scale each item's x and w proportionally from lgCols → targetCols,
 * then resolve overlaps by pushing items down.
 */

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const COLS        = { lg: 24,   md: 16,  sm: 8,   xs: 4   };

/**
 * Adapt a single layout item from `fromCols` columns to `toCols` columns.
 */
function scaleItem(item, fromCols, toCols) {
  const ratio = toCols / fromCols;
  let w = Math.max(1, Math.round(item.w * ratio));
  let x = Math.round(item.x * ratio);

  // Clamp: can't exceed grid width
  if (w > toCols) w = toCols;
  if (x + w > toCols) x = Math.max(0, toCols - w);

  return { ...item, x, w };
}

/**
 * Given a set of items (already x/w-scaled), push overlapping items downward
 * so nothing overlaps.  Items are processed top-to-bottom, left-to-right.
 */
function resolveOverlaps(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];

  for (const item of sorted) {
    let y = item.y;

    // Push down until no collision
    let collision = true;
    while (collision) {
      collision = false;
      for (const p of placed) {
        if (
          item.x < p.x + p.w &&
          item.x + item.w > p.x &&
          y < p.y + p.h &&
          y + item.h > p.y
        ) {
          y = p.y + p.h;
          collision = true;
          break;          // restart check from the top of placed
        }
      }
    }

    placed.push({ ...item, y });
  }

  return placed;
}

/**
 * Given the canonical `lg` layout array, produce layouts for every breakpoint.
 *
 * @param {Array} lgLayout  — array of { i, x, y, w, h, … }
 * @returns {{ lg, md, sm, xs }}
 */
export function computeResponsiveLayouts(lgLayout) {
  if (!lgLayout?.length) return { lg: [], md: [], sm: [], xs: [] };

  const result = { lg: lgLayout };

  for (const bp of ['md', 'sm']) {
    const scaled = lgLayout.map(item => scaleItem(item, COLS.lg, COLS[bp]));
    result[bp] = resolveOverlaps(scaled);
  }

  // xs: single column — every widget is full-width, stacked vertically
  const sorted = [...lgLayout].sort((a, b) => a.y - b.y || a.x - b.x);
  let curY = 0;
  result.xs = sorted.map(item => {
    const out = { ...item, x: 0, w: COLS.xs, y: curY };
    curY += item.h;
    return out;
  });

  return result;
}

export { BREAKPOINTS, COLS };
