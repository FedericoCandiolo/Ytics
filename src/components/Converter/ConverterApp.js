import { useState, useRef, useCallback } from 'react';
import { parseQVF, buildYticsBlob } from './converters/qvfUtils';

// ── Shared style tokens ───────────────────────────────────────────────────────
const s = {
  page: {
    height: '100vh',
    background: 'var(--bg, #f5f6f8)',
    color: 'var(--text, #111827)',
    fontFamily: 'var(--font, Inter, sans-serif)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    background: 'var(--header-bg, #111827)',
    color: 'var(--text-inv, #f9fafb)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 20px',
    height: 48,
    flexShrink: 0,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 8px',
    borderRadius: 6,
  },
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  sidebar: {
    width: 200,
    background: 'var(--card, #fff)',
    borderRight: '1px solid var(--border, rgba(0,0,0,.08))',
    padding: '16px 0',
    flexShrink: 0,
    overflowY: 'auto',
  },
  sidebarLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--text-muted, #6b7280)',
    padding: '0 16px',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sidebarItem: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
    background: active ? 'var(--primary-subtle, #eef2ff)' : 'none',
    color: active ? 'var(--primary, #5046e5)' : 'var(--text, #111827)',
    fontWeight: active ? 600 : 400,
    borderRight: active ? '2px solid var(--primary, #5046e5)' : '2px solid transparent',
  }),
  main: {
    flex: 1,
    padding: 32,
    overflowY: 'auto',
  },
  card: {
    background: 'var(--card, #fff)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    borderRadius: 12,
    padding: 24,
    maxWidth: 720,
  },
  h2: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 },
  dropZone: (over) => ({
    border: `2px dashed ${over ? 'var(--primary, #5046e5)' : 'var(--border-strong, rgba(0,0,0,.14))'}`,
    borderRadius: 10,
    padding: '36px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    background: over ? 'var(--primary-subtle, #eef2ff)' : 'transparent',
    transition: 'all 0.15s',
    marginBottom: 16,
  }),
  badge: (color) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    background: color === 'green' ? '#dcfce7' : color === 'yellow' ? '#fef9c3' : color === 'red' ? '#fee2e2' : '#e0e7ff',
    color: color === 'green' ? '#15803d' : color === 'yellow' ? '#92400e' : color === 'red' ? '#b91c1c' : '#3730a3',
  }),
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    background: 'var(--bg, #f5f6f8)',
    borderRadius: 8,
    padding: '10px 14px',
    border: '1px solid var(--border)',
  },
  statNum: { fontSize: 22, fontWeight: 700, lineHeight: 1 },
  statLbl: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  pageRow: {
    background: 'var(--bg, #f5f6f8)',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 8,
    border: '1px solid var(--border)',
  },
  pageTitle: { fontSize: 13, fontWeight: 600, marginBottom: 6 },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  chip: {
    background: 'var(--primary-subtle, #eef2ff)',
    color: 'var(--primary, #5046e5)',
    borderRadius: 6,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
  },
  warnBox: {
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 16,
    fontSize: 12,
    color: '#92400e',
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 18px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  btnPrimary: {
    background: 'var(--primary, #5046e5)',
    color: '#fff',
  },
  btnGhost: {
    background: 'var(--bg, #f5f6f8)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
  },
};

// ── Chart type icon map ───────────────────────────────────────────────────────
const CHART_ICONS = {
  bar: '▊', line: '📈', pie: '◑', scatter: '⠿', combo: '📊',
  table: '⊞', pivot: '⊟', treemap: '▦', kpi: '◉', histogram: '▁▃▅▇',
  boxplot: '⬜', waterfall: '▯', mekko: '▤', violin: '♪', geo: '🗺',
  heatmap: '▥', funnel: '▽',
};

// ── Converter types registry (easy to extend later) ──────────────────────────
const CONVERTERS = [
  {
    id: 'qvf',
    label: 'QVF → Ytics',
    icon: '🔄',
    description: 'Convert a QlikView / QlikSense .qvf dashboard',
    accept: '.qvf',
    acceptLabel: '.qvf',
  },
  // Future: { id: 'pbix', label: 'Power BI → Ytics', icon: '🔄', description: '...', accept: '.pbix', disabled: true },
  // Future: { id: 'twb',  label: 'Tableau → Ytics',  icon: '🔄', description: '...', accept: '.twb,.twbx', disabled: true },
];

