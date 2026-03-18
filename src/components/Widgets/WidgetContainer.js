import { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useApp } from '../../context/AppContext';
import { applyFilters } from '../../utils/dataUtils';
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
import Carousel from './Carousel';

const CHART_MAP = {
  bar: BarChart, line: LineChart, scatter: ScatterPlot, pie: PieChart,
  histogram: Histogram, table: DataTable,
  treemap: Treemap, heatmap: HeatMap, bump: BumpChart, stream: StreamGraph, violin: ViolinPlot,
  carousel: Carousel,
};

const TYPE_ICONS = {
  bar: '📊', line: '📈', scatter: '⬤', pie: '🥧', histogram: '▬', table: '🔢',
  treemap: '⬛', heatmap: '🌡', bump: '🏅', stream: '〰', violin: '🎻',
  carousel: '🎠',
};

export default function WidgetContainer({ widget, isEditing, isSelected, onSelect, onRemove, onDuplicate, onDragToPage }) {
  const { state } = useApp();
  const [maximized, setMaximized] = useState(false);
  const theme = state.dashboard.theme || {};

  const dataset = state.datasets.find(d => d.id === widget.datasetId);
  const raw = dataset?.data ?? [];
  const data = isEditing ? raw : applyFilters(raw, state.filters);

  const Chart = CHART_MAP[widget.type] || BarChart;
  const closeMaximize = useCallback(() => setMaximized(false), []);

  // Resolve color scheme: widget override → theme default → fallback
  const effectiveWidget = {
    ...widget,
    colorScheme: widget.colorScheme ?? theme.colorScheme ?? 'vivid',
  };

  const chartBody = dataset
    ? <Chart widget={effectiveWidget} data={data} />
    : (
      <div className="empty-state" style={{ height: '100%' }}>
        <div style={{ fontSize: 28, opacity: .3 }}>🗄</div>
        <p>No dataset selected</p>
      </div>
    );

  const shadowMap = {
    none: 'none',
    sm: '0 1px 3px rgba(0,0,0,.08)',
    md: '0 2px 8px rgba(0,0,0,.10)',
    lg: '0 8px 24px rgba(0,0,0,.12)',
  };
  const cardBg = widget.backgroundColor ?? theme.cardColor ?? '#ffffff';
  const cardRadius = widget.cardRadius ?? theme.cardRadius ?? 8;
  const cardShadow = shadowMap[theme.cardShadow] ?? shadowMap.md;

  return (
    <>
      <div
        className={`widget-card ${isSelected ? 'widget-card--selected' : ''}`}
        style={{
          backgroundColor: cardBg,
          borderRadius: cardRadius,
          boxShadow: isSelected ? undefined : cardShadow,
        }}
        onClick={isEditing ? onSelect : undefined}
      >
        <div className="widget-header">
          <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[widget.type] || '📊'}</span>
          <span className="widget-title">{widget.title || 'Untitled'}</span>
          <div className="widget-actions">
            <button
              className="btn btn-ghost btn-icon btn-sm"
              title="Maximize"
              onClick={e => { e.stopPropagation(); setMaximized(true); }}
            >⤢</button>
            {isEditing && onDuplicate && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Duplicate"
                onClick={e => { e.stopPropagation(); onDuplicate(); }}
              >⧉</button>
            )}
            {isEditing && onDragToPage && (
              <button
                className="btn btn-ghost btn-icon btn-sm widget-drag-to-page"
                title="Drag to another page"
                draggable
                onDragStart={e => {
                  e.stopPropagation();
                  e.dataTransfer.setData('application/widget-id', widget.id);
                  e.dataTransfer.effectAllowed = 'copyMove';
                  onDragToPage(widget.id);
                }}
                onDragEnd={() => onDragToPage(null)}
              >⇱</button>
            )}
            {isEditing && onRemove && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Remove"
                onClick={e => { e.stopPropagation(); onRemove(); }}
              >✕</button>
            )}
          </div>
        </div>
        <div className="widget-body">{chartBody}</div>
      </div>

      {maximized && ReactDOM.createPortal(
        <div className="widget-maximize-overlay" onClick={closeMaximize}>
          <div className="widget-maximize-card" onClick={e => e.stopPropagation()}>
            <div className="widget-header" style={{ cursor: 'default' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[widget.type] || '📊'}</span>
              <span className="widget-title">{widget.title || 'Untitled'}</span>
              <div className="widget-actions">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={closeMaximize}>✕</button>
              </div>
            </div>
            <div className="widget-body">{chartBody}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
