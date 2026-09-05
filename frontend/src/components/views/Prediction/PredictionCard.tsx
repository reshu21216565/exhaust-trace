import React from 'react';
import type { CounterfactualPrediction } from '@exhausttrace/shared';
import { TrendingDown, Clock, ShieldCheck } from 'lucide-react';

export const PredictionCard: React.FC<{ prediction: CounterfactualPrediction }> = ({ prediction }) => {

  return (
    <div className="glass-panel border-primary overflow-hidden">
      <div className="bg-primary/10 border-b border-primary/20 p-6 text-center">
        <h3 className="text-[10px] text-primary uppercase tracking-[0.2em] font-bold mb-2">Predicted Root Resolution</h3>
        <div className="text-2xl font-bold tracking-tight">
          {prediction.rootServiceId} / <span className="text-primary font-mono">{prediction.rootResource}</span>
        </div>
        <div className="text-xs text-textMuted mt-2">Confidence at prediction: {Math.round(prediction.confidenceAtPrediction * 100)}%</div>
      </div>

      <div className="p-6">
        <h4 className="text-[10px] text-textMuted uppercase tracking-widest mb-4">Expected Recovery Metrics</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {prediction.recoveryTargets.slice(0, 6).map((target, i) => (
            <div key={i} className="bg-surface border border-border rounded-lg p-3 flex flex-col">
              <span className="text-[10px] text-textMuted uppercase tracking-wider mb-1 truncate">
                {target.serviceId}
              </span>
              <span className="text-[9px] text-textMuted/60 mb-2 truncate font-mono">{target.metricName}</span>
              <div className="flex items-center gap-1">
                <span className="text-base font-mono font-bold text-textMain">{Math.round(target.targetValue)}</span>
                <TrendingDown className="w-3 h-3 text-healthy ml-1" />
              </div>
              <span className="text-[9px] text-textMuted/50 mt-1">
                from <span className="line-through">{Math.round(target.baselineValue)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface/50 border-t border-border p-6 flex justify-around">
        <div className="text-center">
          <div className="flex justify-center mb-2"><Clock className="w-5 h-5 text-textMuted" /></div>
          <div className="text-xs text-textMuted uppercase tracking-wider mb-1">Recovery Horizon</div>
          <div className="font-mono text-lg font-bold">{prediction.horizonTicks} ticks</div>
        </div>
        <div className="w-px bg-border" />
        <div className="text-center">
          <div className="flex justify-center mb-2"><ShieldCheck className="w-5 h-5 text-textMuted" /></div>
          <div className="text-xs text-textMuted uppercase tracking-wider mb-1">Checkpoints</div>
          <div className="font-mono text-lg font-bold">{prediction.checkpoints.length}</div>
        </div>
        <div className="w-px bg-border" />
        <div className="text-center">
          <div className="flex justify-center mb-2"><TrendingDown className="w-5 h-5 text-healthy" /></div>
          <div className="text-xs text-textMuted uppercase tracking-wider mb-1">Cascade Collapse</div>
          <div className="font-mono text-lg font-bold text-healthy">Expected</div>
        </div>
      </div>
    </div>
  );
};
