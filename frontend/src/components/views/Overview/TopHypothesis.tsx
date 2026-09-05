import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { AlertTriangle, CheckCircle, Crosshair } from 'lucide-react';
import { clsx } from 'clsx';

export const TopHypothesis: React.FC = () => {
  const { bundle } = useIncident();
  if (!bundle) return null;

  const analysis = bundle.causalAnalysis;
  const topCandidate = analysis?.hypotheses?.[0];
  const isValidated = bundle.status === 'VALIDATED' || bundle.status === 'COMPLETED';

  if (!topCandidate) {
    return (
      <div className="glass-panel p-6 flex flex-col items-center justify-center min-h-[200px] text-center">
        <Crosshair className="w-8 h-8 text-border mb-3" />
        <h3 className="text-sm font-semibold tracking-wide text-textMuted uppercase">No Hypothesis Yet</h3>
        <p className="text-xs text-textMuted/70 mt-2">Waiting for sufficient telemetry to form a causal hypothesis...</p>
      </div>
    );
  }

  const isHighConfidence = topCandidate.score > 30;

  return (
    <div className={clsx(
      "glass-panel p-6 border-l-4 transition-colors",
      isValidated ? "border-l-healthy" : (isHighConfidence ? "border-l-degraded" : "border-l-elevated")
    )}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[10px] text-textMuted uppercase tracking-widest mb-1">
            {isValidated ? 'Validated Root' : 'Top Hypothesis'}
          </h3>
          <div className="text-xl font-bold tracking-tight text-textMain flex items-center gap-2">
            {isValidated ? <CheckCircle className="w-5 h-5 text-healthy" /> : <AlertTriangle className="w-5 h-5 text-degraded" />}
            {topCandidate.serviceId} / <span className="text-degraded font-mono text-lg">{topCandidate.resource}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-textMuted uppercase tracking-widest mb-1">Confidence</div>
          <div className="text-2xl font-mono font-bold text-textMain">
            {Math.round(topCandidate.score)}<span className="text-sm text-textMuted">%</span>
          </div>
        </div>
      </div>
      
      <div className="space-y-3 mt-6">
        <div className="flex justify-between text-xs border-b border-border pb-2">
          <span className="text-textMuted">Propagation Depth</span>
          <span className="font-mono">
            {analysis?.reconstructedPaths?.find(p => p.hypothesisId === `${topCandidate.serviceId}/${topCandidate.resource}`)?.nodes.length || 0} hops
          </span>
        </div>
        <div className="flex justify-between text-xs border-b border-border pb-2">
          <span className="text-textMuted">Supporting Evidence</span>
          <span className="font-mono">{topCandidate.evidence.filter(e => e.isSupporting).length} points</span>
        </div>
      </div>
    </div>
  );
};
