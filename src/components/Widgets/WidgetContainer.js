import { useApp } from '../../context/AppContext';
import { applyFilters } from '../../utils/dataUtils';
import BarChart from './BarChart';
import LineChart from './LineChart';
import ScatterPlot from './ScatterPlot';
import PieChart from './PieChart';
import Histogram from './Histogram';
import DataTable from './DataTable';

const CHART_MAP = { bar: BarChart, line: LineChart, scatter: ScatterPlot, pie: PieChart, histogram: Histogram, table: DataTable };

const TYPE_ICONS = { bar: '📊', line: '📈', scatter: '⬤', pie: '🥧', histogram: '▬', table: '🔢' };

export default function WidgetContainer({ widget, isEditing, isSelected, onSelect, onRemove, onDuplicate }) {
  const { state } = useApp();

  const dataset = state.datasets.find(d => d.id === widget.datasetId);
  const raw = dataset?.data ?? [];
  const data = isEditing ? raw : applyFilters(raw, state.filters);

  const Chart = CHART_MAP[widget.type] || BarChart;

  return (
    <div
      className={`widget-card ${isSelected ? 'widget-card--selected' : ''}`}
      style={{ backgroundColor: widget.backgroundColor || '#fff' }}
      onClick={isEditing ? onSelect : undefined}
    >
      <div className="widget-header">
        <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICONS[widget.type] || '📊'}</span>
        <span className="widget-title">{widget.title || 'Untitled'}</span>

        {isEditing && (
          <div className="widget-actions">
            {onDuplicate && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Duplicate"
                onClick={e => { e.stopPropagation(); onDuplicate(); }}
              >
                ⧉
              </button>
            )}
            {onRemove && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="Remove"
                onClick={e => { e.stopPropagation(); onRemove(); }}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      <div className="widget-body">
        {!dataset && (
          <div className="empty-state" style={{ height: '100%' }}>
            <div style={{ fontSize: 28, opacity: .3 }}>🗄</div>
            <p>No dataset selected</p>
          </div>
        )}
        {dataset && (
          <Chart widget={widget} data={data} />
        )}
      </div>
    </div>
  );
}
