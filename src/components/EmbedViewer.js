import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { importDashboard } from '../utils/exportUtils';
import ViewerMode from './Viewer/ViewerMode';

export default function EmbedViewer({ src }) {
  const { dispatch } = useApp();
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!src) { setError('No src URL provided.'); setStatus('error'); return; }
    async function load() {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const blob = await res.blob();
        const result = await importDashboard(blob);
        dispatch({ type: 'IMPORT_STATE', payload: { ...result, fileOrigin: { source: 'url', url: src } } });
        dispatch({ type: 'SET_MODE', payload: 'viewer' });
        setStatus('ready');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }
    load();
  }, [src, dispatch]);

  if (status === 'loading') {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        background: 'var(--bg, #fff)', color: 'var(--text-muted, #64748b)', fontSize: 14,
      }}>
        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.5}
          style={{ animation: 'spin 1s linear infinite' }}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
            strokeLinecap="round" />
        </svg>
        Loading dashboard…
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 10,
        background: 'var(--bg, #fff)', color: 'var(--text, #1e293b)', fontSize: 14,
      }}>
        <span style={{ fontSize: 32 }}>⚠</span>
        <div style={{ fontWeight: 600 }}>Failed to load dashboard</div>
        <div style={{ color: 'var(--text-muted, #64748b)', fontSize: 12, maxWidth: 320, textAlign: 'center' }}>{error}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Make sure the .ytics file is publicly accessible and CORS headers allow this origin.
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <ViewerMode isMobile={false} />
    </div>
  );
}
