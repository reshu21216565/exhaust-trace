import { useState } from 'react';
import { useIncident } from './lib/IncidentContext';
import { useUI } from './lib/UIContext';
import { TopBar } from './components/TopBar';
import { LeftNav } from './components/LeftNav';
import { MainWorkspace } from './components/MainWorkspace';
import { RightDrawer } from './components/RightDrawer';
import { JudgeMode } from './components/JudgeMode';
import { LandingPage } from './pages/LandingPage';
import { Loader2 } from 'lucide-react';

function App() {
  const { bundle, isConnected, startIncident } = useIncident();
  const { judgeMode } = useUI();
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

  if (judgeMode) {
    return <JudgeMode />;
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-background text-textMain relative">
        <div className="absolute inset-x-0 top-0 z-50 flex justify-center pt-4 pointer-events-none">
          <div className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-yellow-200 shadow-lg backdrop-blur-sm">
            RECONNECTING...
          </div>
        </div>
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <LeftNav />
          <MainWorkspace />
          <RightDrawer />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-textMain">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <LeftNav />
        <MainWorkspace />
        <RightDrawer />
      </div>
    </div>
  );
}

export default App;
