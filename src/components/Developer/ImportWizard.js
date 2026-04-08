import { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';

/**
 * Import Wizard — multi-step dialog for Excel and JSON files.
 *
 * Excel flow:  File read → Sheet selection → Skip rows / header config → Preview → Import
 * JSON flow:   File read → Preview → Import
 *
 * Props:
 *   file       — the File object dropped/selected
 *   onImport   — (name: string, data: object[]) => void
 *   onClose    — () => void
 */
export default function ImportWizard({ file, onImport, onClose }) {
  const ext = file.name.split('.').pop().toLowerCase();
  const isExcel = ['xlsx', 'xls', 'xlsb', 'xlsm', 'ods'].includes(ext);
  const isJSON = ext === 'json';

  // ── Shared state ──
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0); // 0=loading, 1=config, 2=preview/confirm

  // ── Excel state ──
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [sheetConfigs, setSheetConfigs] = useState({}); // { sheetName: { skipRows, headerRow, name } }

  // ── JSON state ──
  const [jsonData, setJsonData] = useState(null);
  const [jsonName, setJsonName] = useState('');

  // ── Step 1: Read the file ──
  useEffect(() => {
    setError(null);

    if (isExcel) {
      const reader = new FileReader();
      reader.onerror = () => setError('Failed to read file');
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          setWorkbook(wb);
          setSheetNames(wb.SheetNames);
          // Pre-select all sheets, pre-configure each
          setSelectedSheets([...wb.SheetNames]);
          const configs = {};
          for (const name of wb.SheetNames) {
            configs[name] = {
              skipRows: 0,    // rows to skip before header
              headerRow: 0,   // which row (after skip) is the header (0-based)
              name: name,     // dataset name
            };
          }
          setSheetConfigs(configs);
          setStep(1);
        } catch (err) {
          setError('Failed to parse Excel file: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (isJSON) {
      const reader = new FileReader();
      reader.onerror = () => setError('Failed to read file');
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          // Support: array of objects, or { key: [...] }
          let data;
          if (Array.isArray(parsed)) {
            data = parsed;
          } else if (typeof parsed === 'object') {
            // Find the first array property
            const arrayKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
            if (arrayKey) {
              data = parsed[arrayKey];
            } else {
              // Wrap single object in array
              data = [parsed];
            }
          }
          if (!data || data.length === 0) {
            setError('No data found in JSON file');
            return;
          }
          // Flatten nested objects one level
          const flat = data.map(row => {
            const out = {};
            for (const [k, v] of Object.entries(row)) {
              if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                for (const [sk, sv] of Object.entries(v)) {
                  out[`${k}.${sk}`] = sv;
                }
              } else {
                out[k] = v;
              }
            }
            return out;
          });
          setJsonData(flat);
          setJsonName(file.name.replace(/\.json$/i, ''));
          setStep(2);
        } catch (err) {
          setError('Invalid JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  }, [file, isExcel, isJSON]);

  // ── Excel: parse a sheet with config ──
  const parseSheet = useCallback((sheetName, config) => {
    if (!workbook) return [];
    const ws = workbook.Sheets[sheetName];
    // Convert to array of arrays
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!raw.length) return [];

    const dataStartRow = config.skipRows + config.headerRow;
    const headerRowData = raw[dataStartRow];
    if (!headerRowData) return [];

    // Build headers — use column letters for empty headers
    const headers = headerRowData.map((h, i) => {
      const s = String(h).trim();
      return s || `Column_${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`;
    });

    // Data rows start after header
    const dataRows = raw.slice(dataStartRow + 1);
    return dataRows
      .filter(row => row.some(cell => cell !== '' && cell != null))
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => {
          const v = row[i] ?? '';
          const s = String(v).trim();
          obj[h] = s !== '' && !isNaN(s) && s !== '' ? Number(s) : v;
        });
        return obj;
      });
  }, [workbook]);

  // ── Excel: preview data for a sheet ──
  const previewData = useMemo(() => {
    if (!isExcel || step < 1 || selectedSheets.length === 0) return {};
    const previews = {};
    for (const name of selectedSheets) {
      const cfg = sheetConfigs[name] || { skipRows: 0, headerRow: 0 };
      const data = parseSheet(name, cfg);
      previews[name] = data;
    }
    return previews;
  }, [isExcel, step, selectedSheets, sheetConfigs, parseSheet]);

  // ── Toggle sheet selection ──
  const toggleSheet = (name) => {
    setSelectedSheets(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // ── Update a sheet's config ──
  const updateConfig = (sheetName, key, value) => {
    setSheetConfigs(prev => ({
      ...prev,
      [sheetName]: { ...prev[sheetName], [key]: value },
    }));
  };

  // ── Import handler ──
  const handleImport = () => {
    if (isExcel) {
      let imported = 0;
      for (const sheetName of selectedSheets) {
        const cfg = sheetConfigs[sheetName] || { skipRows: 0, headerRow: 0, name: sheetName };
        const data = parseSheet(sheetName, cfg);
        if (data.length > 0) {
          onImport(cfg.name || sheetName, data);
          imported++;
        }
      }
      if (imported === 0) {
        setError('No data found in the selected sheets');
        return;
      }
    } else if (isJSON) {
      onImport(jsonName || 'data', jsonData);
    }
    onClose();
  };

  // ── Render ──
  return (
    <div className="wizard-overlay" onClick={onClose}>
      <div className="wizard-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="wizard-header">
          <h3>
            {isExcel ? 'Import Excel File' : 'Import JSON File'}
          </h3>
          <span className="wizard-filename">{file.name}</span>
          <button className="btn btn-icon wizard-close" onClick={onClose}>&times;</button>
        </div>

        {/* Error */}
        {error && <div className="wizard-error">{error}</div>}

        {/* Loading */}
        {step === 0 && !error && (
          <div className="wizard-body wizard-loading">
            Reading file...
          </div>
        )}

        {/* Excel Step 1: Sheet selection + configuration */}
        {isExcel && step === 1 && (
          <div className="wizard-body">
            <div className="wizard-section-label">
              Select sheets to import ({sheetNames.length} sheet{sheetNames.length !== 1 ? 's' : ''} found)
            </div>

            <div className="wizard-sheets">
              {sheetNames.map(name => {
                const selected = selectedSheets.includes(name);
                const cfg = sheetConfigs[name] || { skipRows: 0, headerRow: 0, name };
                const preview = previewData[name] || [];
                const rawSheet = workbook?.Sheets[name];
                const rawRows = rawSheet ? XLSX.utils.sheet_to_json(rawSheet, { header: 1, defval: '' }).length : 0;

                return (
                  <div key={name} className={`wizard-sheet ${selected ? 'wizard-sheet--selected' : ''}`}>
                    <div className="wizard-sheet-header" onClick={() => toggleSheet(name)}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSheet(name)}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="wizard-sheet-name">{name}</span>
                      <span className="wizard-sheet-meta">
                        {rawRows} row{rawRows !== 1 ? 's' : ''}
                        {selected && preview.length > 0 && ` \u2192 ${preview.length} data row${preview.length !== 1 ? 's' : ''}`}
                      </span>
                    </div>

                    {selected && (
                      <div className="wizard-sheet-config">
                        <div className="wizard-config-row">
                          <label>Dataset name</label>
                          <input
                            type="text"
                            className="wizard-input"
                            value={cfg.name}
                            onChange={e => updateConfig(name, 'name', e.target.value)}
                          />
                        </div>
                        <div className="wizard-config-row">
                          <label>Skip rows from top</label>
                          <input
                            type="number"
                            className="wizard-input wizard-input--sm"
                            min={0}
                            value={cfg.skipRows}
                            onChange={e => updateConfig(name, 'skipRows', Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                        <div className="wizard-config-row">
                          <label>Header row (after skip)</label>
                          <input
                            type="number"
                            className="wizard-input wizard-input--sm"
                            min={0}
                            value={cfg.headerRow}
                            onChange={e => updateConfig(name, 'headerRow', Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>

                        {/* Preview */}
                        {preview.length > 0 && (
                          <div className="wizard-preview">
                            <div className="wizard-preview-label">
                              Preview ({Math.min(preview.length, 5)} of {preview.length} rows)
                            </div>
                            <div className="wizard-preview-table-wrap">
                              <table className="wizard-preview-table">
                                <thead>
                                  <tr>
                                    {Object.keys(preview[0]).map(col => (
                                      <th key={col}>{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {preview.slice(0, 5).map((row, i) => (
                                    <tr key={i}>
                                      {Object.values(row).map((v, j) => (
                                        <td key={j}>{v === '' || v == null ? '' : String(v)}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {preview.length === 0 && (
                          <div className="wizard-preview-empty">
                            No data rows found with current settings. Try adjusting skip rows or header row.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* JSON Step: Preview */}
        {isJSON && step === 2 && jsonData && (
          <div className="wizard-body">
            <div className="wizard-config-row" style={{ marginBottom: 12 }}>
              <label>Dataset name</label>
              <input
                type="text"
                className="wizard-input"
                value={jsonName}
                onChange={e => setJsonName(e.target.value)}
              />
            </div>
            <div className="wizard-section-label">
              Preview ({Math.min(jsonData.length, 5)} of {jsonData.length} rows, {Object.keys(jsonData[0] || {}).length} columns)
            </div>
            <div className="wizard-preview">
              <div className="wizard-preview-table-wrap">
                <table className="wizard-preview-table">
                  <thead>
                    <tr>
                      {Object.keys(jsonData[0] || {}).map(col => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jsonData.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {Object.keys(jsonData[0] || {}).map(col => (
                          <td key={col}>{row[col] === '' || row[col] == null ? '' : String(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="wizard-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <div style={{ flex: 1 }} />
          {isExcel && step === 1 && (
            <button
              className="btn btn-primary"
              disabled={selectedSheets.length === 0}
              onClick={handleImport}
            >
              Import {selectedSheets.length} sheet{selectedSheets.length !== 1 ? 's' : ''}
            </button>
          )}
          {isJSON && step === 2 && (
            <button
              className="btn btn-primary"
              disabled={!jsonData || jsonData.length === 0}
              onClick={handleImport}
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
