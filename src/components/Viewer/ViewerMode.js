import { ResponsiveGridLayout } from 'react-grid-layout';
import { useApp } from '../../context/AppContext';
import WidgetContainer from '../Widgets/WidgetContainer';
import FilterPanel from './FilterPanel';
import { exportDashboard } from '../../utils/exportUtils';

const ResponsiveGrid = ResponsiveGridLayout;

export default function ViewerMode() {
  const { state, dispatch } = useApp();
  const { dashboard } = state;

  const layouts = { lg: dashboard.layout };
  const activeFilters = Object.values(state.filters);

  return (
    <div className="viewer-layout">
      {/* ── Top bar: filters + export ── */}
      <div className="viewer-topbar">
        <FilterPanel />

        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          {activeFilters.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
              {activeFilters.length} filter{activeFilters.length > 1 ? 's' : ''} active
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}
          >
            ✏️ Edit
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!dashboard.widgets.length}
            onClick={() => exportDashboard(state.datasets, dashboard)}
          >
            ⬇ Export
          </button>
        </div>
      </div>

      {/* ── Dashboard canvas ── */}
      <div className="viewer-canvas">
        {dashboard.widgets.length === 0 ? (
          <div className="empty-state" style={{ height: '60vh' }}>
            <div className="empty-state-icon">👁</div>
            <h3>Nothing to view yet</h3>
            <p>Switch to Developer mode to add charts and build your dashboard.</p>
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}>
              Go to Developer
            </button>
          </div>
        ) : (
          <ResponsiveGrid
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={{ lg: 12, md: 10, sm: 6 }}
            rowHeight={80}
            isDraggable={false}
            isResizable={false}
            margin={[12, 12]}
          >
            {dashboard.widgets.map(widget => (
              <div key={widget.id}>
                <WidgetContainer
                  widget={widget}
                  isEditing={false}
                />
              </div>
            ))}
          </ResponsiveGrid>
        )}
      </div>
    </div>
  );
}
