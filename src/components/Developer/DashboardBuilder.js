import { useRef, useEffect, useState, useCallback, forwardRef } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { useApp, GRID_COLS, canReplaceType, mapFieldsForTypeChange } from '../../context/AppContext';
import WidgetContainer from '../Widgets/WidgetContainer';
import WidgetEditor from './WidgetEditor';
import { ALL_SCHEMES, getSwatchColors } from '../../utils/colorUtils';

const ResponsiveGrid = WidthProvider(Responsive);

const WIDGET_TYPES = [
  { type: 'bar',       label: 'Bar Chart',    icon: '📊' },
  { type: 'line',      label: 'Line Chart',   icon: '📈' },
  { type: 'scatter',   label: 'Scatter',      icon: '⬤' },
  { type: 'pie',       label: 'Pie / Donut',  icon: '🥧' },
  { type: 'histogram', label: 'Histogram',    icon: '▬' },
  { type: 'table',     label: 'Data Table',   icon: '🔢' },
  { type: 'treemap',   label: 'Treemap',      icon: '⬛' },
  { type: 'heatmap',   label: 'Heat Map',     icon: '🌡' },
  { type: 'bump',      label: 'Bump Chart',   icon: '🏅' },
  { type: 'stream',    label: 'Stream Graph', icon: '〰' },
  { type: 'violin',    label: 'Violin Plot',  icon: '🎻' },
  { type: 'boxplot',   label: 'Box Plot',     icon: '📦' },
  { type: 'radar',     label: 'Radar Chart',  icon: '🕸' },
  { type: 'waffle',    label: 'Waffle Chart', icon: '🧇' },
  { type: 'sankey',    label: 'Sankey',       icon: '🔀' },
  { type: 'geo',       label: 'Geo Map',      icon: '🌍' },
  { type: 'carousel',  label: 'Carousel',     icon: '🎠' },
  { type: 'pivot',     label: 'Pivot Table',  icon: '⊞' },
];

