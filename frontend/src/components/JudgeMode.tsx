import React from 'react';
import { useUI } from '../lib/UIContext';
import { useIncident } from '../lib/IncidentContext';
import { Network, X } from 'lucide-react';
import { CausalGraph } from './views/CausalAnalysis/CausalGraph';
import { TopHypothesis } from './views/Overview/TopHypothesis';
import { ValidationResult } from './views/Validation/ValidationResult';
import { PredictionCard } from './views/Prediction/PredictionCard';

export const JudgeMode: React.FC = () => {
  const { setJudgeMode } = useUI();
  const { bundle } = useIncident();

  if (!bundle) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background text-textMain flex flex-col overflow-hidden">
      <header className="h-16 glass-header px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Network className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-lg font-bold tracking-widest text-textMain leading-tight">JUDGE MODE</h1>
            <p className="text-xs text-textMuted uppercase tracking-wider leading-tight">ExhaustTrace Presenter View</p>
          </div>
        </div>
        <button 
          onClick={() => setJudgeMode(false)}
          className="p-2 text-textMuted hover:text-textMain hover:bg-surface rounded-full transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        <div className="flex-1 glass-panel overflow-hidden relative shadow-2xl border-primary/20">
          <div className="absolute top-4 left-4 z-10">
            <h2 className="text-sm font-semibold tracking-wider uppercase mb-1">Causal Architecture</h2>
            <p className="text-xs text-textMuted">Live dependency & propagation visualization</p>
          </div>
          <CausalGraph />
        </div>

        <div className="w-1/3 flex flex-col gap-6 overflow-y-auto">
          <TopHypothesis />
          {bundle.prediction && <PredictionCard prediction={bundle.prediction} />}
          {(bundle.status === 'VALIDATED' || bundle.status === 'COMPLETED') && (
            <ValidationResult />
          )}
        </div>
      </div>
    </div>
  );
};
