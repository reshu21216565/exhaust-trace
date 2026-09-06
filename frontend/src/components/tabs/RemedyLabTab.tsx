import React, { useState, useEffect } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { useUI } from '../../lib/UIContext';
import { ResponsiveHeroBanner } from '../ui/responsive-hero-banner';
import {
  FlaskConical, Wrench, Sparkles, CheckCircle2, ShieldAlert,
  ArrowRight, Play, RefreshCw, ChevronDown, ChevronUp, AlertTriangle,
  HelpCircle, Bot, Zap, Activity, Check, X, Shield, Lock, Send, Loader2, Terminal
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { clsx } from 'clsx';
import type { RemedyProposal, RemedySimulationResult, RemedyComparison } from '@exhausttrace/shared';

const API_BASE = 'http://localhost:3001/api/v1/remedy';

export const RemedyLabTab: React.FC = () => {
  const { bundle } = useIncident();
  const { setActiveTab, setSelectedRemedyForFix } = useUI();
  const [proposals, setProposals] = useState<RemedyProposal[]>([]);

  const [simulations, setSimulations] = useState<Record<string, RemedySimulationResult>>({});
  const [selectedRemedy, setSelectedRemedy] = useState<RemedyProposal | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSimulating, setIsSimulating] = useState<string | null>(null);
  const [geminiAvailable, setGeminiAvailable] = useState<boolean>(true);
  const [expandedRationale, setExpandedRationale] = useState<Record<string, boolean>>({});

  // Ask Gemini State
  const [askQuestion, setAskQuestion] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  // Apply Modal State
  const [applyModalProposal, setApplyModalProposal] = useState<RemedyProposal | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSuccess, setAppliedSuccess] = useState<string | null>(null);

  const [activeMetricTab, setActiveMetricTab] = useState<'pressure' | 'latency' | 'timeouts' | 'queue'>('pressure');
  const simulatorRef = React.useRef<HTMLDivElement>(null);

  // Fetch or generate initial proposals on load
  useEffect(() => {
    if (bundle?.remedyProposals && bundle.remedyProposals.length > 0) {
      setProposals(bundle.remedyProposals);
    }
  }, [bundle]);

  const handleGenerateRemedies = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setProposals(data.proposals || []);
        setGeminiAvailable(data.geminiAvailable ?? true);
        if (data.proposals && data.proposals.length > 0) {
          setSelectedRemedy(data.proposals[0]);
        }
      }
    } catch (err) {
      console.error('Failed to generate remedies:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSimulateRemedy = async (proposal: RemedyProposal) => {
    setIsSimulating(proposal.id);
    try {
      const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal }),
      });
      if (res.ok) {
        const data = await res.json();
        setSimulations(prev => ({ ...prev, [proposal.id]: data.simulation }));
        setSelectedRemedy(proposal);

        setTimeout(() => {
          if (simulatorRef.current) {
            simulatorRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }, 100);
      }
    } catch (err) {
      console.error('Failed to simulate remedy:', err);
    } finally {
      setIsSimulating(null);
    }
  };

  const handleAskGemini = async () => {
    if (!askQuestion.trim() || isAsking) return;
    setIsAsking(true);
    setAskAnswer(null);
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: askQuestion }),
      });
      if (res.ok) {
        const data = await res.json();
        setAskAnswer(data.answer);
      }
    } catch (err) {
      setAskAnswer('Failed to consult Remedy Advisor. Please try again.');
    } finally {
      setIsAsking(false);
    }
  };

  const handleConfirmApply = async () => {
    if (!applyModalProposal) return;
    setIsApplying(true);
    try {
      const res = await fetch(`${API_BASE}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: applyModalProposal.id, confirmed: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setAppliedSuccess(data.message || `Successfully applied ${applyModalProposal.title}`);
        setApplyModalProposal(null);
      }
    } catch (err) {
      console.error('Failed to apply remedy:', err);
    } finally {
      setIsApplying(false);
    }
  };

  const toggleRationale = (id: string) => {
    setExpandedRationale(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Derive current incident summary from evidence bundle
  const topCandidate = bundle?.causalAnalysis?.hypotheses?.[0];
  const rootCauseText = topCandidate ? `${topCandidate.serviceId} / ${topCandidate.resource}` : 'Records / MEMORY';
  const confidencePercent = topCandidate ? Math.round(topCandidate.confidence * 100) : 91;
  const propagationNodes = bundle?.causalAnalysis?.reconstructedPaths?.[0]?.nodes || [
    { serviceId: 'records', observedCondition: 'MEMORY CRITICAL' },
    { serviceId: 'records', observedCondition: 'LATENCY_DEGRADED' },
    { serviceId: 'appointment', observedCondition: 'TIMEOUT_SPIKE' },
    { serviceId: 'appointment', observedCondition: 'RETRY_SURGE' },
    { serviceId: 'portal', observedCondition: 'QUEUE_GROWTH' }
  ];

  // Chart data for simulation comparison
  const activeSim = selectedRemedy ? simulations[selectedRemedy.id] : null;
  const chartData = activeSim ? activeSim.trajectory.map(pt => ({
    tick: pt.relativeTick,
    rootPressure: Math.round(pt.rootPressure * 100),
    rootLatency: Math.round(pt.rootLatency),
    downstreamLatency: Math.round(pt.downstreamLatency),
    timeoutRate: Math.round(pt.timeoutRate * 100),
    queueDepth: Math.round(pt.queueDepth),
    baselinePressure: Math.round((pt.baselineRootPressure ?? 0.95) * 100),
    baselineLatency: Math.round(pt.baselineRootLatency ?? 500),
    baselineTimeout: Math.round((pt.baselineTimeoutRate ?? 0.12) * 100),
    baselineQueue: Math.round(pt.baselineQueueDepth ?? 25),
  })) : [];

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-[#09090b] text-white space-y-8">
      {/* Hero Banner Component */}
      <ResponsiveHeroBanner
        badgeLabel="REMEDY LAB"
        badgeText="AI Incident Resolution Laboratory"
        title="From Root Cause to"
        titleLine2="Tested Resolution"
        description="Test proposed remediation strategies against an isolated simulation fork of the incident state before applying changes to production."
        primaryButtonText={isGenerating ? "Generating Remedies..." : "Generate AI Remedy Plan"}
        secondaryButtonText="Compare Remedies"
        onPrimaryClick={handleGenerateRemedies}
        onSecondaryClick={handleGenerateRemedies}
      />

      {/* Applied Remedy Notification Banner */}
      {appliedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-sm font-mono">{appliedSuccess}</span>
          </div>
          <button onClick={() => setAppliedSuccess(null)} className="text-emerald-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Current Incident Summary Panel */}
      <div className="glass-panel p-6 border border-amber-500/20 bg-amber-950/10 rounded-2xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-amber-500/20">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 uppercase tracking-widest mb-1">
              <FlaskConical className="w-4 h-4" /> CURRENT VALIDATED INCIDENT
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-3">
              Root Cause: <span className="text-amber-400">{rootCauseText}</span>
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-mono font-bold uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> Status: CRITICAL
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
              Causal Confidence: {confidencePercent}%
            </div>
          </div>
        </div>

        {/* Propagation Chain */}
        <div>
          <span className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest block mb-2">
            Propagation Path & Cascade Chain
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {propagationNodes.map((node, i) => (
              <React.Fragment key={i}>
                <div className="px-3 py-1.5 rounded-lg bg-neutral-900 border border-amber-500/30 text-xs font-mono flex items-center gap-2">
                  <span className="font-bold text-amber-400">{node.serviceId}</span>
                  <span className="text-neutral-400 text-[10px]">({node.observedCondition})</span>
                </div>
                {i < propagationNodes.length - 1 && (
                  <ArrowRight className="w-3.5 h-3.5 text-amber-500/60" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* AI Remediation Planner Header & Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            AI Remediation Planner
          </h2>
          <p className="text-xs text-neutral-400 font-mono mt-0.5">
            Gemini proposals categorized into Mitigate, Fix, and Prevent — grounded strictly in telemetry evidence.
          </p>
        </div>

        <button
          onClick={handleGenerateRemedies}
          disabled={isGenerating}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-neutral-950 rounded-xl font-bold text-xs font-mono transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {isGenerating ? 'Generating...' : 'Refresh Remedies'}
        </button>
      </div>

      {/* Three Remedy Category Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {proposals.length === 0 ? (
          <div className="col-span-3 py-12 text-center glass-panel border border-amber-500/20 rounded-2xl">
            <Wrench className="w-10 h-10 mx-auto mb-3 text-amber-400/40 animate-pulse" />
            <h3 className="text-base font-bold text-white">No Remedy Proposals Generated Yet</h3>
            <p className="text-xs text-neutral-400 font-mono mt-1 mb-4">Click "Generate AI Remedy Plan" above to analyze the incident and test solutions.</p>
            <button
              onClick={handleGenerateRemedies}
              className="px-5 py-2.5 bg-amber-500 text-neutral-950 font-bold rounded-xl text-xs font-mono hover:bg-amber-400 transition-colors"
            >
              Generate Remedies Now
            </button>
          </div>
        ) : (
          proposals.map(proposal => {
            const isSelected = selectedRemedy?.id === proposal.id;
            const simResult = simulations[proposal.id];
            const isExp = expandedRationale[proposal.id];

            return (
              <div
                key={proposal.id}
                className={clsx(
                  'rounded-2xl p-6 transition-all border flex flex-col justify-between relative',
                  proposal.category === 'MITIGATE' && 'bg-amber-950/20 border-amber-500/40 hover:border-amber-400',
                  proposal.category === 'FIX' && 'bg-orange-950/30 border-orange-500/60 shadow-lg shadow-orange-500/10 hover:border-orange-400',
                  proposal.category === 'PREVENT' && 'bg-neutral-900/60 border-neutral-700/60 hover:border-neutral-500',
                  isSelected && 'ring-2 ring-amber-400'
                )}
              >
                <div>
                  {/* Category Badge & Simulatable status */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={clsx(
                      'px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase',
                      proposal.category === 'MITIGATE' && 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
                      proposal.category === 'FIX' && 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
                      proposal.category === 'PREVENT' && 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                    )}>
                      {proposal.category}
                    </span>

                    <span className={clsx(
                      'text-[9px] font-mono font-bold px-2 py-0.5 rounded border',
                      proposal.simulatable
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                    )}>
                      {proposal.simulatable ? 'SIMULATABLE' : 'ADVISORY ONLY'}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-2 tracking-tight">{proposal.title}</h3>
                  <p className="text-xs text-neutral-300 font-mono mb-4 leading-relaxed">{proposal.description}</p>

                  {/* Benefit & Risk Tags */}
                  <div className="space-y-2 mb-4 text-xs font-mono">
                    {proposal.expectedBenefit && (
                      <div className="flex items-start gap-1.5 text-amber-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>{proposal.expectedBenefit}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-2 border-t border-neutral-800">
                      <span>Risk Level: <strong className="text-neutral-200">{proposal.risk}</strong></span>
                      <span>Confidence: <strong className="text-amber-400">{Math.round(proposal.confidence * 100)}%</strong></span>
                    </div>
                  </div>

                  {/* Why This Fix Accordion */}
                  <div className="mb-4 bg-neutral-950/60 rounded-xl border border-neutral-800 p-3">
                    <button
                      onClick={() => toggleRationale(proposal.id)}
                      className="w-full flex items-center justify-between text-xs font-mono font-bold text-amber-400 text-left hover:text-amber-300"
                    >
                      <span>WHY THIS FIX?</span>
                      {isExp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isExp && (
                      <div className="mt-2 text-[11px] font-mono text-neutral-300 space-y-2 border-t border-neutral-800/80 pt-2">
                        <p className="leading-relaxed">{proposal.rationale}</p>
                        {proposal.evidenceReferences.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <span className="text-[10px] text-amber-400 uppercase">Grounded Evidence:</span>
                            {proposal.evidenceReferences.map((ref, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-neutral-400">
                                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span>{ref}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="space-y-2 pt-2 border-t border-neutral-800">
                  {proposal.simulatable ? (
                    <button
                      onClick={() => handleSimulateRemedy(proposal)}
                      disabled={isSimulating === proposal.id}
                      className={clsx(
                        'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-mono font-bold transition-all shadow',
                        isSelected && simResult
                          ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950'
                          : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                      )}
                    >
                      {isSimulating === proposal.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      {simResult ? 'Re-simulate Remedy' : 'SIMULATE REMEDY'}
                    </button>
                  ) : (
                    <div className="text-center py-2 text-[10px] font-mono text-neutral-400 bg-neutral-900 rounded-xl border border-neutral-800">
                      Advisory Strategy (Long-term resilience)
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setSelectedRemedyForFix(proposal);
                      setActiveTab('Fix Station');
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white transition-all shadow-md shadow-emerald-500/20"
                  >
                    <Terminal className="w-3.5 h-3.5" /> PROCEED TO FIX STATION
                  </button>

                  {simResult && (
                    <button
                      onClick={() => setApplyModalProposal(proposal)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-mono font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" /> APPLY REMEDY IN LAB
                    </button>
                  )}
                </div>
              </div>

            );
          })
        )}
      </div>

      {/* Remedy Simulator & Comparison View */}
      {selectedRemedy && activeSim && (
        <div ref={simulatorRef} className="glass-panel p-6 border border-amber-500/40 bg-gradient-to-b from-neutral-950 via-amber-950/20 to-neutral-950 rounded-2xl space-y-6 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-amber-500/20">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-amber-400 font-bold uppercase tracking-wider mb-1">
                <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
                REMEDY SIMULATION ENGINE — FORKED OUTCOME
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Simulated Impact: <span className="text-amber-400 font-mono">{selectedRemedy.title}</span>
              </h3>
            </div>

            {/* Effectiveness Score Gauge */}
            <div className="flex items-center gap-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 px-5 py-3 rounded-2xl shadow-lg">
              <div>
                <span className="text-[10px] font-mono text-amber-300 uppercase block font-bold">Effectiveness Score</span>
                <span className="text-2xl font-bold font-mono text-amber-400">{activeSim.effectivenessScore} / 100</span>
              </div>
              <div className="w-12 h-12 rounded-full border-4 border-amber-400 flex items-center justify-center font-bold text-xs font-mono text-amber-300 bg-amber-950/60 shadow-inner">
                {activeSim.effectivenessScore}%
              </div>
            </div>
          </div>

          {/* 4 Impact Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 space-y-1">
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Root Resource Pressure</span>
              <div className="text-lg font-bold font-mono text-white flex items-center justify-between">
                <span>{Math.round((activeSim.pressureReduction) * 100)}% Drop</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  -{Math.round((activeSim.pressureReduction) * 100)}%
                </span>
              </div>
              <p className="text-[10px] font-mono text-neutral-400">Root utilization drops from peak back to normal</p>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 space-y-1">
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Root Latency Recovery</span>
              <div className="text-lg font-bold font-mono text-white flex items-center justify-between">
                <span>{Math.round((activeSim.latencyReduction) * 100)}% Faster</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  -{Math.round((activeSim.latencyReduction) * 100)}% Latency
                </span>
              </div>
              <p className="text-[10px] font-mono text-neutral-400">Response latency returns to healthy baseline</p>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 space-y-1">
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Timeout Spike Elimination</span>
              <div className="text-lg font-bold font-mono text-white flex items-center justify-between">
                <span>{Math.round((activeSim.timeoutReduction) * 100)}% Reduced</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  -{Math.round((activeSim.timeoutReduction) * 100)}% Timeouts
                </span>
              </div>
              <p className="text-[10px] font-mono text-neutral-400">Downstream dependency timeouts completely collapse</p>
            </div>

            <div className="p-4 rounded-xl bg-neutral-900/80 border border-neutral-800 space-y-1">
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Queue Drain Score</span>
              <div className="text-lg font-bold font-mono text-white flex items-center justify-between">
                <span>{Math.round((activeSim.queueDrainScore) * 100)}% Drained</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  -{Math.round((activeSim.queueDrainScore) * 100)}% Backlog
                </span>
              </div>
              <p className="text-[10px] font-mono text-neutral-400">Caller request queues drain without backlog buildup</p>
            </div>
          </div>

          <p className="text-xs font-mono text-amber-200 bg-amber-950/40 p-3.5 rounded-xl border border-amber-500/30 leading-relaxed">
            💡 {activeSim.summary}
          </p>

          {/* Metric Selector Tabs & Trajectory Line Chart */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs font-mono text-neutral-300 font-bold uppercase tracking-wider">
                Trajectory Comparison: <span className="text-red-400">Baseline (No Remedy)</span> vs <span className="text-emerald-400">Simulated Remedy</span>
              </span>

              <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
                {(['pressure', 'latency', 'timeouts', 'queue'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setActiveMetricTab(m)}
                    className={clsx(
                      'px-3 py-1 rounded-lg text-[11px] font-mono font-bold transition-all uppercase',
                      activeMetricTab === m
                        ? 'bg-amber-500 text-neutral-950 shadow'
                        : 'text-neutral-400 hover:text-white'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-72 w-full pt-2 bg-neutral-950/90 rounded-xl p-4 border border-neutral-800">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="tick" stroke="#71717a" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px' }}
                    labelStyle={{ color: '#fafafa', fontFamily: 'monospace' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} />

                  {activeMetricTab === 'pressure' && (
                    <>
                      <Line type="monotone" dataKey="baselinePressure" name="Baseline Root Pressure (%)" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="rootPressure" name="Simulated Remedy Pressure (%)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    </>
                  )}

                  {activeMetricTab === 'latency' && (
                    <>
                      <Line type="monotone" dataKey="baselineLatency" name="Baseline Latency (ms)" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="rootLatency" name="Simulated Root Latency (ms)" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="downstreamLatency" name="Simulated Downstream Latency (ms)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </>
                  )}

                  {activeMetricTab === 'timeouts' && (
                    <>
                      <Line type="monotone" dataKey="baselineTimeout" name="Baseline Timeout Rate (%)" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="timeoutRate" name="Simulated Timeout Rate (%)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    </>
                  )}

                  {activeMetricTab === 'queue' && (
                    <>
                      <Line type="monotone" dataKey="baselineQueue" name="Baseline Queue Depth" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      <Line type="monotone" dataKey="queueDepth" name="Simulated Queue Depth" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Ask Gemini About Remedies Section */}
      <div className="glass-panel p-6 border border-amber-500/20 bg-neutral-950/60 rounded-2xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-400 uppercase font-mono">
          <Bot className="w-5 h-5 text-amber-400" />
          Ask Gemini Remedy Advisor
        </div>
        <p className="text-xs text-neutral-400 font-mono">
          Ask natural-language questions about trade-offs, blast-radius, risks, or alternative remediation strategies.
        </p>

        {/* Suggested Chips */}
        <div className="flex flex-wrap gap-2">
          {[
            'Why is this the safest fix?',
            'What happens if I only increase Appointment workers?',
            'Which remedy addresses the root rather than the symptom?',
            'Which option has the smallest blast radius?'
          ].map((q, i) => (
            <button
              key={i}
              onClick={() => { setAskQuestion(q); }}
              className="text-xs font-mono px-3 py-1.5 bg-neutral-900 border border-neutral-800 hover:border-amber-500/40 text-neutral-300 hover:text-amber-400 rounded-lg transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Box */}
        <div className="flex gap-2">
          <input
            type="text"
            value={askQuestion}
            onChange={e => setAskQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAskGemini()}
            placeholder="Ask about remedy trade-offs or blast radius..."
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2 text-xs font-mono text-white placeholder:text-neutral-500 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleAskGemini}
            disabled={isAsking || !askQuestion.trim()}
            className="flex items-center gap-1.5 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-neutral-950 rounded-xl text-xs font-mono font-bold transition-colors"
          >
            {isAsking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Ask
          </button>
        </div>

        {/* Gemini Response Display */}
        {askAnswer && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-neutral-200 leading-relaxed">
            <div className="text-[10px] text-amber-400 font-bold mb-1 uppercase flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Remedy Advisor Answer
            </div>
            {askAnswer}
          </div>
        )}
      </div>

      {/* Controlled Apply Confirmation Modal */}
      {applyModalProposal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-950 border border-amber-500/40 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" /> Explicit Remedy Application
              </h3>
              <button onClick={() => setApplyModalProposal(null)} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div className="p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                <span className="text-neutral-400 uppercase text-[10px] block">Selected Action</span>
                <span className="text-sm font-bold text-amber-400">{applyModalProposal.title}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                  <span className="text-neutral-400 uppercase text-[10px] block">Target Service</span>
                  <span className="text-white font-bold">{applyModalProposal.targetService || 'records'}</span>
                </div>
                <div className="p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                  <span className="text-neutral-400 uppercase text-[10px] block">Target Resource</span>
                  <span className="text-white font-bold">{applyModalProposal.targetResource || 'MEMORY'}</span>
                </div>
              </div>

              <p className="text-neutral-300 leading-relaxed bg-amber-500/10 p-3 rounded-xl border border-amber-500/30">
                ⚠️ Confirming will apply this remedy action directly to the active incident session.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setApplyModalProposal(null)}
                className="px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white text-xs font-mono font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApply}
                disabled={isApplying}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-colors"
              >
                {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm & Apply Remedy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
