import { useState } from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import DeveloperMode from './components/Developer/DeveloperMode';
import ViewerMode from './components/Viewer/ViewerMode';
import HelpPage from './components/HelpPage';
import './App.css';

function AppInner() {
  const { state } = useApp();
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="app">
      <Header onHelpOpen={() => setShowHelp(true)} />
      <main className="app-main">
        {state.mode === 'developer' ? <DeveloperMode /> : <ViewerMode />}
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