// ── QVF panel ─────────────────────────────────────────────────────────────────
function QVFPanel() {
  const [status, setStatus] = useState('idle'); // idle | parsing | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setStatus('parsing');
    setResult(null);
    setErrorMsg('');
    try {
      const parsed = await parseQVF(file);
      setResult({ parsed, fileName: file.name });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err.message || 'Failed to parse QVF file.');
      setStatus('error');
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDownload = async () => {
    if (!result) return;
    try {
      const zipBlob = await buildYticsBlob(result.parsed);
      // Force octet-stream so browsers don't rename the file to .zip
      const blob = new Blob([await zipBlob.arrayBuffer()], { type: 'application/octet-stream' });
      const baseName = (result.parsed.appTitle || result.fileName.replace(/\.qvf$/i, '') || 'dashboard')
        .replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '_') || 'dashboard';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName + '.ytics';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('Error generating .ytics file: ' + err.message);
    }
  };

  const reset = () => { setStatus('idle'); setResult(null); setErrorMsg(''); };

  return (
    <div style={s.card}>
      <div style={s.h2}>QVF → Ytics Converter</div>
      <div style={s.subtitle}>
        Upload a QlikView / QlikSense <strong>.qvf</strong> file. The converter extracts sheets,
        visualizations and field names. Data is not embedded in QVF, so you will load datasets
        in Ytics after import.
      </div>

      {/* Drop zone */}
      {status === 'idle' && (
        <>
          <div
            style={s.dropZone(over)}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Drop your .qvf file here
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>or click to browse</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".qvf"
            hidden
            onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }}
          />
        </>
      )}

      {/* Parsing spinner */}
      {status === 'parsing' && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
          <div>Parsing QVF…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div>
          <div style={{ ...s.warnBox, background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c', marginBottom: 16 }}>
            <strong>Error:</strong> {errorMsg}
          </div>
          <button style={{ ...s.btn, ...s.btnGhost }} onClick={reset}>Try another file</button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <Results result={result} onReset={reset} onDownload={handleDownload} />
      )}
    </div>
  );
}

function Results({ result, onReset, onDownload }) {
  const { parsed, fileName } = result;
  const { appTitle, pages, warnings, stats } = parsed;

  return (
    <div>
      {/* File info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>📄 {fileName}</span>
        <span style={s.badge(stats.widgets > 0 ? 'green' : 'yellow')}>
          {stats.widgets > 0 ? '✓ Parsed' : '⚠ No charts'}
        </span>
      </div>

      {/* Stats */}
      <div style={s.statsGrid}>
        {[
          { n: stats.pages, l: 'Pages' },
          { n: stats.widgets, l: 'Widgets' },
          { n: stats.objects, l: 'QlikObjects' },
        ].map(({ n, l }) => (
          <div key={l} style={s.statBox}>
            <div style={s.statNum}>{n}</div>
            <div style={s.statLbl}>{l}</div>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={s.warnBox}>
          <strong>⚠ Notes:</strong>
          <ul style={{ marginTop: 4, paddingLeft: 16 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Pages preview */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Pages &amp; Widgets
        </div>
        {pages.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No pages extracted.</div>
        ) : pages.map(page => (
          <div key={page.id} style={s.pageRow}>
            <div style={s.pageTitle}>
              📋 {page.name}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                {page.widgets.length} widget{page.widgets.length !== 1 ? 's' : ''}
              </span>
            </div>
            {page.widgets.length > 0 && (
              <div style={s.chipRow}>
                {page.widgets.map(w => (
                  <span key={w.id} style={s.chip} title={`Type: ${w._sourceViz}`}>
                    {CHART_ICONS[w.type] || '▪'} {w.title || w.type}
                    {w.xField ? ` · ${w.xField}` : ''}
                    {w.yField ? ` / ${w.yField}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Data model (binary format only) */}
      {parsed.isBinaryFormat && Object.keys(parsed.dataModel || {}).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Embedded Data Model
          </div>
          {Object.entries(parsed.dataModel).map(([table, fields]) => (
            <div key={table} style={s.pageRow}>
              <div style={s.pageTitle}>🗄 {table}</div>
              <div style={s.chipRow}>
                {fields.map(f => <span key={f} style={{ ...s.chip, background: '#f0fdf4', color: '#166534' }}>{f}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notice about data */}
      <div style={{ background: 'var(--primary-subtle, #eef2ff)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
        {parsed.isBinaryFormat ? (
          <>
            <strong>ℹ️ Binary format:</strong> Chart types and axis config are stored in QlikView's proprietary binary — placeholders (bar charts) are created for each chart object. After opening in Ytics, reconfigure each widget's type and fields using the data model above.
          </>
        ) : (
          <>
            <strong>ℹ️ Next step:</strong> Open the downloaded <strong>.ytics</strong> file in Ytics, then go to <em>Data Integration</em> to load your datasets. Widgets will reference field names extracted from the QVF — match them to your columns.
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          style={{ ...s.btn, ...s.btnPrimary, opacity: stats.widgets === 0 ? 0.5 : 1 }}
          onClick={onDownload}
          disabled={stats.widgets === 0}
        >
          ⬇ Download {appTitle}.ytics
        </button>
        <button style={{ ...s.btn, ...s.btnGhost }} onClick={onReset}>
          Convert another
        </button>
      </div>
    </div>
  );
}

// ── Root converter app ────────────────────────────────────────────────────────
export default function ConverterApp() {
  const [active, setActive] = useState('qvf');

  return (
    <div style={s.page}>
      {/* Top bar */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => window.location.href = window.location.pathname}>
          ← Ytics
        </button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Converter</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.5 }}>
          Convert external dashboards to .ytics
        </span>
      </div>

      <div style={s.body}>
        {/* Sidebar */}
        <div style={s.sidebar}>
          <div style={s.sidebarLabel}>Formats</div>
          {CONVERTERS.map(c => (
            <div
              key={c.id}
              style={s.sidebarItem(active === c.id)}
              onClick={() => !c.disabled && setActive(c.id)}
            >
              <span>{c.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{c.label}</div>
                {c.disabled && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>coming soon</div>}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 24, padding: '0 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              More formats (Power BI, Tableau…) coming soon.
            </div>
          </div>
        </div>

        {/* Main panel */}
        <div style={s.main}>
          {active === 'qvf' && <QVFPanel />}
        </div>
      </div>
    </div>
  );
}
