import { useState, useEffect, lazy, Suspense } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { AppProvider, useApp } from './context/AppContext';
import { useBreakpoint } from './hooks/useMediaQuery';
import Header from './components/Header';
import DeveloperMode from './components/Developer/DeveloperMode';
import ViewerMode from './components/Viewer/ViewerMode';
import HelpPage from './components/HelpPage';
import './App.css';

const AIChatPanel = lazy(() => import('./components/AIChat/AIChatPanel'));

function AppInner() {
  const { state, dispatch } = useApp();
  const [showHelp, setShowHelp] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const { isMobile, isTablet } = useBreakpoint();

  // Force viewer mode on mobile devices
  useEffect(() => {
    if (isMobile && state.mode === 'developer') {
      dispatch({ type: 'SET_MODE', payload: 'viewer' });
    }
  }, [isMobile, state.mode, dispatch]);

  // Window title: "Ytics" or "Dashboard Title — Ytics"
  useEffect(() => {
    const title = state.dashboard.title?.trim();
    document.title = title ? `${title} — Ytics` : 'Ytics';
  }, [state.dashboard.title]);

  const effectiveMode = isMobile ? 'viewer' : state.mode;

  return (
    <div className={`app ${isMobile ? 'app--mobile' : ''} ${isTablet ? 'app--tablet' : ''}`}>
      <Header
        onHelpOpen={() => setShowHelp(true)}
        onAIToggle={() => setShowAI(v => !v)}
        isAIOpen={showAI}
        isMobile={isMobile}
        isTablet={isTablet}
      />
      <main className="app-main">
        {effectiveMode === 'developer' ? <DeveloperMode isTablet={isTablet} /> : <ViewerMode isMobile={isMobile} />}
      </main>
      {showHelp && <HelpPage onClose={() => setShowHelp(false)} />}
      {showAI && (
        <Suspense fallback={null}>
          <AIChatPanel onClose={() => setShowAI(false)} />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
