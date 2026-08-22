import { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';

export function useTooltip() {
  const [tip, setTip] = useState(null); // { x, y, content }

  const showTooltip = useCallback((event, content) => {
    const x = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const y = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    setTip({ x, y, content });
  }, []);

  const moveTooltip = useCallback((event) => {
    setTip(t => t ? { ...t, x: event.clientX, y: event.clientY } : t);
  }, []);

  const hideTooltip = useCallback(() => setTip(null), []);

  // Dismiss on tap outside the tooltip (mobile)
  useEffect(() => {
    if (!tip) return;
    const handler = (e) => {
      if (!e.target.closest('.chart-tooltip')) setTip(null);
    };
    document.addEventListener('touchstart', handler, { passive: true });
    return () => document.removeEventListener('touchstart', handler);
  }, [tip]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 767;

  const tooltipEl = tip ? ReactDOM.createPortal(
    <div
      className="chart-tooltip"
      style={isMobile ? {
        // Center horizontally, float above the touch point
        left: '50%',
        transform: 'translateX(-50%)',
        top: Math.max(56, tip.y - 140),
        maxWidth: 'calc(100vw - 24px)',
      } : {
        left: tip.x + 14,
        top: tip.y - 10,
        maxWidth: 260,
      }}
    >
      {tip.content}
    </div>,
    document.body
  ) : null;

  return { tooltipEl, showTooltip, moveTooltip, hideTooltip };
}
