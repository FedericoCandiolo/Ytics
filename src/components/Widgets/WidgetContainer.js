import { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useApp, canReplaceType } from '../../context/AppContext';
import { applyFilters, executeMeasurePipeline } from '../../utils/dataUtils';
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
import BoxPlot from './BoxPlot';
import RadarChart from './RadarChart';
import WaffleChart from './WaffleChart';
import SankeyDiagram from './SankeyDiagram';
import GeoMap from './GeoMap';
import PivotTable from './PivotTable';
import WaterfallChart from './WaterfallChart';
import WordCloud from './WordCloud';
import FunnelChart from './FunnelChart';
import KPICard from './KPICard';
import BubbleChart from './BubbleChart';
import ComboChart from './ComboChart';
import StraightTable from './StraightTable';
import MekkoChart from './MekkoChart';

const CHART_MAP = {
  bar: BarChart, line: LineChart, scatter: ScatterPlot, pie: PieChart,
  histogram: Histogram, table: DataTable,
  treemap: Treemap, heatmap: HeatMap, bump: BumpChart, stream: StreamGraph, violin: ViolinPlot,
  carousel: Carousel,
  boxplot: BoxPlot, radar: RadarChart, waffle: WaffleChart, sankey: SankeyDiagram, geo: GeoMap,
  pivot: PivotTable,
  waterfall: WaterfallChart, wordcloud: WordCloud, funnel: FunnelChart,
  kpi: KPICard, bubble: BubbleChart, combo: ComboChart,
  straighttable: StraightTable, mekko: MekkoChart,
};

const TYPE_ICONS = {
  bar: '📊', line: '📈', scatter: '⬤', pie: '🥧', histogram: '▬', table: '🔢',
  treemap: '⬛', heatmap: '🌡', bump: '🏅', stream: '〰', violin: '🎻',
  carousel: '🎠',
  boxplot: '📦', radar: '🕸', waffle: '🧇', sankey: '🔀', geo: '🌍',
  pivot: '⊞',
  waterfall: '📉', wordcloud: '☁', funnel: '🔻', kpi: '🎯',
  bubble: '🫧', combo: '📊📈', straighttable: '▦', mekko: '▥',
};

export { TYPE_ICONS };

export default function WidgetContainer({ widget, isEditing, isSelected, onSelect, onRemove, onDuplicate, onDragToPage, onTypeReplace }) {
  const { state, dispatch } = useApp();
  const [maximized, setMaximized] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const theme = state.dashboard.theme || {};

  // Cross-filter: clicking a chart element in viewer mode creates/toggles a filter
  const onCrossFilter = useCallback(({ field, value }) => {
    if (isEditing || !widget.datasetId || !field) return;
    const strVal = String(value);
    const filterId = `cross_${widget.datasetId}_${field}`;
    const existing = state.filters[filterId];
    // Toggle: if already filtering to exactly this value, remove the filter
    if (existing && existing.values?.length === 1 && existing.values[0] === strVal) {
      dispatch({ type: 'REMOVE_FILTER', payload: filterId });
    } else {
      dispatch({
        type: 'SET_FILTER',
        payload: {
          id: filterId, datasetId: widget.datasetId, field,
          filterType: 'categorical', active: true, values: [strVal],
        },
      });
    }
  }, [isEditing, widget.datasetId, state.filters, dispatch]);

  const dataset = state.datasets.find(d => d.id === widget.datasetId);
  const raw = dataset?.data ?? [];

  // Apply filters (viewer mode) then measure pipeline
  let data = isEditing ? raw : applyFilters(raw, state.filters);
  if (widget.measures?.length > 0) {
    try { data = executeMeasurePipeline(data, widget.measures); } catch { /* fallback to unprocessed */ }
  }

  const Chart = CHART_MAP[widget.type] || BarChart;
  const closeMaximize = useCallback(() => setMaximized(false), []);

  // Resolve color scheme: widget override → theme default → fallback
  const effectiveWidget = {
    ...widget,
    colorScheme: widget.colorScheme ?? theme.colorScheme ?? 'vivid',
    dimensionColors: state.dashboard.dimensionColors || {},
  };

  const crossFilter = isEditing ? undefined : onCrossFilter;
  const chartBody = dataset
    ? <Chart widget={effectiveWidget} data={data} onCrossFilter={crossFilter} />
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
        className={`widget-card ${isSelected ? 'widget-card--selected' : ''} ${dropHover ? 'widget-card--drop-hover' : ''}`}
        style={{
          backgroundColor: cardBg,
          borderRadius: cardRadius,
          boxShadow: isSelected ? undefined : cardShadow,
        }}
        onClick={isEditing ? onSelect : undefined}
        onDragOver={isEditing && onTypeReplace ? (e) => {
          if (e.dataTransfer.types.includes('application/widget-type')) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            if (!dropHover) setDropHover(true);
          }
        } : undefined}
        onDragLeave={isEditing && onTypeReplace ? (e) => {
          // Only clear if we're leaving the card itself, not entering a child
          if (!e.currentTarget.contains(e.relatedTarget)) setDropHover(false);
        } : undefined}
        onDrop={isEditing && onTypeReplace ? (e) => {
          const newType = e.dataTransfer.getData('application/widget-type');
          const newLabel = e.dataTransfer.getData('application/widget-label');
          setDropHover(false);
          if (newType && canReplaceType(widget.type, newType, widget)) {
            e.preventDefault();
            e.stopPropagation();
            onTypeReplace(newType, newLabel || newType);
          }
        } : undefined}
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
