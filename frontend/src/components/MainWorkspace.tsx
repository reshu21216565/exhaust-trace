import React from 'react';
import { useUI } from '../lib/UIContext';
import { Overview } from './views/Overview';
import { CausalAnalysis } from './views/CausalAnalysis';
import { Evidence } from './views/Evidence';
import { Prediction } from './views/Prediction';
import { Experiment } from './views/Experiment';
import { Validation } from './views/Validation';
import { Timeline } from './views/Timeline';
import { ReportTab } from './tabs/ReportTab';
import { ConfidenceTab } from './tabs/ConfidenceTab';
import { BenchmarkTab } from './tabs/BenchmarkTab';
import { ConcurrentTab } from './tabs/ConcurrentTab';
import { AnalystVoiceTab } from './tabs/AnalystVoiceTab';

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
      {activeTab === 'Report' && <ReportTab />}
      {activeTab === 'Confidence' && <ConfidenceTab />}
      {activeTab === 'Benchmark' && <BenchmarkTab />}
      {activeTab === 'Concurrent' && <ConcurrentTab />}
      {activeTab === 'Analyst Voice' && <AnalystVoiceTab />}
    </main>
  );
};
