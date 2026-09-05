import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { ValidationResult } from './ValidationResult';

export const Validation: React.FC = () => {
  const { bundle, groundTruth, revealGroundTruth, completeIncident } = useIncident();

  if (!bundle || (!bundle.rootValidation && !bundle.symptomValidation)) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-12 h-12 text-border mb-4" />
        <h2 className="text-xl font-bold tracking-wide mb-2">Awaiting Experiment Validation</h2>
        <p className="text-textMuted max-w-md">
          Run an experiment to validate the counterfactual prediction.
        </p>
      </div>
    );
  }

  const topH = bundle.causalAnalysis?.hypotheses?.[0];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-healthy" />
            Prediction Validation
          </h2>
          <p className="text-sm text-textMuted mt-1">Comparing predicted recovery against actual experiment trajectory</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full flex flex-col gap-6">
        <ValidationResult />

        {/* Reveal Ground Truth Section */}
        <div className="glass-panel p-8 text-center border-t-4 border-t-info mt-6">
          {!groundTruth ? (
            <>
              <h3 className="text-lg font-bold tracking-wide mb-4 uppercase">System Conclusion Reached</h3>
              <p className="text-sm text-textMuted max-w-2xl mx-auto mb-8">
                ExhaustTrace reached this conclusion via causal inference over observable telemetry only —
                no access to hidden injected state. Reveal the ground truth to verify accuracy.
              </p>
              
              <div className="flex justify-center gap-4">
                {bundle.status === 'VALIDATED' && (
                  <button
                    onClick={completeIncident}
                    className="px-6 py-3 bg-surface border border-border hover:bg-surfaceHover rounded-lg text-sm font-bold tracking-widest transition-colors"
                  >
                    COMPLETE INCIDENT
                  </button>
                )}
                <button
                  onClick={revealGroundTruth}
                  className="px-8 py-3 bg-info hover:bg-blue-600 text-white rounded-lg text-sm font-bold tracking-widest transition-colors flex items-center gap-2"
                >
                  <ShieldAlert className="w-4 h-4" />
                  REVEAL GROUND TRUTH
                </button>
              </div>
            </>
          ) : (
            <div>
              <h3 className="text-[10px] text-info uppercase tracking-widest mb-6">Explicit Ground Truth Reveal</h3>
              
              <div className="grid grid-cols-2 max-w-3xl mx-auto gap-8 mb-8">
                <div className="bg-surface border border-border rounded-lg p-6">
                  <div className="text-[10px] text-textMuted uppercase tracking-widest mb-2">System Conclusion</div>
                  <div className="text-xl font-bold text-textMain">{topH?.serviceId} / {topH?.resource}</div>
                </div>
                <div className="bg-surface border border-info/50 rounded-lg p-6 relative overflow-hidden">
                  <div className="absolute inset-0 bg-info/5 pointer-events-none" />
                  <div className="text-[10px] text-info uppercase tracking-widest mb-2">Hidden Injected Root</div>
                  <div className="text-xl font-bold text-textMain">{groundTruth.trueRootService} / {groundTruth.trueRootResource}</div>
                </div>
              </div>

              <div className="flex justify-center">
                {(topH?.serviceId === groundTruth.trueRootService && topH?.resource === groundTruth.trueRootResource) ? (
                  <div className="px-8 py-4 bg-healthy/20 border border-healthy text-healthy rounded-full font-bold tracking-widest flex items-center gap-3 text-lg">
                    <CheckCircle2 className="w-6 h-6" />
                    EXACT MATCH — Inference Verified
                  </div>
                ) : (
                  <div className="px-8 py-4 bg-critical/20 border border-critical text-critical rounded-full font-bold tracking-widest flex items-center gap-3 text-lg">
                    <ShieldAlert className="w-6 h-6" />
                    MISMATCH
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
