import React, { useMemo, useState, useEffect } from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { Beaker, ShieldAlert, CheckCircle2, RotateCcw, TrendingDown, Lock, ArrowRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';

const summarizeTrajectory = (trajectory: any) => {
  if (!trajectory?.checkpoints?.length) return [];

  return trajectory.checkpoints.map((checkpoint: any) => {
    const metrics = Object.values(checkpoint.metrics ?? {}) as any[];
    const latency = metrics.reduce((sum, svc) => sum + (svc?.latencyMs ?? 0), 0) / Math.max(metrics.length, 1);
    const queue = metrics.reduce((sum, svc) => sum + (svc?.queueDepth ?? 0), 0) / Math.max(metrics.length, 1);
    return {
      tick: checkpoint.relativeTick,
      impact: latency + queue * 2,
      avgLatency: latency,
      avgQueue: queue,
    };
  });
};

export const Experiment: React.FC = () => {
  const { bundle, runRootExperiment, runSymptomExperiment, lockPrediction } = useIncident();
  const [symptomService, setSymptomService] = useState('api_gateway');
  const [symptomResource, setSymptomResource] = useState('MEMORY');
  const [showConfirmSymptom, setShowConfirmSymptom] = useState(false);
  const [isRunningRootExperiment, setIsRunningRootExperiment] = useState(false);
  const [isRunningSymptomExperiment, setIsRunningSymptomExperiment] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  const availableNodes = bundle?.dependencyGraph?.nodes || [];

  useEffect(() => {
    if (availableNodes.length > 0) {
      if (!availableNodes.some(n => n.id === symptomService)) {
        const nonRoot = availableNodes.find(n => n.id !== bundle?.prediction?.rootServiceId) || availableNodes[0];
        setSymptomService(nonRoot.id);
      }
    }
  }, [availableNodes, bundle?.prediction?.rootServiceId, symptomService]);

  const rootReplay = useMemo(() => summarizeTrajectory(bundle?.rootTrajectory), [bundle?.rootTrajectory]);
  const symptomReplay = useMemo(() => summarizeTrajectory(bundle?.symptomTrajectory), [bundle?.symptomTrajectory]);

  const rootState = useMemo(() => {
    if (!rootReplay.length) return { label: 'Awaiting experiment', tone: 'text-textMuted' };
    if (bundle?.rootValidation) {
      const score = bundle.rootValidation.cascadeCollapseScore;
      if (score >= 0.7) return { label: `COLLAPSED (${(score * 100).toFixed(0)}% RELIEF)`, tone: 'text-healthy' };
      if (score >= 0.3) return { label: `PARTIAL (${(score * 100).toFixed(0)}% RELIEF)`, tone: 'text-elevated' };
      return { label: `FAILED (${(score * 100).toFixed(0)}% RELIEF)`, tone: 'text-degraded' };
    }
    const first = rootReplay[0]?.impact ?? 0;
    const last = rootReplay[rootReplay.length - 1]?.impact ?? 0;
    const collapsed = last <= first * 0.5;
    return collapsed
      ? { label: 'COLLAPSED', tone: 'text-healthy' }
      : { label: 'PARTIAL', tone: 'text-elevated' };
  }, [rootReplay, bundle?.rootValidation]);

  const symptomState = useMemo(() => {
    if (!symptomReplay.length) return { label: 'Run symptom experiment to compare', tone: 'text-textMuted' };
    if (bundle?.symptomValidation) {
      const score = bundle.symptomValidation.cascadeCollapseScore;
      if (score >= 0.7) return { label: `COLLAPSED (${(score * 100).toFixed(0)}% RELIEF)`, tone: 'text-healthy' };
      if (score >= 0.3) return { label: `PARTIAL RELIEF (${(score * 100).toFixed(0)}% RELIEF)`, tone: 'text-elevated' };
      return { label: `PERSISTED (${((1 - score) * 100).toFixed(0)}% PRESSURE)`, tone: 'text-degraded' };
    }
    const first = symptomReplay[0]?.impact ?? 0;
    const last = symptomReplay[symptomReplay.length - 1]?.impact ?? 0;
    if (last <= first * 0.5) return { label: 'COLLAPSED', tone: 'text-healthy' };
    if (last <= first * 0.85) return { label: 'PARTIAL RELIEF', tone: 'text-elevated' };
    return { label: 'PERSISTED', tone: 'text-degraded' };
  }, [symptomReplay, bundle?.symptomValidation]);

  if (!bundle || !bundle.prediction) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-lg mx-auto">
        <Beaker className="w-12 h-12 text-primary/70 mb-4 animate-pulse" />
        <h2 className="text-xl font-bold tracking-wide mb-2">Awaiting Counterfactual Prediction</h2>
        <p className="text-textMuted text-sm mb-6 leading-relaxed">
          Intervention experiments require a computed prediction trajectory. Once top hypothesis confidence exceeds 10% (around tick 15), prediction will populate automatically.
        </p>
        <div className="glass-panel p-4 w-full text-xs text-textMuted font-mono border-l-4 border-l-primary flex items-center justify-between">
          <span>PIPELINE STATUS</span>
          <span className="text-primary font-bold">WAITING FOR PREDICTION ENGINE</span>
        </div>
      </div>
    );
  }

  const isPredictionFrozen = bundle.status === 'PREDICTION_LOCKED' || 
                             bundle.status === 'EXPERIMENT_RUNNING' || 
                             bundle.status === 'VALIDATED' || 
                             bundle.status === 'COMPLETED';

  if (!isPredictionFrozen) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-xl mx-auto">
        <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-6">
          <Lock className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-wide mb-2">Prediction Ready — Action Required</h2>
        <p className="text-textMuted text-sm mb-8 leading-relaxed">
          A counterfactual prediction has been generated for candidate <span className="font-mono text-textMain font-bold">{bundle.prediction.rootServiceId} / {bundle.prediction.rootResource}</span>. Freeze the prediction snapshot to unlock intervention testing.
        </p>

        <button
          onClick={async () => {
            if (isLocking) return;
            setIsLocking(true);
            try {
              await lockPrediction();
            } finally {
              setIsLocking(false);
            }
          }}
          disabled={isLocking}
          className="px-8 py-4 bg-primary hover:bg-primaryHover disabled:opacity-60 text-white rounded-lg shadow-lg font-bold tracking-widest flex items-center gap-3 transition-colors text-sm"
        >
          <Lock className="w-4 h-4" />
          {isLocking ? 'FREEZING PREDICTION...' : 'FREEZE PREDICTION & UNLOCK EXPERIMENTS'}
          <ArrowRight className="w-4 h-4 ml-1" />
        </button>
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
        {bundle.rootTrajectory && (
          <div className="px-3 py-1 bg-surface border border-border rounded text-xs font-mono text-textMuted flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-healthy animate-pulse" />
            EXECUTED TICK #{bundle.rootTrajectory.startTick} – #{bundle.rootTrajectory.endTick}
          </div>
        )}
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
              onClick={async () => {
                if (isRunningRootExperiment || isRunning) return;
                setIsRunningRootExperiment(true);
                try {
                  await runRootExperiment();
                } finally {
                  setIsRunningRootExperiment(false);
                }
              }}
              disabled={isRunningRootExperiment || isRunning || isRunningSymptomExperiment || status === 'IDLE' || status === 'RUNNING'}
              className="w-full py-4 bg-primary hover:bg-primaryHover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold tracking-widest transition-colors flex justify-center items-center gap-2"
            >
              {isRunningRootExperiment || isRunning ? <RotateCcw className="w-5 h-5 animate-spin" /> : <Beaker className="w-5 h-5" />}
              {isRunningRootExperiment || isRunning ? 'EXPERIMENT RUNNING...' : 'RUN ROOT EXPERIMENT'}
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
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none font-mono"
              >
                {availableNodes.map(s => (
                  <option key={s.id} value={s.id}>{s.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-textMuted uppercase tracking-widest block mb-1">Resource</label>
              <select
                value={symptomResource}
                onChange={e => setSymptomResource(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm outline-none font-mono"
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
              disabled={isRunning || isRunningSymptomExperiment || isRunningRootExperiment || status === 'IDLE' || status === 'RUNNING'}
              className="w-full py-4 bg-surface hover:bg-surfaceHover border border-border disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold tracking-widest transition-colors flex justify-center items-center gap-2 text-degraded"
            >
              <ShieldAlert className="w-5 h-5 text-degraded" />
              TEST SYMPTOM
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-degraded text-center mb-2">
                This will restore the pre-intervention snapshot and apply relief to <span className="font-mono font-bold text-textMain">{symptomService} / {symptomResource}</span>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirmSymptom(false)}
                  disabled={isRunningSymptomExperiment}
                  className="flex-1 py-3 bg-surface hover:bg-surfaceHover border border-border rounded-lg text-xs font-bold tracking-widest"
                >
                  CANCEL
                </button>
                <button
                  onClick={async () => {
                    if (isRunningSymptomExperiment || isRunning) return;
                    setIsRunningSymptomExperiment(true);
                    try {
                      await runSymptomExperiment(symptomService, symptomResource);
                    } finally {
                      setIsRunningSymptomExperiment(false);
                      setShowConfirmSymptom(false);
                    }
                  }}
                  disabled={isRunningSymptomExperiment || isRunning}
                  className="flex-1 py-3 bg-degraded hover:bg-orange-500 text-white rounded-lg text-xs font-bold tracking-widest flex justify-center items-center gap-2"
                >
                  {isRunningSymptomExperiment ? <RotateCcw className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                  {isRunningSymptomExperiment ? 'RUNNING...' : 'CONFIRM RUN'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="glass-panel p-6 border-t-4 border-t-info">
        <div className="flex items-center gap-3 mb-6">
          <TrendingDown className="w-6 h-6 text-info" />
          <div>
            <h3 className="text-lg font-bold tracking-wide uppercase">Counterfactual Replay</h3>
            <p className="text-xs text-textMuted mt-1">Compare the true-origin relief against a symptomatic-service intervention</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-textMuted">Left panel</p>
                <h4 className="text-sm font-bold">Relief at true origin</h4>
                <p className="text-xs font-mono text-primary mt-0.5">{prediction.rootServiceId} / {prediction.rootResource}</p>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${rootState.tone}`}>{rootState.label}</span>
            </div>
            {rootReplay.length ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rootReplay}>
                    <defs>
                      <linearGradient id="rootReplayFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22C55E" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#22C55E" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="tick" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      labelStyle={{ color: '#9CA3AF', fontSize: '12px' }}
                      itemStyle={{ color: '#F9FAFB', fontSize: '12px', fontFamily: 'monospace' }}
                    />
                    <Area type="monotone" dataKey="impact" stroke="#22C55E" strokeWidth={3} fill="url(#rootReplayFill)" isAnimationActive />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center border border-dashed border-border rounded-lg text-xs text-textMuted">
                Awaiting root experiment data
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-textMuted">Right panel</p>
                <h4 className="text-sm font-bold">Relief at a symptomatic service</h4>
                <p className="text-xs font-mono text-degraded mt-0.5">{bundle.symptomValidation?.target || `${symptomService} / ${symptomResource}`}</p>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${symptomState.tone}`}>{symptomState.label}</span>
            </div>
            {symptomReplay.length ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={symptomReplay}>
                    <defs>
                      <linearGradient id="symptomReplayFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F97316" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#F97316" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="tick" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      labelStyle={{ color: '#9CA3AF', fontSize: '12px' }}
                      itemStyle={{ color: '#F9FAFB', fontSize: '12px', fontFamily: 'monospace' }}
                    />
                    <Area type="monotone" dataKey="impact" stroke="#F97316" strokeWidth={3} fill="url(#symptomReplayFill)" isAnimationActive />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center border border-dashed border-border rounded-lg text-xs text-textMuted">
                Run a symptom experiment to compare
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
