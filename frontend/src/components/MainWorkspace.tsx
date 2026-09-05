import React from 'react';
import { useUI } from '../lib/UIContext';
import { Overview } from './views/Overview';
import { CausalAnalysis } from './views/CausalAnalysis';
import { Evidence } from './views/Evidence';
import { Prediction } from './views/Prediction';
import { Experiment } from './views/Experiment';
import { Validation } from './views/Validation';
import { Timeline } from './views/Timeline';

export const MainWorkspace: React.FC = () => {
  const { activeTab } = useUI();

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
      {activeTab === 'Overview' && <Overview />}
      {activeTab === 'Causal Analysis' && <CausalAnalysis />}
      {activeTab === 'Evidence' && <Evidence />}
      {activeTab === 'Prediction' && <Prediction />}
      {activeTab === 'Experiment' && <Experiment />}
      {activeTab === 'Validation' && <Validation />}
      {activeTab === 'Timeline' && <Timeline />}
    </main>
  );
};
