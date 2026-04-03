import { useState, useEffect } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { AppProvider, useApp } from './context/AppContext';
import { useBreakpoint } from './hooks/useMediaQuery';
import Header from './components/Header';
import DeveloperMode from './components/Developer/DeveloperMode';
import ViewerMode from './components/Viewer/ViewerMode';
import HelpPage from './components/HelpPage';
import './App.css';

function AppInner() {
  const { state, dispatch } = useApp();
  const [showHelp, setShowHelp] = useState(false);
  const { isMobile, isTablet } = useBreakpoint();

  // Force viewer mode on mobile devices
  useEffect(() => {
    if (isMobile && state.mode === 'developer') {
      dispatch({ type: 'SET_MODE', payload: 'viewer' });
    }
  }, [isMobile, state.mode, dispatch]);

  const effectiveMode = isMobile ? 'viewer' : state.mode;

  return (
    <div className={`app ${isMobile ? 'app--mobile' : ''} ${isTablet ? 'app--tablet' : ''}`}>
      <Header onHelpOpen={() => setShowHelp(true)} isMobile={isMobile} isTablet={isTablet} />
      <main className="app-main">
        {effectiveMode === 'developer' ? <DeveloperMode isTablet={isTablet} /> : <ViewerMode isMobile={isMobile} />}
      </main>
      {showHelp && <HelpPage onClose={() => setShowHelp(false)} />}
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
