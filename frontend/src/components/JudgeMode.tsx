import React, { useState } from 'react';
import { useUI } from '../lib/UIContext';
import { useIncident } from '../lib/IncidentContext';
import { Network, X, CheckCircle2, ShieldAlert, Gauge, Target, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { CausalGraph } from './views/CausalAnalysis/CausalGraph';
import { TopHypothesis } from './views/Overview/TopHypothesis';
import { ValidationResult } from './views/Validation/ValidationResult';
import { PredictionCard } from './views/Prediction/PredictionCard';

const SERVICE_OPTIONS = ['portal', 'appointment', 'records', 'notification'];
const RESOURCE_OPTIONS = ['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS'];
const SEVERITY_OPTIONS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const JudgeMode: React.FC = () => {
  const { setJudgeMode } = useUI();
  const { bundle, groundTruth, revealGroundTruth, startCustomIncident } = useIncident();
  const [serviceId, setServiceId] = useState('records');
  const [resource, setResource] = useState('MEMORY');
  const [severity, setSeverity] = useState('CRITICAL');
  const [seed, setSeed] = useState(() => `judge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!bundle) return null;

  const injectedTarget = `${serviceId}/${resource}`;
  const topHypothesis = bundle.causalAnalysis?.hypotheses?.[0];
  const currentTopCandidate = topHypothesis ? `${topHypothesis.serviceId}/${topHypothesis.resource}` : null;
  const isTopMatch = !!currentTopCandidate && currentTopCandidate === injectedTarget;
  const confidencePct = topHypothesis ? Math.round((topHypothesis.confidence ?? 0) * 100) : 0;
  const verdictText = groundTruth
    ? `${groundTruth.trueRootService}/${groundTruth.trueRootResource} — ${currentTopCandidate === `${groundTruth.trueRootService}/${groundTruth.trueRootResource}` ? 'MATCH' : 'MISMATCH'}`
    : null;

  const handleInject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await startCustomIncident(serviceId, resource, severity, seed);
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <div className="flex-1 glass-panel overflow-hidden relative shadow-2xl border-primary/20 w-full h-full min-h-[450px]">
          <div className="absolute top-4 left-4 z-10">
            <h2 className="text-sm font-semibold tracking-wider uppercase mb-1">Causal Architecture</h2>
            <p className="text-xs text-textMuted">Live dependency & propagation visualization</p>
          </div>
          <CausalGraph />
        </div>

        <div className="w-1/3 flex flex-col gap-6 overflow-y-auto">
          <div className={clsx(
            'glass-panel p-5 transition-all duration-300',
            isTopMatch && 'border border-healthy shadow-[0_0_18px_rgba(16,185,129,0.2)]'
          )}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-textMuted">Injected Fault</h3>
                <div className="mt-2 text-lg font-bold text-textMain">{serviceId} / {resource}</div>
              </div>
              <div className="rounded-full border border-border bg-surface px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-textMuted">
                {severity}
              </div>
            </div>

            <form onSubmit={handleInject} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[10px] uppercase tracking-[0.18em] text-textMuted">
                  Service
                  <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-textMain outline-none">
                    {SERVICE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>

                <label className="block text-[10px] uppercase tracking-[0.18em] text-textMuted">
                  Resource
                  <select value={resource} onChange={(e) => setResource(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-textMain outline-none">
                    {RESOURCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>

              <label className="block text-[10px] uppercase tracking-[0.18em] text-textMuted">
                Severity
                <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-textMain outline-none">
                  {SEVERITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>

              <label className="block text-[10px] uppercase tracking-[0.18em] text-textMuted">
                Seed
                <input value={seed} onChange={(e) => setSeed(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-textMain outline-none" />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-primary px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Injecting...</span>
                ) : (
                  'Inject & Run'
                )}
              </button>
            </form>

            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-textMuted">
                <span>Current tick</span>
                <span className="font-mono text-textMain">{bundle.playback.tick}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-textMuted">
                <span>Top hypothesis</span>
                <span className="font-mono text-textMain">{currentTopCandidate ?? 'waiting'}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-textMuted">
                <span>Confidence</span>
                <span className="font-mono text-textMain">{confidencePct}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface border border-border">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(4, confidencePct)}%` }} />
              </div>
            </div>
          </div>

          <TopHypothesis />
          {bundle.prediction && <PredictionCard prediction={bundle.prediction} />}
          {(bundle.status === 'VALIDATED' || bundle.status === 'COMPLETED') && (
            <ValidationResult />
          )}

          {groundTruth && (
            <div className="glass-panel border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-textMain">
                <Target className="w-4 h-4 text-primary" />
                Reveal Verdict
              </div>
              <div className={clsx(
                'mt-3 rounded-lg border px-4 py-3 text-center text-lg font-bold tracking-wide',
                currentTopCandidate === `${groundTruth.trueRootService}/${groundTruth.trueRootResource}`
                  ? 'border-healthy bg-healthy/10 text-healthy'
                  : 'border-critical bg-critical/10 text-critical'
              )}>
                Predicted: {currentTopCandidate ?? 'N/A'} — Actual: {groundTruth.trueRootService}/{groundTruth.trueRootResource} — {currentTopCandidate === `${groundTruth.trueRootService}/${groundTruth.trueRootResource}` ? 'MATCH' : 'MISMATCH'}
              </div>
              <button
                onClick={revealGroundTruth}
                className="mt-4 w-full rounded-lg border border-border bg-surface px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-textMain hover:bg-surfaceHover"
              >
                Reveal Ground Truth
              </button>
            </div>
          )}

          {!groundTruth && bundle.status === 'VALIDATED' && (
            <div className="glass-panel border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-textMain">
                <Gauge className="w-4 h-4 text-primary" />
                Reconciliation
              </div>
              <button
                onClick={revealGroundTruth}
                className="mt-4 w-full rounded-lg bg-info px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white hover:bg-blue-600"
              >
                Reveal Ground Truth
              </button>
            </div>
          )}

          {isTopMatch && (
            <div className="glass-panel border border-healthy bg-healthy/5 p-4 text-healthy">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em]">
                <CheckCircle2 className="w-4 h-4" />
                Top hypothesis matches injected fault
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
