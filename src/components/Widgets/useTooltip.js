import { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';

/**
 * useTooltip — shared tooltip hook for all chart components.
 * Renders via a portal so it always appears above the grid.
 *
 * Usage:
 *   const { tooltipEl, showTooltip, moveTooltip, hideTooltip } = useTooltip();
 *   ...
 *   <svg onMouseMove={moveTooltip} onMouseLeave={hideTooltip}>
 *   ...
 *   showTooltip(event, <TooltipContent />)
 *   ...
 *   {tooltipEl}
 */
export function useTooltip() {
  const [tip, setTip] = useState(null); // { x, y, content }

  const showTooltip = useCallback((event, content) => {
    setTip({ x: event.clientX, y: event.clientY, content });
  }, []);

  const moveTooltip = useCallback((event) => {
    setTip(t => t ? { ...t, x: event.clientX, y: event.clientY } : t);
  }, []);

  const hideTooltip = useCallback(() => setTip(null), []);

  const tooltipEl = tip ? ReactDOM.createPortal(
    <div
      className="chart-tooltip"
      style={{
        left: tip.x + 14,
        top: tip.y - 10,
        // Keep in viewport
        maxWidth: 260,
      }}
    >
      {tip.content}
    </div>,
    document.body
  ) : null;

  return { tooltipEl, showTooltip, moveTooltip, hideTooltip };
}
