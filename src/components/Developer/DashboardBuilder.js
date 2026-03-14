import { ResponsiveGridLayout } from 'react-grid-layout';
import { useApp } from '../../context/AppContext';
import WidgetContainer from '../Widgets/WidgetContainer';
import WidgetEditor from './WidgetEditor';

const ResponsiveGrid = ResponsiveGridLayout;

const WIDGET_TYPES = [
  { type: 'bar',       label: 'Bar Chart',   icon: '📊' },
  { type: 'line',      label: 'Line Chart',  icon: '📈' },
  { type: 'scatter',   label: 'Scatter',     icon: '⬤' },
  { type: 'pie',       label: 'Pie / Donut', icon: '🥧' },
  { type: 'histogram', label: 'Histogram',   icon: '▬' },
  { type: 'table',     label: 'Data Table',  icon: '🔢' },
];

export default function DashboardBuilder() {
  const { state, dispatch } = useApp();
  const { dashboard, editingWidgetId } = state;

  const layouts = { lg: dashboard.layout };

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

                {dashboard.widgets.length > 0 && (
                  <>
                    <hr className="divider" />
                    <div className="section-title">Widgets</div>
                    {dashboard.widgets.map(w => (
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

      {/* ── Canvas ── */}
      <div className="db-canvas">
        {dashboard.widgets.length === 0 ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="empty-state-icon">🎨</div>
            <h3>Empty dashboard</h3>
            <p>Add a chart from the left sidebar to start building your dashboard.</p>
          </div>
        ) : (
          <ResponsiveGrid
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={{ lg: 12, md: 10, sm: 6 }}
            rowHeight={80}
            draggableHandle=".widget-header"
            onLayoutChange={onLayoutChange}
            margin={[12, 12]}
          >
            {dashboard.widgets.map(widget => (
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
    </div>
  );
}
