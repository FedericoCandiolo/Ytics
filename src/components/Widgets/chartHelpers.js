import { useEffect, useState } from 'react';

/** ResizeObserver hook — returns {w, h} of container element. */
export function useChartDims(ref) {
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return dims;
}

/** Apply consistent axis styling. */
export function styledAxis(g) {
  g.select('.domain').attr('stroke', 'var(--chart-grid-color)');
  g.selectAll('.tick line').attr('stroke', 'var(--chart-grid-color)');
  g.selectAll('text')
    .attr('fill', 'var(--chart-axis-color)')
    .attr('font-size', 'var(--chart-label-size)')
    .attr('font-family', 'var(--font)');
}

/** Centered "no data" placeholder overlay. */
export function Placeholder({ text }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-light)', fontSize: 12, gap: 6,
      pointerEvents: 'none', userSelect: 'none',
    }}>
      <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.4}>
        <rect x={3} y={3} width={18} height={18} rx={3} />
        <path d="M8 17V13M12 17V9M16 17V12" strokeLinecap="round" />
      </svg>
      {text}
    </div>
  );
}

/** Format compact numbers for axis ticks. */
export function fmtTick(v) {
  if (typeof v !== 'number') return v;
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}
