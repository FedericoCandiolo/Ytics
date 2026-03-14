/**
 * Carousel — cycles through multiple chart slides on the same dataset.
 * widget.slides = [{ id, type, title, xField, yField, ... }]
 */
import { useState, useEffect } from 'react';
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

export default function Carousel({ widget, data }) {
  const slides = widget.slides || [];
  const [idx, setIdx] = useState(0);

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

  if (!slides.length) return <Placeholder text="No slides — add charts in the editor" />;

  const slide = slides[idx] || slides[0];
  const Chart = SLIDE_CHART_MAP[slide?.type] || BarChart;

  const go = (delta) => setIdx(i => (i + delta + slides.length) % slides.length);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Slide title bar */}
      {slide.title && (
        <div style={{
          padding: '3px 12px', fontSize: 11, fontWeight: 600,
          color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
          background: '#fafafa', flexShrink: 0,
        }}>
          {slide.title}
        </div>
      )}

      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Chart widget={{ ...slide, colorScheme: slide.colorScheme || widget.colorScheme }} data={data} />
      </div>

      {/* Navigation */}
      {slides.length > 1 && (
        <div className="carousel-nav">
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
        </div>
      )}
    </div>
  );
}
