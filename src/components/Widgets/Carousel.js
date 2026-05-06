/**
 * Carousel — cycles through multiple chart slides on the same dataset.
 * widget.slides = [{ id, type, title, xField, yField, ... }]
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { resolveWidgetData } from '../../utils/associativeEngine';
import { executeMeasurePipeline } from '../../utils/dataUtils';
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

export default function Carousel({ widget, data, onCrossFilter, isEditing, onSlideChange }) {
  const { state, dispatch } = useApp();
  const isEditingMode = isEditing ?? false;
  const slides = widget.slides || [];
  const [idx, setIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const menuRef = useRef(null);

  const eject = (slideId) => {
    dispatch({ type: 'EJECT_FROM_CAROUSEL', payload: { carouselId: widget.id, slideId } });
    setMenuOpen(false);
  };

  // Clamp idx when slides change
  useEffect(() => {
    setIdx(i => Math.min(i, Math.max(0, slides.length - 1)));
  }, [slides.length]);

  // Notify parent of current slide title
  useEffect(() => {
    if (onSlideChange && slides[idx]) {
      onSlideChange(slides[idx].title || null);
    }
  }, [idx, slides, onSlideChange]);

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

  const dropHandlers = isEditingMode ? {
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes('application/widget-id')) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropHover(true);
      }
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropHover(false);
    },
    onDrop: (e) => {
      const widgetId = e.dataTransfer.getData('application/widget-id');
      setDropHover(false);
      if (widgetId && widgetId !== widget.id) {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: 'ADD_TO_CAROUSEL', payload: { carouselId: widget.id, widgetId } });
      }
    },
  } : {};

  const slide = slides[idx] || slides[0];
  const Chart = SLIDE_CHART_MAP[slide?.type] || BarChart;

  // Resolve data for the current slide independently so each slide's dataset
  // and measure pipeline are applied correctly (not the carousel container's).
  const slideData = useMemo(() => {
    if (!slide) return data;
    const resolved = resolveWidgetData(slide, state.datasets, state.colStore, null);
    const base = resolved.length > 0 ? resolved : data;
    if (slide.measures?.length > 0) {
      try { return executeMeasurePipeline(base, slide.measures); } catch { return base; }
    }
    return base;
  }, [slide, state.datasets, state.colStore, data]);

  const go = (delta) => setIdx(i => (i + delta + slides.length) % slides.length);

  if (!slides.length) return (
    <div
      style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: dropHover ? '2px dashed var(--primary)' : '2px dashed transparent',
        borderRadius: 8, background: dropHover ? 'var(--surface-hover, rgba(0,0,0,.04))' : 'transparent',
        transition: 'all .15s', boxSizing: 'border-box' }}
      {...dropHandlers}
    >
      <Placeholder text={isEditingMode ? 'Drop a widget here or add slides in the editor' : 'No slides — add charts in the editor'} />
    </div>
  );

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column',
        outline: dropHover ? '2px dashed var(--primary)' : 'none',
        borderRadius: 8, boxSizing: 'border-box' }}
      {...dropHandlers}
    >
      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Chart widget={{ ...slide, colorScheme: slide.colorScheme || widget.colorScheme, dimensionColors: widget.dimensionColors }} data={slideData} onCrossFilter={onCrossFilter} />
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
                    <div
                      key={s.id || i}
                      style={{
                        display: 'flex', alignItems: 'center',
                        background: i === idx ? 'var(--surface-hover, #f0f0f0)' : 'transparent',
                      }}
                    >
                      <button
                        style={{
                          flex: 1, textAlign: 'left',
                          padding: '6px 12px', border: 'none', background: 'transparent',
                          cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)',
                          color: 'var(--text)',
                        }}
                        onClick={() => { setIdx(i); setMenuOpen(false); }}
                      >
                        {i + 1}. {label}
                      </button>
                      {isEditingMode && s.id && (
                        <button
                          title="Eject to canvas"
                          style={{
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            padding: '4px 8px', fontSize: 13, color: 'var(--text-muted)',
                            flexShrink: 0,
                          }}
                          onClick={() => eject(s.id)}
                        >⇲</button>
                      )}
                    </div>
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
