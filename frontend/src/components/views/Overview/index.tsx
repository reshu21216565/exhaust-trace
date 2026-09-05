import React from 'react';
import { TopHypothesis } from './TopHypothesis';
import { TelemetrySummary } from './TelemetrySummary';

export const Overview: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold tracking-wide">Incident Overview</h2>
        <span className="text-sm text-textMuted uppercase tracking-widest">Phase: Observe & Analyze</span>
      </div>
      
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 flex flex-col gap-6">
          <TopHypothesis />
        </div>
        <div className="xl:col-span-2 flex flex-col gap-6">
          <TelemetrySummary />
        </div>
      </div>
    </div>
  );
};
