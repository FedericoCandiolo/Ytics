import { useState, useRef, useEffect } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { useApp } from '../../context/AppContext';
import WidgetContainer from '../Widgets/WidgetContainer';
import FilterPanel from './FilterPanel';
import { exportDashboard } from '../../utils/exportUtils';

const ResponsiveGrid = WidthProvider(Responsive);

export default function ViewerMode() {
  const { state, dispatch } = useApp();
  const { dashboard } = state;
  const theme = dashboard.theme || {};
  const pages = dashboard.pages || [];
  const pageIdx = Math.max(0, pages.findIndex(p => p.id === dashboard.currentPageId));
  const setPageIdx = (valOrFn) => {
    const next = typeof valOrFn === 'function' ? valOrFn(pageIdx) : valOrFn;
    const clamped = Math.max(0, Math.min(next, pages.length - 1));
    if (pages[clamped]) dispatch({ type: 'SET_CURRENT_PAGE', payload: pages[clamped].id });
  };

  // After page change, fire a window resize so WidthProvider + chart ResizeObservers re-measure
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => cancelAnimationFrame(id);
  }, [pageIdx]);

  // 24×12 grid: compute rowHeight so 12 rows fit the visible canvas height
  const canvasRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(30);
  const rows = 12;
  const margin = 8;

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      const rh = (h - margin * (rows + 1)) / rows;
      setRowHeight(Math.max(10, Math.round(rh)));
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const currentPage = pages[Math.min(pageIdx, pages.length - 1)] || pages[0] || { widgets: [], layout: [] };
  const layouts = { lg: currentPage.layout };
  const activeSelections = Object.entries(state.selections || {}).filter(([, v]) => v?.length > 0);
  const totalWidgets = pages.reduce((sum, p) => sum + p.widgets.length, 0);

  return (
    <div className="viewer-layout">
      {/* ── Top bar: filters + export ── */}
      <div className="viewer-topbar">
        <FilterPanel />
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          {activeSelections.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
              {activeSelections.length} selection{activeSelections.length > 1 ? 's' : ''} active
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}
          >✏️ Edit</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={totalWidgets === 0}
            onClick={() => exportDashboard(state.datasets, dashboard)}
          >⬇ Export</button>
        </div>
      </div>

      {/* ── Dashboard canvas ── */}
      <div ref={canvasRef} className="viewer-canvas" style={{ background: theme.canvasColor || '#f0f4f8' }}>
        {totalWidgets === 0 ? (
          <div className="empty-state" style={{ height: '60vh' }}>
            <div className="empty-state-icon">👁</div>
            <h3>Nothing to view yet</h3>
            <p>Switch to Developer mode to add charts and build your dashboard.</p>
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'SET_MODE', payload: 'developer' })}>
              Go to Developer
            </button>
          </div>
        ) : currentPage.widgets.length === 0 ? (
          <div className="empty-state" style={{ height: '60vh' }}>
            <div className="empty-state-icon">📄</div>
            <h3>Empty page</h3>
            <p>This page has no charts yet.</p>
          </div>
        ) : (
          <ResponsiveGrid
            key={currentPage.id}
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={{ lg: 24, md: 16, sm: 8 }}
            rowHeight={rowHeight}
            isDraggable={false}
            isResizable={false}
            margin={[margin, margin]}
          >
            {currentPage.widgets.map(widget => (
              <div key={widget.id}>
                <WidgetContainer widget={widget} isEditing={false} />
              </div>
            ))}
          </ResponsiveGrid>
        )}
      </div>

      {/* ── Page navigation ── */}
      {pages.length > 1 && (
        <div className="viewer-page-nav">
          <button
            className="btn btn-ghost btn-sm"
            disabled={pageIdx === 0}
            onClick={() => setPageIdx(i => i - 1)}
          >◄</button>
          <div className="page-tabs" style={{ flex: 1, justifyContent: 'center', borderTop: 'none', background: 'transparent' }}>
            {pages.map((page, i) => (
              <div
                key={page.id}
                className={`page-tab ${i === pageIdx ? 'page-tab--active' : ''}`}
                onClick={() => setPageIdx(i)}
              >
                <span>{page.name}</span>
              </div>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={pageIdx === pages.length - 1}
            onClick={() => setPageIdx(i => i + 1)}
          >►</button>
        </div>
      )}
    </div>
  );
}
