import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Inline Table Editor — create a dataset by typing data directly.
 *
 * Spreadsheet-like grid with:
 *  - Editable column headers (click to rename)
 *  - Add/remove columns
 *  - Add/remove rows
 *  - Tab navigation between cells
 *  - Paste support (from Excel/Sheets)
 *
 * Props:
 *   onImport  — (name: string, data: object[]) => void
 *   onClose   — () => void
 */

const DEFAULT_COLS = ['Column A', 'Column B', 'Column C'];
const DEFAULT_ROWS = 5;

export default function InlineTableEditor({ onImport, onClose }) {
  const [tableName, setTableName] = useState('Inline Table');
  const [columns, setColumns] = useState([...DEFAULT_COLS]);
  const [rows, setRows] = useState(() =>
    Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS.length).fill(''))
  );
  const [editingHeader, setEditingHeader] = useState(null);
  const [headerDraft, setHeaderDraft] = useState('');
  const gridRef = useRef(null);
  const headerInputRef = useRef(null);

  // Focus header input when editing
  useEffect(() => {
    if (editingHeader !== null) headerInputRef.current?.select();
  }, [editingHeader]);

  // ── Column ops ──
  const addColumn = () => {
    const name = `Column ${String.fromCharCode(65 + (columns.length % 26))}${columns.length >= 26 ? Math.floor(columns.length / 26) : ''}`;
    setColumns(prev => [...prev, name]);
    setRows(prev => prev.map(row => [...row, '']));
  };

  const removeColumn = (idx) => {
    if (columns.length <= 1) return;
    setColumns(prev => prev.filter((_, i) => i !== idx));
    setRows(prev => prev.map(row => row.filter((_, i) => i !== idx)));
  };

  const commitHeader = (idx) => {
    const trimmed = headerDraft.trim();
    if (trimmed && trimmed !== columns[idx]) {
      setColumns(prev => prev.map((c, i) => i === idx ? trimmed : c));
    }
    setEditingHeader(null);
  };

  // ── Row ops ──
  const addRow = () => {
    setRows(prev => [...prev, Array(columns.length).fill('')]);
  };

  const addRows = (count) => {
    setRows(prev => [...prev, ...Array.from({ length: count }, () => Array(columns.length).fill(''))]);
  };

  const removeRow = (idx) => {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Cell edit ──
  const updateCell = (rowIdx, colIdx, value) => {
    setRows(prev => prev.map((row, ri) =>
      ri === rowIdx ? row.map((cell, ci) => ci === colIdx ? value : cell) : row
    ));
  };

  // ── Paste handler: supports multi-cell paste from spreadsheets ──
  const handlePaste = useCallback((e) => {
    const target = e.target;
    if (!target.dataset.row || !target.dataset.col) return;

    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const pasteRows = text.split(/\r?\n/).filter(line => line.length > 0).map(line => line.split('\t'));
    if (pasteRows.length <= 1 && pasteRows[0]?.length <= 1) return; // single cell, let default handle it

    e.preventDefault();
    const startRow = parseInt(target.dataset.row);
    const startCol = parseInt(target.dataset.col);

    setRows(prev => {
      // Expand rows if needed
      const needed = startRow + pasteRows.length;
      let updated = needed > prev.length
        ? [...prev, ...Array.from({ length: needed - prev.length }, () => Array(columns.length).fill(''))]
        : [...prev];

      for (let r = 0; r < pasteRows.length; r++) {
        const targetRow = startRow + r;
        if (targetRow >= updated.length) break;
        updated[targetRow] = [...updated[targetRow]];
        for (let c = 0; c < pasteRows[r].length; c++) {
          const targetCol = startCol + c;
          if (targetCol >= columns.length) break;
          updated[targetRow][targetCol] = pasteRows[r][c];
        }
      }
      return updated;
    });

    // Expand columns if paste is wider
    const maxPasteCols = Math.max(...pasteRows.map(r => r.length));
    if (startCol + maxPasteCols > columns.length) {
      const extra = startCol + maxPasteCols - columns.length;
      const newCols = Array.from({ length: extra }, (_, i) => {
        const idx = columns.length + i;
        return `Column ${String.fromCharCode(65 + (idx % 26))}${idx >= 26 ? Math.floor(idx / 26) : ''}`;
      });
      setColumns(prev => [...prev, ...newCols]);
      setRows(prev => prev.map(row => [...row, ...Array(extra).fill('')]));
    }
  }, [columns.length]);

  // ── Tab navigation ──
  const handleKeyDown = (e, rowIdx, colIdx) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
      if (nextCol >= 0 && nextCol < columns.length) {
        const next = gridRef.current?.querySelector(`[data-row="${rowIdx}"][data-col="${nextCol}"]`);
        next?.focus();
      } else if (!e.shiftKey && nextCol >= columns.length && rowIdx < rows.length - 1) {
        const next = gridRef.current?.querySelector(`[data-row="${rowIdx + 1}"][data-col="0"]`);
        next?.focus();
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (rowIdx < rows.length - 1) {
        const next = gridRef.current?.querySelector(`[data-row="${rowIdx + 1}"][data-col="${colIdx}"]`);
        next?.focus();
      } else {
        addRow();
        setTimeout(() => {
          const next = gridRef.current?.querySelector(`[data-row="${rowIdx + 1}"][data-col="${colIdx}"]`);
          next?.focus();
        }, 0);
      }
    }
  };

  // ── Import ──
  const handleImport = () => {
    // Filter out completely empty rows
    const nonEmpty = rows.filter(row => row.some(cell => cell.trim() !== ''));
    if (nonEmpty.length === 0) {
      alert('Add at least one row of data');
      return;
    }

    const data = nonEmpty.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        const v = row[i]?.trim() ?? '';
        obj[col] = v !== '' && !isNaN(v) && v !== '' ? Number(v) : v;
      });
      return obj;
    });

    onImport(tableName.trim() || 'Inline Table', data, { type: 'inline' });
    onClose();
  };

  const nonEmptyCount = rows.filter(row => row.some(cell => cell.trim() !== '')).length;

  return (
    <div className="wizard-overlay" onClick={onClose}>
      <div className="wizard-modal inline-table-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="wizard-header">
          <h3>Create Inline Table</h3>
          <button className="btn btn-icon wizard-close" onClick={onClose}>&times;</button>
        </div>

        <div className="wizard-body">
          {/* Table name */}
          <div className="wizard-config-row" style={{ marginBottom: 12 }}>
            <label>Table name</label>
            <input
              type="text"
              className="wizard-input"
              value={tableName}
              onChange={e => setTableName(e.target.value)}
              placeholder="e.g. Categories, Regions..."
            />
          </div>

          {/* Toolbar */}
          <div className="inline-table-toolbar">
            <button className="btn btn-secondary btn-sm" onClick={addColumn}>+ Column</button>
            <button className="btn btn-secondary btn-sm" onClick={addRow}>+ Row</button>
            <button className="btn btn-secondary btn-sm" onClick={() => addRows(5)}>+ 5 Rows</button>
            <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
              {columns.length} col{columns.length !== 1 ? 's' : ''} · {nonEmptyCount} row{nonEmptyCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Grid */}
          <div className="inline-table-grid-wrap" ref={gridRef} onPaste={handlePaste}>
            <table className="inline-table-grid">
              <thead>
                <tr>
                  <th className="inline-table-row-num">#</th>
                  {columns.map((col, ci) => (
                    <th key={ci} className="inline-table-col-header">
                      {editingHeader === ci ? (
                        <input
                          ref={headerInputRef}
                          className="inline-table-header-input"
                          value={headerDraft}
                          onChange={e => setHeaderDraft(e.target.value)}
                          onBlur={() => commitHeader(ci)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitHeader(ci);
                            if (e.key === 'Escape') setEditingHeader(null);
                          }}
                        />
                      ) : (
                        <span
                          className="inline-table-header-label"
                          onClick={() => { setEditingHeader(ci); setHeaderDraft(col); }}
                          title="Click to rename"
                        >
                          {col}
                        </span>
                      )}
                      {columns.length > 1 && (
                        <button
                          className="inline-table-col-remove"
                          onClick={() => removeColumn(ci)}
                          title="Remove column"
                        >&times;</button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    <td className="inline-table-row-num">
                      <span>{ri + 1}</span>
                      {rows.length > 1 && (
                        <button
                          className="inline-table-row-remove"
                          onClick={() => removeRow(ri)}
                          title="Remove row"
                        >&times;</button>
                      )}
                    </td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="inline-table-cell">
                        <input
                          className="inline-table-cell-input"
                          value={cell}
                          onChange={e => updateCell(ri, ci, e.target.value)}
                          onKeyDown={e => handleKeyDown(e, ri, ci)}
                          data-row={ri}
                          data-col={ci}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="inline-table-hint">
            Tip: Paste data from Excel or Google Sheets. Use Tab to navigate, Enter to move down.
          </div>
        </div>

        {/* Footer */}
        <div className="wizard-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            disabled={nonEmptyCount === 0}
            onClick={handleImport}
          >
            Create table ({nonEmptyCount} row{nonEmptyCount !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </div>
  );
}
