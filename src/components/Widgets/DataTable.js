import { useState } from 'react';
import { getColumnInfo } from '../../utils/dataUtils';

export default function DataTable({ widget, data }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ field: null, dir: 'asc' });
  const PAGE_SIZE = 20;

  if (!data?.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#94a3b8', fontSize: 12,
      }}>
        No data
      </div>
    );
  }

  const cols = getColumnInfo(data);
  let rows = [...data];

  if (sort.field) {
    rows.sort((a, b) => {
      const va = a[sort.field], vb = b[sort.field];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number')
        return sort.dir === 'asc' ? va - vb : vb - va;
      return sort.dir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (field) => {
    setSort(s => s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' });
    setPage(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.name} style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(c.name)}>
                  {c.name}
                  {sort.field === c.name && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                  <span className="col-type">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i}>
                {cols.map(c => (
                  <td key={c.name} title={String(row[c.name] ?? '')}>
                    {row[c.name] === null || row[c.name] === undefined
                      ? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>null</span>
                      : String(row[c.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', borderTop: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-muted)', flexShrink: 0,
        }}>
          <span>{rows.length.toLocaleString()} rows</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={page === 0} onClick={() => setPage(0)}>«</button>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
            <span>Page {page + 1} / {totalPages}</span>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
            <button className="btn btn-ghost btn-sm btn-icon" disabled={page === totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
          </div>
        </div>
      )}
    </div>
  );
}
