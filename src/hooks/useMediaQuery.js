import { useState, useEffect } from 'react';

/** Breakpoints (px) */
export const BP = {
  mobile: 768,   // phones & small tablets
  tablet: 1024,  // tablets & small laptops
};

/**
 * Returns true when the viewport matches the given media query string.
 * Usage: const isMobile = useMediaQuery('(max-width: 767px)');
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Convenience: returns { isMobile, isTablet, isDesktop } */
export function useBreakpoint() {
  const isMobile = useMediaQuery(`(max-width: ${BP.mobile - 1}px)`);
  const isTablet = useMediaQuery(`(min-width: ${BP.mobile}px) and (max-width: ${BP.tablet - 1}px)`);
  return {
    isMobile,     // < 768
    isTablet,     // 768–1023
    isDesktop: !isMobile && !isTablet, // >= 1024
  };
}
