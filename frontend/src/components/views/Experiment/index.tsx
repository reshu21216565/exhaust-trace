import React, { useState } from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { Beaker, ShieldAlert, CheckCircle2, RotateCcw } from 'lucide-react';

export const Experiment: React.FC = () => {
  const { bundle, runRootExperiment, runSymptomExperiment } = useIncident();
  const [symptomService, setSymptomService] = useState('api_gateway');
  const [symptomResource, setSymptomResource] = useState('MEMORY');
  const [showConfirmSymptom, setShowConfirmSymptom] = useState(false);

  if (!bundle || !bundle.prediction) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
        <Beaker className="w-12 h-12 text-border mb-4" />
        <h2 className="text-xl font-bold tracking-wide mb-2">Awaiting Frozen Prediction</h2>
        <p className="text-textMuted max-w-md">
          You must lock a prediction before running validation experiments.
        </p>
      </div>
    );
  }

  const { status, prediction } = bundle;
  const isRunning = status === 'EXPERIMENT_RUNNING';
  const hasRootValidation = !!bundle.rootValidation;

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 relative">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <Beaker className="w-5 h-5 text-primary" />
            Intervention Experiments
          </h2>
          <p className="text-sm text-textMuted mt-1">Execute targeted relief to validate the hypothesis</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* ROOT EXPERIMENT */}
        <div className="glass-panel p-6 flex flex-col h-full border-t-4 border-t-primary">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle2 className="w-6 h-6 text-primary" />
            <div>
              <h3 className="text-lg font-bold tracking-wide uppercase">Test Root Hypothesis</h3>
              <p className="text-xs text-textMuted mt-1">Relieve the suspected root resource</p>
            </div>
          </div>

          <div className="bg-surface/50 border border-border rounded-lg p-4 mb-6">
            <span className="text-[10px] text-textMuted uppercase tracking-widest block mb-1">Target</span>
            <div className="font-mono font-bold text-lg">{prediction.rootServiceId} / {prediction.rootResource}</div>
          </div>

          <div className="mb-6 flex-1">
            <h4 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Expected Result</h4>
            <div className="text-sm text-textMain space-y-2">
              <p>• Root resource pressure drops to baseline.</p>
              <p>• Downstream queues drain and latency recovers.</p>
              <p>• Cascade effect collapses entirely.</p>
            </div>
          </div>

          {!hasRootValidation ? (
            <button
              onClick={runRootExperiment}
              disabled={isRunning || status === 'IDLE' || status === 'RUNNING'}
              className="w-full py-4 bg-primary hover:bg-primaryHover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold tracking-widest transition-colors flex justify-center items-center gap-2"
            >
              {isRunning ? <RotateCcw className="w-5 h-5 animate-spin" /> : <Beaker className="w-5 h-5" />}
              {isRunning ? 'EXPERIMENT RUNNING...' : 'RUN ROOT EXPERIMENT'}
            </button>
          ) : (
            <div className="w-full py-4 bg-surface border border-healthy/30 text-healthy rounded-lg font-bold tracking-widest flex justify-center items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              ROOT EXPERIMENT COMPLETE
            </div>
          )}
        </div>

        {/* SYMPTOM EXPERIMENT */}
        <div className="glass-panel p-6 flex flex-col h-full border-t-4 border-t-degraded">
          <div className="flex items-center gap-3 mb-6">
            <ShieldAlert className="w-6 h-6 text-degraded" />
            <div>
              <h3 className="text-lg font-bold tracking-wide uppercase">Test Symptom</h3>
              <p className="text-xs text-textMuted mt-1">Attempt to relieve a downstream symptom</p>
            </div>
          </div>

          <div className="bg-surface/50 border border-border rounded-lg p-4 mb-6 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-textMuted uppercase tracking-widest block mb-1">Service</label>
              <select 
                value={symptomService}
                onChange={e => setSymptomService(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none"
              >
                {bundle.dependencyGraph?.nodes.map(s => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-textMuted uppercase tracking-widest block mb-1">Resource</label>
              <select
                value={symptomResource}
                onChange={e => setSymptomResource(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none"
              >
                <option value="MEMORY">MEMORY</option>
                <option value="CPU">CPU</option>
                <option value="CONNECTIONS">CONNECTIONS</option>
                <option value="WORKERS">WORKERS</option>
              </select>
            </div>
          </div>

          <div className="mb-6 flex-1">
            <h4 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Expected Result</h4>
            <div className="text-sm text-textMain space-y-2">
              <p>• Symptom may temporarily alleviate.</p>
              <p>• True root exhaustion persists unchanged.</p>
              <p>• Cascade effect quickly returns or shifts.</p>
            </div>
          </div>

          {!showConfirmSymptom ? (
            <button
              onClick={() => setShowConfirmSymptom(true)}
              disabled={isRunning || !hasRootValidation}
              className="w-full py-4 bg-surface hover:bg-surfaceHover border border-border disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold tracking-widest transition-colors flex justify-center items-center gap-2"
            >
              <ShieldAlert className="w-5 h-5" />
              TEST SYMPTOM
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-degraded text-center mb-2">
                This will restore the exact snapshot taken at prediction lock and apply the symptom relief instead.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirmSymptom(false)}
                  className="flex-1 py-3 bg-surface hover:bg-surfaceHover border border-border rounded-lg text-xs font-bold tracking-widest"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => {
                    runSymptomExperiment(symptomService, symptomResource);
                    setShowConfirmSymptom(false);
                  }}
                  className="flex-1 py-3 bg-degraded hover:bg-orange-500 text-white rounded-lg text-xs font-bold tracking-widest flex justify-center items-center gap-2"
                >
                  CONFIRM RUN
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
