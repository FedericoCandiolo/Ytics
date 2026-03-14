import { useRef, useEffect, useState } from 'react';
import { ResponsiveGridLayout } from 'react-grid-layout';
import { useApp } from '../../context/AppContext';
import WidgetContainer from '../Widgets/WidgetContainer';
import WidgetEditor from './WidgetEditor';

const ResponsiveGrid = ResponsiveGridLayout;

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
  { type: 'carousel',  label: 'Carousel',     icon: '🎠' },
];

export default function DashboardBuilder() {
  const { state, dispatch } = useApp();
  const { dashboard, editingWidgetId } = state;

  // Square grid: measure canvas width → compute rowHeight = columnWidth
  const canvasRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(80);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const cols = 12;
      const margin = 12;
      const padding = 32; // 16px each side from .db-canvas
      const colWidth = (w - padding - (cols - 1) * margin) / cols;
      setRowHeight(Math.max(40, Math.round(colWidth)));
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const currentPage = dashboard.pages.find(p => p.id === dashboard.currentPageId) || dashboard.pages[0];
  const layouts = { lg: currentPage.layout };

  const [editingPageName, setEditingPageName] = useState(null); // page id being renamed

  const onLayoutChange = (_layout, allLayouts) => {
    dispatch({ type: 'UPDATE_LAYOUT', payload: allLayouts.lg || _layout });
  };

  return (
    <div className="db-layout">
      {/* ── Left sidebar ── */}
      <div className="db-sidebar">
        {editingWidgetId
          ? <WidgetEditor widgetId={editingWidgetId} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="db-sidebar-header">
                <span style={{ fontWeight: 600, fontSize: 13 }}>Add Chart</span>
              </div>
              <div className="db-sidebar-body">
                <div className="section-title">Chart types</div>
                <div className="widget-type-grid">
                  {WIDGET_TYPES.map(wt => (
                    <button
                      key={wt.type}
                      className="widget-type-btn"
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
        <div className="db-canvas" ref={canvasRef}>
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
              cols={{ lg: 12, md: 10, sm: 6 }}
              rowHeight={rowHeight}
              draggableHandle=".widget-header"
              resizeHandles={['se', 'e', 's']}
              onLayoutChange={onLayoutChange}
              margin={[12, 12]}
            >
              {currentPage.widgets.map(widget => (
                <div key={widget.id}>
                  <WidgetContainer
                    widget={widget}
                    isEditing={true}
                    isSelected={editingWidgetId === widget.id}
                    onSelect={() => dispatch({ type: 'SET_EDITING_WIDGET', payload: widget.id })}
                    onRemove={() => dispatch({ type: 'REMOVE_WIDGET', payload: widget.id })}
                    onDuplicate={() => dispatch({ type: 'DUPLICATE_WIDGET', payload: widget.id })}
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
              className={`page-tab ${page.id === dashboard.currentPageId ? 'page-tab--active' : ''}`}
              onClick={() => dispatch({ type: 'SET_CURRENT_PAGE', payload: page.id })}
              onDoubleClick={() => setEditingPageName(page.id)}
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
