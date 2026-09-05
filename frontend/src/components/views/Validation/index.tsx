import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { useUI } from '../../../lib/UIContext';
import { CheckCircle2, ShieldAlert, Beaker, ArrowRight } from 'lucide-react';
import { ValidationResult } from './ValidationResult';

export const Validation: React.FC = () => {
  const { bundle, groundTruth, revealGroundTruth, completeIncident, runRootExperiment } = useIncident();
  const { setActiveTab } = useUI();

  if (!bundle || (!bundle.rootValidation && !bundle.symptomValidation)) {
    const hasPrediction = !!bundle?.prediction;
    const isFrozen = bundle?.status === 'PREDICTION_LOCKED' || bundle?.status === 'EXPERIMENT_RUNNING';

    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-xl mx-auto">
        <div className="w-16 h-16 rounded-full bg-healthy/10 border border-healthy/30 flex items-center justify-center mb-6">
          <CheckCircle2 className="w-8 h-8 text-healthy" />
        </div>
        <h2 className="text-2xl font-bold tracking-wide mb-2">Awaiting Experiment Validation</h2>
        <p className="text-textMuted text-sm mb-8 leading-relaxed">
          Validation results are generated after executing an intervention experiment. Compare predicted recovery curves against actual post-relief telemetry.
        </p>

        <div className="glass-panel p-6 w-full mb-8 text-left space-y-4">
          <div className="text-xs uppercase font-mono text-textMuted tracking-wider font-bold mb-2">REQUIRED WORKFLOW STEPS</div>
          
          <div className="flex items-center justify-between text-sm p-3 rounded bg-surface/50 border border-border">
            <span className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded-full text-xs font-mono flex items-center justify-center font-bold ${hasPrediction ? 'bg-healthy/20 text-healthy border border-healthy/30' : 'bg-surface text-textMuted border border-border'}`}>1</span>
              <span>Generate Prediction</span>
            </span>
            <span className="font-mono text-xs">{hasPrediction ? 'COMPLETED' : 'PENDING'}</span>
          </div>

          <div className="flex items-center justify-between text-sm p-3 rounded bg-surface/50 border border-border">
            <span className="flex items-center gap-3">
              <span className={`w-5 h-5 rounded-full text-xs font-mono flex items-center justify-center font-bold ${isFrozen ? 'bg-healthy/20 text-healthy border border-healthy/30' : 'bg-surface text-textMuted border border-border'}`}>2</span>
              <span>Freeze Prediction</span>
            </span>
            <span className="font-mono text-xs">{isFrozen ? 'FROZEN' : 'NOT FROZEN'}</span>
          </div>

          <div className="flex items-center justify-between text-sm p-3 rounded bg-surface/50 border border-border">
            <span className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full text-xs font-mono flex items-center justify-center font-bold bg-primary/20 text-primary border border-primary/30">3</span>
              <span>Run Intervention Experiment</span>
            </span>
            <span className="font-mono text-xs text-primary font-bold">NEXT STEP</span>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('Experiment')}
          className="px-8 py-4 bg-primary hover:bg-primaryHover text-white rounded-lg shadow-lg font-bold tracking-widest flex items-center gap-3 transition-colors text-sm"
        >
          <Beaker className="w-4 h-4" />
          GO TO EXPERIMENT TAB TO RUN INTERVENTION
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
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
        {bundle.rootTrajectory && (
          <div className="px-3 py-1 bg-surface border border-border rounded text-xs font-mono text-textMuted flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-healthy animate-pulse" />
            VALIDATED AT TICK #{bundle.rootTrajectory.endTick}
          </div>
        )}
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
