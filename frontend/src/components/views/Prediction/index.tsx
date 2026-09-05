import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { FastForward, Lock } from 'lucide-react';
import { PredictionCard } from './PredictionCard';

export const Prediction: React.FC = () => {
  const { bundle, lockPrediction } = useIncident();

  if (!bundle) return null;

  const prediction = bundle.prediction;
  const isLocked = bundle.status === 'PREDICTION_LOCKED' || 
                   bundle.status === 'EXPERIMENT_RUNNING' || 
                   bundle.status === 'VALIDATED' || 
                   bundle.status === 'COMPLETED';

  if (!prediction) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
        <FastForward className="w-12 h-12 text-border mb-4" />
        <h2 className="text-xl font-bold tracking-wide mb-2">Awaiting Counterfactual Prediction</h2>
        <p className="text-textMuted max-w-md">
          The prediction engine requires a dominant hypothesis before it can compute a counterfactual recovery trajectory.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <FastForward className="w-5 h-5 text-primary" />
            Counterfactual Prediction
          </h2>
          <p className="text-sm text-textMuted mt-1">Predicted trajectory if the suspected root resource is relieved</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto w-full flex flex-col gap-6">
        <PredictionCard prediction={prediction} />

        {!isLocked && (
          <div className="flex justify-center">
            <button
              onClick={lockPrediction}
              className="px-8 py-4 bg-primary hover:bg-primaryHover text-white rounded-lg shadow-lg font-bold tracking-widest flex items-center gap-3 transition-colors"
            >
              <Lock className="w-5 h-5" />
              FREEZE PREDICTION BEFORE INTERVENTION
            </button>
          </div>
        )}

        {isLocked && (
          <div className="flex justify-center">
            <div className="px-6 py-3 bg-surface border border-primary/30 rounded-lg text-sm text-primary font-mono flex items-center gap-3">
              <Lock className="w-4 h-4" />
              PREDICTION FROZEN — READY FOR EXPERIMENT
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
