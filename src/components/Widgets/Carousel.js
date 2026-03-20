/**
 * Carousel — cycles through multiple chart slides on the same dataset.
 * widget.slides = [{ id, type, title, xField, yField, ... }]
 */
import { useState, useEffect, useRef } from 'react';
import BarChart from './BarChart';
import LineChart from './LineChart';
import ScatterPlot from './ScatterPlot';
import PieChart from './PieChart';
import Histogram from './Histogram';
import DataTable from './DataTable';
import Treemap from './Treemap';
import HeatMap from './HeatMap';
import BumpChart from './BumpChart';
import StreamGraph from './StreamGraph';
import ViolinPlot from './ViolinPlot';
import { Placeholder } from './chartHelpers';

const SLIDE_CHART_MAP = {
  bar: BarChart, line: LineChart, scatter: ScatterPlot, pie: PieChart,
  histogram: Histogram, table: DataTable,
  treemap: Treemap, heatmap: HeatMap, bump: BumpChart, stream: StreamGraph, violin: ViolinPlot,
};

export default function Carousel({ widget, data, onCrossFilter }) {
  const slides = widget.slides || [];
  const [idx, setIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Clamp idx when slides change
  useEffect(() => {
    setIdx(i => Math.min(i, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  // Auto-advance
  useEffect(() => {
    if (!widget.autoPlay || slides.length <= 1) return;
    const t = setInterval(
      () => setIdx(i => (i + 1) % slides.length),
      widget.autoPlayInterval || 5000
    );
    return () => clearInterval(t);
  }, [widget.autoPlay, widget.autoPlayInterval, slides.length]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!slides.length) return <Placeholder text="No slides — add charts in the editor" />;

  const slide = slides[idx] || slides[0];
  const Chart = SLIDE_CHART_MAP[slide?.type] || BarChart;

  const go = (delta) => setIdx(i => (i + delta + slides.length) % slides.length);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Chart widget={{ ...slide, colorScheme: slide.colorScheme || widget.colorScheme, dimensionColors: widget.dimensionColors }} data={data} onCrossFilter={onCrossFilter} />
      </div>

      {/* Navigation */}
      {slides.length > 1 && (
        <div className="carousel-nav" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {/* Centered: prev + dots + next */}
          <button className="carousel-arrow" onClick={() => go(-1)}>‹</button>
          <div className="carousel-dots">
            {slides.map((s, i) => (
              <button
                key={s.id || i}
                className={`carousel-dot ${i === idx ? 'carousel-dot--active' : ''}`}
                onClick={() => setIdx(i)}
                title={s.title || `Slide ${i + 1}`}
              />
            ))}
          </div>
          <button className="carousel-arrow" onClick={() => go(1)}>›</button>
          {/* Menu icon pinned to the right */}
          <div style={{ position: 'absolute', right: 4 }} ref={menuRef}>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              title="Jump to slide"
              onClick={() => setMenuOpen(o => !o)}
              style={{ fontSize: 13 }}
            >☰</button>
            {menuOpen && (
              <div style={{
                position: 'absolute', bottom: '100%', right: 0, marginBottom: 4,
                background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
                borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.12)',
                maxHeight: 200, overflowY: 'auto', minWidth: 160, zIndex: 20,
              }}>
                {slides.map((s, i) => {
                  const groupLabel = s.groupValue != null ? ` — ${s.groupValue}` : '';
                  const label = s.title
                    ? `${s.title}${groupLabel}`
                    : `Slide ${i + 1}${groupLabel}`;
                  return (
                    <button
                      key={s.id || i}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 12px', border: 'none', background: i === idx ? 'var(--surface-hover, #f0f0f0)' : 'transparent',
                        cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)',
                        color: 'var(--text)',
                      }}
                      onClick={() => { setIdx(i); setMenuOpen(false); }}
                    >
                      {i + 1}. {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
