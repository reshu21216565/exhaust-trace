import { useState } from 'react';
import { useIncident } from './lib/IncidentContext';
import { useUI } from './lib/UIContext';
import { TopBar } from './components/TopBar';
import { LeftNav } from './components/LeftNav';
import { MainWorkspace } from './components/MainWorkspace';
import { RightDrawer } from './components/RightDrawer';
import { SentinelTransitionWrapper } from './components/sentinel/SentinelTransitionWrapper';
import { LandingPage } from './pages/LandingPage';
import { Loader2 } from 'lucide-react';

function App() {
  const { bundle, isConnected, startIncident } = useIncident();
  const { judgeMode, sentinelMode, setSentinelMode } = useUI();
  const [showLanding, setShowLanding] = useState<boolean>(true);

  if (showLanding) {
    return (
      <LandingPage
        onEnter={async () => {
          if (!bundle) {
            await startIncident();
          }
          setShowLanding(false);
        }}
      />
    );
  }

  if (!isConnected && !bundle) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textMain">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <h1 className="text-xl font-medium tracking-wide">CONNECTING TO EXHAUSTTRACE API...</h1>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textMain">
        <h1 className="text-2xl font-bold mb-6 tracking-wide">EXHAUSTTRACE</h1>
        <p className="text-textMuted mb-8 max-w-md text-center">
          A causal debugger for distributed-system resource-exhaustion incidents.
        </p>
        <button 
          onClick={() => startIncident()}
          className="px-6 py-3 bg-primary hover:bg-primaryHover text-white rounded-lg shadow-lg font-medium tracking-wide transition-colors"
        >
          START INCIDENT SIMULATION
        </button>
      </div>
    );
  }

  return <SentinelTransitionWrapper />;
}

export default App;
