import { useState, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useApp, canReplaceType } from '../../context/AppContext';
import { executeMeasurePipeline } from '../../utils/dataUtils';
import { resolveWidgetData } from '../../utils/associativeEngine';
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
import TextContent from './TextContent';
import ImageWidget from './ImageWidget';
import EmbedWidget from './EmbedWidget';

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
  text: TextContent, image: ImageWidget, embed: EmbedWidget,
};

const TYPE_ICONS = {
  bar: '📊', line: '📈', scatter: '⬤', pie: '🥧', histogram: '▬', table: '🔢',
  treemap: '⬛', heatmap: '🌡', bump: '🏅', stream: '〰', violin: '🎻',
  carousel: '🎠',
  boxplot: '📦', radar: '🕸', waffle: '🧇', sankey: '🔀', geo: '🌍',
  pivot: '⊞',
  waterfall: '📉', wordcloud: '☁', funnel: '🔻', kpi: '🎯',
  bubble: '🫧', combo: '📊📈', straighttable: '▦', mekko: '▥',
  text: '📝', image: '🖼', embed: '🔗',
};

export { TYPE_ICONS };

// ── Dimension Controls (drill breadcrumb + cycle arrows) ────────────────────

function DimensionControls({ boundHierarchies, boundCyclics, dispatch }) {
  if (!boundHierarchies.length && !boundCyclics.length) return null;

  const controlStyle = {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, color: 'var(--text-muted)', flexShrink: 0,
  };
  const btnStyle = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '0 2px', fontSize: 13, color: 'var(--accent)',
    lineHeight: 1, display: 'flex', alignItems: 'center',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 4 }}>
      {/* Hierarchic: drill breadcrumb */}
      {boundHierarchies.map(({ dim: hd }) => {
        const currentField = hd.levels[hd.currentLevel || 0] || hd.levels[0];
        const isAtTop = (hd.currentLevel || 0) === 0;
        const isAtBottom = (hd.currentLevel || 0) >= hd.levels.length - 1;
        const filters = hd.filters || [];
        return (
          <div key={hd.id} style={controlStyle}>
            {!isAtTop && (
              <button style={btnStyle} title="Drill up" onClick={e => {
                e.stopPropagation();
                dispatch({ type: 'DRILL_UP', payload: hd.id });
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2L2 8h8z" fill="currentColor"/></svg>
              </button>
            )}
            {filters.map((f, i) => (
              <span key={i} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                onClick={e => {
                  e.stopPropagation();
                  dispatch({ type: 'DRILL_TO_LEVEL', payload: { id: hd.id, level: i } });
                }}
                title={`Go back to ${hd.levels[i]}`}
              >
                {f.value}
                <span style={{ margin: '0 2px', opacity: 0.5 }}>/</span>
              </span>
            ))}
            <span style={{ fontWeight: 600 }}>{currentField}</span>
            {!isAtBottom && (
              <svg width="12" height="12" viewBox="0 0 12 12" style={{ opacity: 0.4, flexShrink: 0 }}>
                <path d="M6 10L2 4h8z" fill="currentColor"/>
              </svg>
            )}
          </div>
        );
      })}

      {/* Cyclic: single cycle button */}
      {boundCyclics.map(({ dim: cd }) => {
        const idx = cd.activeIndex || 0;
        const currentField = cd.fields[idx] || cd.fields[0];
        return (
          <div key={cd.id} style={controlStyle}>
            <button style={btnStyle} title="Cycle dimension"
              onClick={e => { e.stopPropagation(); dispatch({ type: 'CYCLE_DIMENSION', payload: { id: cd.id, direction: 1 } }); }}>
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M7 1a6 6 0 104.24 1.76" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 1v3h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentField}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function WidgetContainer({ widget, isEditing, isSelected, onSelect, onRemove, onDuplicate, onDragToPage, onTypeReplace }) {
  const { state, dispatch, associativeState } = useApp();
  const [maximized, setMaximized] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const theme = state.dashboard.theme || {};

  // ── Resolve dimension references from widget field values ───────────────
  const dashHierarchies = useMemo(() => state.dashboard.hierarchicDimensions || [], [state.dashboard.hierarchicDimensions]);
  const dashCyclics = useMemo(() => state.dashboard.cyclicDimensions || [], [state.dashboard.cyclicDimensions]);

  // Scan widget fields for __hier__<id> or __cyclic__<id> references
  const FIELD_KEYS = ['xField', 'yField', 'colorField', 'groupField', 'labelField',
    'axisField', 'sourceField', 'targetField', 'geoField'];

  const boundHierarchies = useMemo(() => {
    const results = [];
    for (const key of FIELD_KEYS) {
      const val = widget[key];
      if (val && typeof val === 'string' && val.startsWith('__hier__')) {
        const id = val.slice('__hier__'.length);
        const dim = dashHierarchies.find(h => h.id === id);
        if (dim) results.push({ dim, targetField: key });
      }
    }
    return results;
  }, [dashHierarchies, widget]); // eslint-disable-line react-hooks/exhaustive-deps

  const boundCyclics = useMemo(() => {
    const results = [];
    for (const key of FIELD_KEYS) {
      const val = widget[key];
      if (val && typeof val === 'string' && val.startsWith('__cyclic__')) {
        const id = val.slice('__cyclic__'.length);
        const dim = dashCyclics.find(c => c.id === id);
        if (dim) results.push({ dim, targetField: key });
      }
    }
    return results;
  }, [dashCyclics, widget]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cross-filter with drill-down interception ───────────────────────────
  const onCrossFilter = useCallback(({ field, value }) => {
    if (isEditing || !field) return;

    // Check if this field is the active level of a bound hierarchy → drill down
    for (const { dim: hd } of boundHierarchies) {
      const activeField = hd.levels[hd.currentLevel || 0];
      if (activeField === field && (hd.currentLevel || 0) < hd.levels.length - 1) {
        dispatch({ type: 'DRILL_DOWN', payload: { id: hd.id, field, value: String(value) } });
        return;
      }
    }

    // Associative cross-filter: toggle selection on field
    dispatch({ type: 'TOGGLE_SELECTION', payload: { field, value: String(value) } });
  }, [isEditing, boundHierarchies, dispatch]);

  // ── Resolve effective widget (field overrides + color scheme) ───────────
  const effectiveWidget = useMemo(() => {
    const ew = {
      ...widget,
      colorScheme: widget.colorScheme ?? theme.colorScheme ?? 'vivid',
      dimensionColors: state.dashboard.dimensionColors || {},
    };

    // Hierarchic: override target field with current level
    for (const { dim: hd, targetField } of boundHierarchies) {
      const activeField = hd.levels[hd.currentLevel || 0] || hd.levels[0];
      if (targetField && activeField) ew[targetField] = activeField;
    }

    // Cyclic: override target field with current selection
    for (const { dim: cd, targetField } of boundCyclics) {
      const activeField = cd.fields[cd.activeIndex || 0] || cd.fields[0];
      if (targetField && activeField) ew[targetField] = activeField;
    }

    return ew;
  }, [widget, theme.colorScheme, state.dashboard.dimensionColors, boundHierarchies, boundCyclics]);

  // ── Data pipeline (associative) ─────────────────────────────────────────
  const resolvedData = useMemo(() => {
    const resolved = resolveWidgetData(
      effectiveWidget, state.datasets, state.colStore,
      isEditing ? null : associativeState
    );
    if (widget.measures?.length > 0) {
      try { return executeMeasurePipeline(resolved, widget.measures); } catch { return resolved; }
    }
    return resolved;
  }, [effectiveWidget, state.datasets, state.colStore, associativeState, isEditing, widget.measures]);

  // Apply drill filters from bound hierarchies
  const drillFilters = useMemo(() => {
    const filters = [];
    for (const { dim: hd } of boundHierarchies) {
      if (hd.filters?.length) filters.push(...hd.filters);
    }
    return filters;
  }, [boundHierarchies]);

  const data = useMemo(() => {
    if (drillFilters.length > 0) {
      return resolvedData.filter(row => drillFilters.every(f => String(row[f.field]) === f.value));
    }
    return resolvedData;
  }, [resolvedData, drillFilters]);

  const Chart = CHART_MAP[widget.type] || BarChart;
  const closeMaximize = useCallback(() => setMaximized(false), []);

  const crossFilter = isEditing ? undefined : onCrossFilter;
  const hasData = data.length > 0 || state.datasets.length > 0;
  const chartBody = hasData
    ? <Chart widget={effectiveWidget} data={data} onCrossFilter={crossFilter} />
    : (
      <div className="empty-state" style={{ height: '100%' }}>
        <div style={{ fontSize: 28, opacity: .3 }}>⚙</div>
        <p>Configure fields to display data</p>
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

  const hasDimControls = boundHierarchies.length > 0 || boundCyclics.length > 0;
  const dimControls = hasDimControls ? (
    <DimensionControls
      boundHierarchies={boundHierarchies}
      boundCyclics={boundCyclics}
      dispatch={dispatch}
    />
  ) : null;

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
          {dimControls}
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
              {dimControls}
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
