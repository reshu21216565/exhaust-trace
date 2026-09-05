import React from 'react';
import { CausalGraph } from './CausalGraph';
import { Network } from 'lucide-react';

export const CausalAnalysis: React.FC = () => {
  return (
    <div className="flex-1 overflow-hidden flex flex-col p-6 gap-6 relative">
      <div className="flex items-center justify-between z-10">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Causal Architecture
          </h2>
          <p className="text-sm text-textMuted mt-1">Live dependency & propagation visualization</p>
        </div>
        
        <div className="flex gap-4">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-4 h-[2px] bg-border" />
            <span className="text-textMuted uppercase tracking-wider">Dependency</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-4 h-1 bg-degraded rounded-full" />
            <span className="text-textMuted uppercase tracking-wider">Causal Propagation</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 glass-panel overflow-hidden relative w-full h-full min-h-[450px]">
        <CausalGraph />
      </div>
    </div>
  );
};
