import { useState, useCallback, useMemo } from 'react';

export default function ClusteringPanel({ datasets, activeDataset, dispatch }) {
  const [algorithm, setAlgorithm] = useState('kmeans');
  const [selectedFields, setSelectedFields] = useState([]);
  const [k, setK] = useState(3);
  const [autoK, setAutoK] = useState(false);
  const [epsilon, setEpsilon] = useState(0.5);
  const [minPoints, setMinPoints] = useState(5);
  const [autoEpsilon, setAutoEpsilon] = useState(true);
  const [columnName, setColumnName] = useState('_cluster');
  const [stats, setStats] = useState(null);
  const [running, setRunning] = useState(false);

  const numericCols = activeDataset
    ? Object.entries(activeDataset.columnTypes || {})
        .filter(([, t]) => t === 'number')
        .map(([name]) => name)
    : [];

  // Detect existing cluster columns (values match "Cluster N" or "Noise" pattern)
  const clusterColumns = useMemo(() => {
    if (!activeDataset?.data?.length) return [];
    const cols = Object.keys(activeDataset.columnTypes || {});
    return cols.filter(col => {
      if (activeDataset.columnTypes[col] === 'number') return false;
      const sample = activeDataset.data.slice(0, 20);
      return sample.every(row => {
        const v = String(row[col] ?? '');
        return !v || /^Cluster \d+$/.test(v) || v === 'Noise';
      });
    });
  }, [activeDataset]);

  const toggleField = useCallback((field) => {
    setSelectedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  }, []);

  const handleRun = useCallback(() => {
    if (!activeDataset || selectedFields.length === 0) return;
    setRunning(true);
    setStats(null);

    // Use setTimeout to allow UI to show "running" state
    setTimeout(() => {
      dispatch({
        type: 'RUN_CLUSTERING',
        payload: {
          datasetId: activeDataset.id,
          fields: selectedFields,
          config: {
            algorithm,
            k: autoK ? undefined : k,
            autoK,
            epsilon: autoEpsilon ? undefined : epsilon,
            autoEpsilon,
            minPoints,
            columnName,
          },
        },
        onComplete: (result) => {
          setStats(result);
          setRunning(false);
        },
      });
    }, 10);
  }, [activeDataset, selectedFields, algorithm, k, autoK, epsilon, autoEpsilon, minPoints, columnName, dispatch]);

  if (!activeDataset) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon">🧠</div>
        <h3>No dataset selected</h3>
        <p>Select a dataset to run clustering analysis.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 600 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
        Clustering Analysis
      </h3>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 16px' }}>
        Group rows into clusters based on numeric fields. Results are saved as a new column that can be used as <strong>Color Field</strong> in any chart.
      </p>

      {/* Existing cluster columns */}
      {clusterColumns.length > 0 && (
        <div style={{ marginBottom: 16, padding: 10, background: 'var(--bg-secondary, #f5f7fa)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Existing cluster columns</div>
          {clusterColumns.map(col => {
            const uniqueVals = [...new Set(activeDataset.data.map(r => String(r[col] ?? '')).filter(Boolean))];
            const clusterCount = uniqueVals.filter(v => v !== 'Noise').length;
            const hasNoise = uniqueVals.includes('Noise');
            return (
              <div key={col} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                <span>
                  <strong>{col}</strong>
                  <span className="text-muted" style={{ marginLeft: 6 }}>
                    {clusterCount} cluster{clusterCount !== 1 ? 's' : ''}{hasNoise ? ' + noise' : ''}
                  </span>
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--danger, #e74c3c)', fontSize: 11, padding: '2px 8px' }}
                  onClick={() => dispatch({ type: 'REMOVE_COLUMN', payload: { datasetId: activeDataset.id, column: col } })}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Algorithm */}
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Algorithm</label>
        <select className="select select-sm" value={algorithm} onChange={e => setAlgorithm(e.target.value)}>
          <option value="kmeans">K-Means</option>
          <option value="dbscan">DBSCAN</option>
        </select>
      </div>

      {/* Fields */}
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Features (numeric fields)</label>
        <div style={{ maxHeight: 140, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
          {numericCols.length === 0 ? (
            <span className="text-muted" style={{ fontSize: 12 }}>No numeric columns available</span>
          ) : numericCols.map(col => (
            <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedFields.includes(col)}
                onChange={() => toggleField(col)}
              />
              {col}
            </label>
          ))}
        </div>
        {selectedFields.length > 0 && (
          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
            {selectedFields.length} field{selectedFields.length > 1 ? 's' : ''} selected
          </div>
        )}
      </div>

      {/* K-Means options */}
      {algorithm === 'kmeans' && (
        <>
          <label className="checkbox-row" style={{ fontSize: 12, marginBottom: 6 }}>
            <input type="checkbox" checked={autoK} onChange={e => setAutoK(e.target.checked)} />
            Auto-detect k (elbow method)
          </label>
          {!autoK && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Number of clusters (k)</label>
              <input
                type="number" className="input input-sm" min={2} max={20}
                value={k} onChange={e => setK(Math.max(2, parseInt(e.target.value) || 2))}
                style={{ width: 80 }}
              />
            </div>
          )}
        </>
      )}

      {/* DBSCAN options */}
      {algorithm === 'dbscan' && (
        <>
          <label className="checkbox-row" style={{ fontSize: 12, marginBottom: 6 }}>
            <input type="checkbox" checked={autoEpsilon} onChange={e => setAutoEpsilon(e.target.checked)} />
            Auto-detect epsilon (recommended)
          </label>
          {!autoEpsilon && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Epsilon (neighborhood radius)</label>
              <input
                type="number" className="input input-sm" min={0.01} step={0.1}
                value={epsilon} onChange={e => setEpsilon(parseFloat(e.target.value) || 0.5)}
                style={{ width: 100 }}
              />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Min points — {minPoints}</label>
            <input
              type="range" min={2} max={Math.max(10, Math.min(50, Math.floor((activeDataset?.data?.length || 100) / 10)))}
              value={minPoints} onChange={e => setMinPoints(parseInt(e.target.value))}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Lower values find more clusters. Try reducing if getting only 1 cluster.
            </div>
          </div>
        </>
      )}

      {/* Column name */}
      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label">Output column name</label>
        <input
          type="text" className="input input-sm"
          value={columnName} onChange={e => setColumnName(e.target.value || '_cluster')}
          style={{ width: 160 }}
        />
      </div>

      {/* Run button */}
      <button
        className="btn btn-primary"
        style={{ fontSize: 13, padding: '6px 20px' }}
        disabled={running || selectedFields.length === 0}
        onClick={handleRun}
      >
        {running ? 'Running...' : 'Run Clustering'}
      </button>

      {/* Results */}
      {stats && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-secondary, #f5f7fa)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Results</div>
          {stats.error ? (
            <div style={{ color: 'var(--danger, #e74c3c)' }}>{stats.error}</div>
          ) : (
            <>
              <div><strong>Algorithm:</strong> {stats.algorithm}</div>
              <div><strong>Clusters found:</strong> {stats.nClusters}</div>
              {stats.noiseCount != null && (
                <div><strong>Noise points:</strong> {stats.noiseCount}</div>
              )}
              {stats.iterations != null && (
                <div><strong>Iterations:</strong> {stats.iterations}</div>
              )}
              {stats.epsilon != null && (
                <div><strong>Epsilon used:</strong> {stats.epsilon.toFixed(4)}</div>
              )}
              {stats.nClusters <= 1 && stats.algorithm === 'DBSCAN' && (
                <div style={{ marginTop: 6, padding: 6, background: 'var(--warning-bg, #fff8e1)', borderRadius: 4, color: 'var(--warning-text, #856404)' }}>
                  Only {stats.nClusters} cluster found. Try reducing <strong>Min points</strong> or
                  switching to manual epsilon with a smaller value (e.g. {((stats.epsilon || 0.5) * 0.5).toFixed(3)}).
                </div>
              )}
              <div style={{ marginTop: 8, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Column <strong>{columnName}</strong> has been added to your dataset.
                Use it as <strong>Color Field</strong> in any chart to visualize clusters.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
