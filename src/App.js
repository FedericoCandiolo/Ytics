import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import DeveloperMode from './components/Developer/DeveloperMode';
import ViewerMode from './components/Viewer/ViewerMode';
import './App.css';

function AppInner() {
  const { state } = useApp();
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        {state.mode === 'developer' ? <DeveloperMode /> : <ViewerMode />}
      </main>
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