// Custom resize handles with inline styles — bypasses library CSS specificity issues
const HANDLE_STYLES = {
  n:  { position: 'absolute', top: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize', zIndex: 20 },
  ne: { position: 'absolute', top: 0, right: 0, width: 16, height: 16, cursor: 'ne-resize', zIndex: 20 },
  e:  { position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'ew-resize', zIndex: 20 },
  se: { position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', zIndex: 20 },
  s:  { position: 'absolute', left: 0, right: 0, bottom: 0, height: 8, cursor: 'ns-resize', zIndex: 20 },
  sw: { position: 'absolute', bottom: 0, left: 0, width: 16, height: 16, cursor: 'nesw-resize', zIndex: 20 },
  w:  { position: 'absolute', top: 0, left: 0, bottom: 0, width: 8, cursor: 'ew-resize', zIndex: 20 },
  nw: { position: 'absolute', top: 0, left: 0, width: 16, height: 16, cursor: 'nwse-resize', zIndex: 20 },
};

const ResizeHandle = forwardRef(({ axis, ...rest }, ref) => (
  <div ref={ref} className={`rh rh-${axis}`} style={HANDLE_STYLES[axis] || {}} {...rest} />
));

export default function DashboardBuilder() {
  const { state, dispatch } = useApp();
  const { dashboard, editingWidgetId } = state;
  const theme = dashboard.theme || {};

  // 24×12 grid: compute rowHeight so 12 rows fit the visible canvas height
  const canvasRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(30);
  const cols = GRID_COLS;
  const rows = 12;
  const margin = 8;

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      // rowHeight so that exactly `rows` rows fit: h = rows * rowHeight + (rows + 1) * margin
      const rh = (h - margin * (rows + 1)) / rows;
      setRowHeight(Math.max(10, Math.round(rh)));
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const currentPage = dashboard.pages.find(p => p.id === dashboard.currentPageId) || dashboard.pages[0];
  const layouts = { lg: currentPage.layout };

  // ── Widget drag-to-page state ──
  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const [dropTargetPageId, setDropTargetPageId] = useState(null);

  const [editingPageName, setEditingPageName] = useState(null); // page id being renamed
  const [stylesOpen, setStylesOpen] = useState(false);

  const onLayoutChange = (_layout, allLayouts) => {
    dispatch({ type: 'UPDATE_LAYOUT', payload: allLayouts.lg || _layout });
  };

  const handleTypeReplace = useCallback((widgetId, newType, newLabel) => {
    const page = dashboard.pages.find(p => p.id === dashboard.currentPageId) || dashboard.pages[0];
    const widget = page?.widgets.find(w => w.id === widgetId);
    if (!widget) return;
    if (!canReplaceType(widget.type, newType, widget)) return;
    const oldLabel = WIDGET_TYPES.find(t => t.type === widget.type)?.label || widget.type;
    if (window.confirm(`Change "${widget.title}" from ${oldLabel} to ${newLabel}?\nData fields will be preserved.`)) {
      const fieldUpdates = mapFieldsForTypeChange(widget.type, newType, widget);
      dispatch({ type: 'UPDATE_WIDGET', payload: { id: widgetId, updates: fieldUpdates } });
    }
  }, [dashboard, dispatch]);

  // Compute grid background style
  const gridBgStyle = (() => {
    const period = rowHeight + margin;
    const offset = 16 + margin;
    return {
      backgroundImage: [
        'linear-gradient(rgba(255,255,255,.55) 1px, transparent 1px)',
        'linear-gradient(90deg, rgba(255,255,255,.55) 1px, transparent 1px)',
      ].join(', '),
      backgroundSize: `${period}px ${period}px`,
      backgroundPosition: `${offset}px ${offset}px`,
      background: theme.canvasColor || '#f0f4f8',
    };
  })();

  return (
    <div className="db-layout">
      {/* ── Left sidebar ── */}
      <div className="db-sidebar">
        {editingWidgetId
          ? <WidgetEditor widgetId={editingWidgetId} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="db-sidebar-header">
                <span style={{ fontWeight: 600, fontSize: 13 }}>Dashboard</span>
              </div>
              <div className="db-sidebar-body">
                {/* ── Dashboard Styles Section ── */}
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', marginBottom: stylesOpen ? 10 : 0,
                    }}
                    onClick={() => setStylesOpen(o => !o)}
                  >
                    <div className="section-title" style={{ marginBottom: 0 }}>Dashboard Styles</div>
                    <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{stylesOpen ? '▲' : '▼'}</span>
                  </div>

                  {stylesOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Font size — {theme.fontSize || 13}px</label>
                        <input
                          type="range" min={10} max={18} step={1}
                          value={theme.fontSize || 13}
                          onChange={e => dispatch({ type: 'SET_THEME', payload: { fontSize: parseInt(e.target.value) } })}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Canvas background</label>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="color"
                            value={theme.canvasColor || '#f0f4f8'}
                            onChange={e => dispatch({ type: 'SET_THEME', payload: { canvasColor: e.target.value } })}
                            style={{ width: 32, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: 2 }}
                          />
                          <input
                            className="input input-sm"
                            value={theme.canvasColor || '#f0f4f8'}
                            onChange={e => dispatch({ type: 'SET_THEME', payload: { canvasColor: e.target.value } })}
                            style={{ flex: 1 }}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Default card color</label>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="color"
                            value={theme.cardColor || '#ffffff'}
                            onChange={e => dispatch({ type: 'SET_THEME', payload: { cardColor: e.target.value } })}
                            style={{ width: 32, height: 28, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', padding: 2 }}
                          />
                          <input
                            className="input input-sm"
                            value={theme.cardColor || '#ffffff'}
                            onChange={e => dispatch({ type: 'SET_THEME', payload: { cardColor: e.target.value } })}
                            style={{ flex: 1 }}
                          />
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Border radius — {theme.cardRadius ?? 8}px</label>
                        <input
                          type="range" min={0} max={20} step={1}
                          value={theme.cardRadius ?? 8}
                          onChange={e => dispatch({ type: 'SET_THEME', payload: { cardRadius: parseInt(e.target.value) } })}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Card shadow</label>
                        <select
                          className="select select-sm"
                          value={theme.cardShadow || 'md'}
                          onChange={e => dispatch({ type: 'SET_THEME', payload: { cardShadow: e.target.value } })}
                        >
                          <option value="none">None</option>
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Color scheme</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {Object.keys(ALL_SCHEMES).map(key => (
                            <div
                              key={key}
                              className={`color-scheme-option ${(theme.colorScheme || 'vivid') === key ? 'color-scheme-option--active' : ''}`}
                              onClick={() => dispatch({ type: 'SET_THEME', payload: { colorScheme: key } })}
                            >
                              <div className="color-swatches">
                                {getSwatchColors(key).slice(0, 8).map((c, i) => (
                                  <div key={i} className="color-swatch" style={{ background: c }} />
                                ))}
                              </div>
                              <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{key}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <hr className="divider" />

                <div className="section-title">Chart types</div>
                <div className="widget-type-grid">
                  {WIDGET_TYPES.map(wt => (
                    <button
                      key={wt.type}
                      className="widget-type-btn"
                      draggable
                      onDragStart={e => {
                        e.dataTransfer.setData('application/widget-type', wt.type);
                        e.dataTransfer.setData('application/widget-label', wt.label);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => dispatch({ type: 'ADD_WIDGET', payload: { type: wt.type, title: wt.label } })}
                    >
                      <span className="widget-type-btn-icon">{wt.icon}</span>
                      {wt.label}
                    </button>
                  ))}
                </div>

                {currentPage.widgets.length > 0 && (
                  <>
                    <hr className="divider" />
                    <div className="section-title">Widgets on this page</div>
                    {currentPage.widgets.map(w => (
                      <div
                        key={w.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 8px', borderRadius: 'var(--radius)',
                          cursor: 'pointer',
                          background: editingWidgetId === w.id ? '#eff6ff' : 'transparent',
                          border: `1px solid ${editingWidgetId === w.id ? '#bfdbfe' : 'transparent'}`,
                        }}
                        onClick={() => dispatch({ type: 'SET_EDITING_WIDGET', payload: w.id })}
                      >
                        <span>{WIDGET_TYPES.find(t => t.type === w.type)?.icon || '📊'}</span>
                        <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {w.title}
                        </span>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={e => { e.stopPropagation(); dispatch({ type: 'REMOVE_WIDGET', payload: w.id }); }}
                        >✕</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )
        }
      </div>

      {/* ── Canvas + page tabs ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="db-canvas" ref={canvasRef} style={gridBgStyle}>
          {currentPage.widgets.length === 0 ? (
            <div className="empty-state" style={{ height: '100%' }}>
              <div className="empty-state-icon">🎨</div>
              <h3>Empty page</h3>
              <p>Add a chart from the left sidebar to start building.</p>
            </div>
          ) : (
            <ResponsiveGrid
              className="layout"
              layouts={layouts}
              breakpoints={{ lg: 1200, md: 996, sm: 768 }}
              cols={{ lg: cols, md: 16, sm: 8 }}
              rowHeight={rowHeight}
              draggableHandle=".widget-header"
              resizeHandles={['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']}
              resizeHandle={(axis, ref) => <ResizeHandle axis={axis} ref={ref} />}
              onLayoutChange={onLayoutChange}
              margin={[margin, margin]}
              compactType={null}
              preventCollision={true}
            >
              {currentPage.widgets.map(widget => (
                <div key={widget.id} style={{ height: '100%' }}>
                  <WidgetContainer
                    widget={widget}
                    isEditing={true}
                    isSelected={editingWidgetId === widget.id}
                    onSelect={() => dispatch({ type: 'SET_EDITING_WIDGET', payload: widget.id })}
                    onRemove={() => dispatch({ type: 'REMOVE_WIDGET', payload: widget.id })}
                    onDuplicate={() => dispatch({ type: 'DUPLICATE_WIDGET', payload: widget.id })}
                    onDragToPage={dashboard.pages.length > 1 ? setDraggingWidgetId : undefined}
                    onTypeReplace={(newType, newLabel) => handleTypeReplace(widget.id, newType, newLabel)}
                  />
                </div>
              ))}
            </ResponsiveGrid>
          )}
        </div>

        {/* ── Page tabs ── */}
        <div className="page-tabs">
          {dashboard.pages.map(page => (
            <div
              key={page.id}
              className={`page-tab ${page.id === dashboard.currentPageId ? 'page-tab--active' : ''} ${dropTargetPageId === page.id ? 'page-tab--drop-target' : ''}`}
              onClick={() => dispatch({ type: 'SET_CURRENT_PAGE', payload: page.id })}
              onDoubleClick={() => setEditingPageName(page.id)}
              onDragOver={e => {
                if (!draggingWidgetId || page.id === dashboard.currentPageId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = e.shiftKey ? 'copy' : 'move';
                setDropTargetPageId(page.id);
              }}
              onDragLeave={() => setDropTargetPageId(null)}
              onDrop={e => {
                e.preventDefault();
                const widgetId = e.dataTransfer.getData('application/widget-id') || draggingWidgetId;
                if (widgetId && page.id !== dashboard.currentPageId) {
                  dispatch({
                    type: 'MOVE_WIDGET_TO_PAGE',
                    payload: { widgetId, targetPageId: page.id, copy: e.shiftKey },
                  });
                }
                setDraggingWidgetId(null);
                setDropTargetPageId(null);
              }}
            >
              {editingPageName === page.id ? (
                <input
                  className="page-tab-input"
                  autoFocus
                  defaultValue={page.name}
                  onBlur={e => {
                    dispatch({ type: 'RENAME_PAGE', payload: { id: page.id, name: e.target.value || page.name } });
                    setEditingPageName(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.target.blur();
                    if (e.key === 'Escape') setEditingPageName(null);
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span>{page.name}</span>
              )}
              {dashboard.pages.length > 1 && (
                <button
                  className="page-tab-close"
                  onClick={e => { e.stopPropagation(); dispatch({ type: 'REMOVE_PAGE', payload: page.id }); }}
                >×</button>
              )}
            </div>
          ))}
          <button
            className="page-tab-add"
            onClick={() => dispatch({ type: 'ADD_PAGE' })}
            title="Add page"
          >+</button>
        </div>
      </div>
    </div>
  );
}
