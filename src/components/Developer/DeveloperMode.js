import { useApp } from '../../context/AppContext';
import DataIntegration from './DataIntegration';
import DashboardBuilder from './DashboardBuilder';

export default function DeveloperMode() {
  const { state, dispatch } = useApp();

  return (
    <div className="dev-mode">
      <div className="dev-tabs">
        <button
          className={`dev-tab ${state.developerTab === 'data' ? 'dev-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_DEVELOPER_TAB', payload: 'data' })}
        >
          🗄 Data Integration
          {state.datasets.length > 0 && (
            <span className="badge badge-blue" style={{ marginLeft: 4 }}>
              {state.datasets.length}
            </span>
          )}
        </button>
        <button
          className={`dev-tab ${state.developerTab === 'dashboard' ? 'dev-tab--active' : ''}`}
          onClick={() => dispatch({ type: 'SET_DEVELOPER_TAB', payload: 'dashboard' })}
        >
          📊 Dashboard
          {state.dashboard.pages.reduce((n, p) => n + p.widgets.length, 0) > 0 && (
            <span className="badge badge-purple" style={{ marginLeft: 4 }}>
              {state.dashboard.pages.reduce((n, p) => n + p.widgets.length, 0)}
            </span>
          )}
        </button>
      </div>

      <div className="dev-content">
        {state.developerTab === 'data'
          ? <DataIntegration />
          : <DashboardBuilder />
        }
      </div>
    </div>
  );
}
