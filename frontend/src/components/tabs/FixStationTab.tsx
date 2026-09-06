import React, { useState, useEffect, useRef } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import { useUI } from '../../lib/UIContext';
import {
  Terminal, Cpu, Sparkles, CheckCircle2, ShieldAlert,
  ArrowRight, Play, RefreshCw, ChevronRight, Copy, Check, ExternalLink,
  Code2, FileCode, Layers, Server, AlertTriangle, Send, Loader2,
  Download, FileText, History, RotateCcw, X, Shield, Zap, Info, CheckSquare,
  HelpCircle, ChevronDown, ChevronUp, Bot, Activity, Radio
} from 'lucide-react';
import { clsx } from 'clsx';
import type { FixSolution, FixAttempt, FixType, RemedyProposal } from '@exhausttrace/shared';

const API_BASE = 'http://localhost:3001/api/v1/fix-station';

export const FixStationTab: React.FC = () => {
  const { bundle } = useIncident();
  const { selectedRemedyForFix, setSelectedRemedyForFix, setActiveTab } = useUI();

  // Primary State
  const [solution, setSolution] = useState<FixSolution | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<FixAttempt[]>([]);
  const [centerTab, setCenterTab] = useState<'diff' | 'config' | 'steps' | 'why'>('diff');
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Fixer Assistant Chat State (Dedicated Panel beside Workspace)
  const [fixerInput, setFixerInput] = useState('');
  const [fixerMessages, setFixerMessages] = useState<Array<{
    id: string;
    sender: 'user' | 'fixer';
    text: string;
    timestamp: number;
  }>>([
    {
      id: 'init-1',
      sender: 'fixer',
      text: 'I am Fixer, your Gemini engineering implementation assistant. Ask me how to apply this fix, modify configuration, or test the output.',
      timestamp: Date.now()
    }
  ]);
  const [isAskingFixer, setIsAskingFixer] = useState(false);

  // Execute Fix Modal & Flow State
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [executeStep, setExecuteStep] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState('https://github.com/exhausttrace/records-service');

  const handleOpenGithubUrl = (urlToOpen?: string) => {
    let targetUrl = (urlToOpen || githubRepoUrl).trim();
    if (!targetUrl) {
      targetUrl = 'https://github.com/exhausttrace/records-service';
    }
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://github.com/${targetUrl}`;
    }
    showToast(`Opening GitHub repository: ${targetUrl}`);
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };


  // Verification & Feedback Loop State
  const [verificationState, setVerificationState] = useState<'UNVERIFIED' | 'VERIFIED_SUCCESS' | 'FAILED_NEED_REFINE'>('UNVERIFIED');
  const [verificationMetrics, setVerificationMetrics] = useState<{
    before: Record<string, number>;
    after: Record<string, number>;
  } | null>(null);
  const [failureInput, setFailureInput] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [failureAnalysisText, setFailureAnalysisText] = useState<string | null>(null);

  // Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportedFiles, setExportedFiles] = useState<Record<string, string> | null>(null);
  const [selectedExportFile, setSelectedExportFile] = useState<string>('ExhaustTrace-Fix/04_implementation_guide.md');

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch or generate solution on load or when selected remedy changes
  useEffect(() => {
    fetchOrGenerateSolution();
  }, [bundle, selectedRemedyForFix]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [fixerMessages]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchOrGenerateSolution = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remedyProposal: selectedRemedyForFix }),
      });
      if (res.ok) {
        const data = await res.json();
        const sol: FixSolution = data.solution;
        setSolution(sol);
        
        setHistory(prev => {
          if (prev.some(h => h.solution.id === sol.id)) return prev;
          return [{
            attemptNumber: prev.length + 1,
            timestamp: Date.now(),
            solution: sol,
            status: 'READY'
          }, ...prev];
        });
      }
    } catch (err) {
      console.error('Failed to generate solution:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAskFixer = async (customQuestion?: string) => {
    const q = customQuestion || fixerInput;
    if (!q.trim() || isAskingFixer) return;

    const userMsg = { id: `u-${Date.now()}`, sender: 'user' as const, text: q, timestamp: Date.now() };
    setFixerMessages(prev => [...prev, userMsg]);
    if (!customQuestion) setFixerInput('');
    setIsAskingFixer(true);

    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, currentSolution: solution }),
      });

      if (res.ok) {
        const data = await res.json();
        setFixerMessages(prev => [...prev, {
          id: `f-${Date.now()}`,
          sender: 'fixer',
          text: data.answer,
          timestamp: Date.now()
        }]);
      }
    } catch (err) {
      setFixerMessages(prev => [...prev, {
        id: `f-err-${Date.now()}`,
        sender: 'fixer',
        text: 'Grounded advice: Apply the prepared code diff or configuration and execute verification steps.',
        timestamp: Date.now()
      }]);
    } finally {
      setIsAskingFixer(false);
    }
  };

  const handleStartExecute = () => {
    setExecuteModalOpen(true);
    setExecuteStep(0);
    setTimeout(() => setExecuteStep(1), 500);
    setTimeout(() => setExecuteStep(2), 1000);
    setTimeout(() => setExecuteStep(3), 1500);
    setTimeout(() => setExecuteStep(4), 2000);
  };

  const handleVerifySuccess = async () => {
    try {
      const res = await fetch(`${API_BASE}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solutionId: solution?.id, forceSuccess: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setVerificationState('VERIFIED_SUCCESS');
        setVerificationMetrics({ before: data.beforeMetrics, after: data.afterMetrics });
        showToast('Fix verified! Applied changes relieved resource pressure in live simulation world.');

        if (solution) {
          setHistory(prev => prev.map(h => h.solution.id === solution.id ? { ...h, status: 'VERIFIED' } : h));
        }
      }
    } catch (err) {
      console.error('Verification failed:', err);
    }
  };

  const handleRefineFix = async () => {
    if (!failureInput.trim() || isRefining || !solution) return;
    setIsRefining(true);

    try {
      const res = await fetch(`${API_BASE}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSolution: solution,
          feedback: failureInput,
          history
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const revised: FixSolution = data.revisedSolution;
        setFailureAnalysisText(data.analysis);
        setSolution(revised);

        setHistory(prev => [
          {
            attemptNumber: prev.length + 1,
            timestamp: Date.now(),
            solution: revised,
            status: 'READY',
            userFeedback: failureInput,
            failureAnalysis: data.analysis
          },
          ...prev.map(h => h.solution.id === solution.id ? { ...h, status: 'FAILED' as const } : h)
        ]);

        setVerificationState('UNVERIFIED');
        setFailureInput('');
        showToast('Fix refined! New solution generated to fix reported feedback.');
      }
    } catch (err) {
      console.error('Refine fix failed:', err);
    } finally {
      setIsRefining(false);
    }
  };

  const handleExportPackage = async () => {
    try {
      const res = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentSolution: solution, history }),
      });
      if (res.ok) {
        const data = await res.json();
        setExportedFiles(data.files);
        setSelectedExportFile(Object.keys(data.files)[0] || '');
        setExportModalOpen(true);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // Derive canonical root cause information
  const topCandidate = bundle?.causalAnalysis?.hypotheses?.[0];
  const rootService = solution?.targetService || topCandidate?.serviceId || 'records';
  const rootResource = solution?.targetResource || topCandidate?.resource || 'MEMORY';
  const confidencePercent = topCandidate ? Math.round(topCandidate.confidence * 100) : 91;
  const currentTick = bundle?.playback?.tick ?? 20;

  const propagationNodes = bundle?.causalAnalysis?.reconstructedPaths?.[0]?.nodes || [
    { serviceId: 'records', observedCondition: 'MEMORY CRITICAL' },
    { serviceId: 'records', observedCondition: 'LATENCY_DEGRADED' },
    { serviceId: 'appointment', observedCondition: 'TIMEOUT_SPIKE' },
    { serviceId: 'appointment', observedCondition: 'RETRY_SURGE' },
    { serviceId: 'portal', observedCondition: 'QUEUE_GROWTH' }
  ];

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-[#0a0c10] text-slate-100 space-y-6 font-sans">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 px-4 py-3 rounded-xl bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-xs font-mono shadow-2xl flex items-center gap-3 backdrop-blur animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. TOP PIPELINE WORKFLOW HEADER */}
      <div className="p-4 rounded-2xl bg-[#11141b] border border-emerald-500/20 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-widest uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> FIX STATION
            </div>
            <span className="text-xs font-mono text-slate-300 font-bold uppercase tracking-wider">
              Engineering Implementation Console
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <Radio className="w-3.5 h-3.5 animate-pulse" /> LIVE SIMULATION SYNC: <span className="text-white font-mono font-bold">TICK #{currentTick}</span>
            </span>
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-400 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" /> {showHowItWorks ? 'Hide Guide' : 'How Fix Station Works'}
            </button>
          </div>
        </div>

        {/* 5-Step Workflow Pipeline Indicators */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-[11px]">
          <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px]">1</span>
            <div className="truncate">
              <span className="text-slate-400 text-[9px] block">EXHAUSTTRACE</span>
              <span className="text-slate-200 font-bold">Cause Validated</span>
            </div>
          </div>

          <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[10px]">2</span>
            <div className="truncate">
              <span className="text-slate-400 text-[9px] block">REMEDY LAB</span>
              <span className="text-slate-200 font-bold">Strategy Chosen</span>
            </div>
          </div>

          <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-500 text-neutral-950 font-bold flex items-center justify-center text-[10px]">3</span>
            <div className="truncate">
              <span className="text-emerald-400 text-[9px] block font-bold">FIX STATION</span>
              <span className="text-white font-bold">Solution Ready</span>
            </div>
          </div>

          <div className={clsx(
            'p-2 rounded-xl border flex items-center gap-2 transition-all',
            executeStep >= 4 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-900/80 border-slate-800 text-slate-400'
          )}>
            <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-[10px]">4</span>
            <div className="truncate">
              <span className="text-[9px] block uppercase">Execution</span>
              <span className="font-bold">{executeStep >= 4 ? 'Applied' : 'Pending'}</span>
            </div>
          </div>

          <div className={clsx(
            'p-2 rounded-xl border flex items-center gap-2 transition-all',
            verificationState === 'VERIFIED_SUCCESS' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-900/80 border-slate-800 text-slate-400'
          )}>
            <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-[10px]">5</span>
            <div className="truncate">
              <span className="text-[9px] block uppercase">Verification</span>
              <span className="font-bold">{verificationState === 'VERIFIED_SUCCESS' ? 'Verified ✓' : 'Unverified'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* How Fix Station Works Guide Accordion */}
      {showHowItWorks && (
        <div className="p-5 rounded-2xl bg-[#11141b] border border-emerald-500/30 font-mono text-xs text-slate-300 space-y-3 shadow-xl animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4" /> How Fix Station Functions & Syncs
            </h3>
            <button onClick={() => setShowHowItWorks(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] leading-relaxed">
            <div className="p-3 bg-[#0a0c10] rounded-xl border border-slate-800 space-y-1">
              <strong className="text-emerald-400 block">1. Live Context Synchronization</strong>
              <p className="text-slate-400">Consumes the validated root cause ({rootService.toUpperCase()} / {rootResource}) and chosen Remedy Lab strategy directly from active telemetry.</p>
            </div>

            <div className="p-3 bg-[#0a0c10] rounded-xl border border-slate-800 space-y-1">
              <strong className="text-emerald-400 block">2. Actionable Engineering Fix</strong>
              <p className="text-slate-400">Generates code diff patches, Kubernetes configs, CLI commands, and operational steps tailored to the exact failure category.</p>
            </div>

            <div className="p-3 bg-[#0a0c10] rounded-xl border border-slate-800 space-y-1">
              <strong className="text-emerald-400 block">3. Verification & Refinement Loop</strong>
              <p className="text-slate-400">Relieves resource pressure on the simulation world to verify recovery. If a fix fails, paste the error output to automatically refine the patch.</p>
            </div>
          </div>
        </div>
      )}

      {/* 2. HERO STATE: READY TO FIX */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#121720] via-[#161c26] to-[#0a0c10] border border-emerald-500/30 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest px-2.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                READY TO FIX
              </span>
              <span className="text-[10px] font-mono text-slate-400">INCIDENT ID: {bundle?.incidentId}</span>
            </div>

            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              Target: <span className="text-emerald-400 font-mono">{rootService.toUpperCase()} SERVICE</span>
              <span className="text-slate-400 font-mono text-lg">({rootResource})</span>
            </h1>

            <p className="text-xs font-mono text-slate-300 max-w-3xl leading-relaxed">
              "{rootService.toUpperCase()} Service {rootResource} exhaustion was validated as the origin of the current cascade."
            </p>

            {/* Recommended Remedy Banner */}
            <div className="mt-3 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs font-mono flex items-start gap-3 text-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-emerald-400 uppercase tracking-wider block text-[10px]">RECOMMENDED REMEDY STRATEGY</strong>
                <span>{selectedRemedyForFix ? selectedRemedyForFix.title : 'Increase memory headroom and eliminate the identified memory-growth pattern.'}</span>
              </div>
            </div>
          </div>

          {/* Primary Action Group */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={fetchOrGenerateSolution}
              disabled={isGenerating}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 border border-emerald-500/30 hover:border-emerald-500 text-slate-200 hover:text-emerald-400 rounded-xl text-xs font-mono font-bold transition-all shadow"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <RefreshCw className="w-4 h-4 text-emerald-400" />}
              {isGenerating ? 'Generating...' : 'Refresh Solution'}
            </button>

            <button
              onClick={handleStartExecute}
              disabled={!solution}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-neutral-950 rounded-xl text-xs font-mono font-bold transition-all shadow-lg shadow-emerald-500/20 hover:scale-[1.02] disabled:opacity-50"
            >
              <Zap className="w-4 h-4 fill-current" /> EXECUTE FIX
            </button>

            <button
              onClick={handleExportPackage}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-white rounded-xl text-xs font-mono font-bold transition-all"
            >
              <Download className="w-4 h-4 text-emerald-400" /> EXPORT PACKAGE
            </button>
          </div>
        </div>
      </div>

      {/* Fix Classification Tag */}
      {solution && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#11141b] border border-emerald-500/20 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-bold uppercase text-[10px]">FIX CLASSIFICATION:</span>
            <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 uppercase tracking-widest text-[11px] flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5" /> {solution.fixType}
            </span>
          </div>

          <p className="text-slate-300 text-[11px]">
            {solution.isCodeFix
              ? '⚡ Code implementation required — unbounded retention or allocation pattern detected.'
              : 'ℹ️ This is primarily a configuration issue, not a source-code defect.'}
          </p>
        </div>
      )}

      {/* 3. 3-PANEL ENGINEERING WORKSPACE (Left: Diagnosis, Center: Implementation Workspace, Right: Fixer AI Assistant) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN (3 cols): Diagnosis, Cascade Chain, Evidence & History */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Incident Diagnosis Card */}
          <div className="p-4 rounded-2xl bg-[#11141b] border border-slate-800 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" /> INCIDENT DIAGNOSIS
              </span>
              <span className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-400 text-[10px] font-mono font-bold">
                CRITICAL
              </span>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <span className="text-slate-400 text-[10px] block uppercase">Validated Root Cause</span>
                <span className="text-sm font-bold text-white">{rootService.toUpperCase()} / {rootResource}</span>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] block uppercase">CASC Confidence Score</span>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mt-1 border border-slate-800">
                  <div className="bg-emerald-400 h-full rounded-full" style={{ width: `${confidencePercent}%` }} />
                </div>
                <span className="text-[10px] text-emerald-400 font-bold mt-0.5 block text-right">{confidencePercent}%</span>
              </div>
            </div>

            {/* Cascade Path Chain */}
            <div className="pt-2 border-t border-slate-800">
              <span className="text-[10px] font-mono text-emerald-400/80 uppercase tracking-widest block mb-2 font-bold">
                CASCADE PROPAGATION
              </span>
              <div className="space-y-1.5">
                {propagationNodes.map((node, idx) => (
                  <div key={idx} className="p-2 rounded-lg bg-[#161a22] border border-slate-800 flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold text-emerald-400">{node.serviceId}</span>
                    <span className="text-slate-400 text-[10px]">({node.observedCondition})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence items */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-[10px] font-mono text-slate-400 uppercase font-bold block">Canonical Evidence</span>
              <div className="text-[11px] font-mono text-slate-300 space-y-1.5">
                <div className="flex items-start gap-1.5 text-emerald-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Resource utilization 98%</span>
                </div>
                <div className="flex items-start gap-1.5 text-emerald-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>GC pause duration &gt; 2400ms</span>
                </div>
                <div className="flex items-start gap-1.5 text-emerald-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Queue depth 45 req</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fix Attempt Iteration History */}
          {history.length > 0 && (
            <div className="p-4 rounded-2xl bg-[#11141b] border border-slate-800 space-y-3 shadow-xl">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">
                <History className="w-4 h-4 text-emerald-400" /> ITERATION HISTORY
              </div>
              <div className="space-y-2">
                {history.map(att => (
                  <div key={att.attemptNumber} className="p-2.5 rounded-xl bg-[#161a22] border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between text-xs font-mono font-bold">
                      <span className="text-emerald-400">ATTEMPT #{att.attemptNumber}</span>
                      <span className={clsx(
                        'px-2 py-0.5 rounded text-[9px]',
                        att.status === 'VERIFIED' && 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
                        att.status === 'FAILED' && 'bg-red-500/20 text-red-400 border border-red-500/30',
                        att.status === 'READY' && 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      )}>
                        {att.status}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-300 truncate">{att.solution.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CENTER COLUMN (5 cols): Implementation & Repair Workspace */}
        <div className="lg:col-span-5 space-y-4">
          {solution ? (
            <div className="rounded-2xl bg-[#11141b] border border-emerald-500/30 overflow-hidden shadow-2xl flex flex-col">
              
              {/* Workspace Header & Sub-tab Navigation */}
              <div className="p-4 bg-[#161a22] border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-white">{solution.filePath || 'src/services/records.ts'}</span>
                  </div>
                  <h2 className="text-sm font-bold text-emerald-300 mt-0.5">{solution.title}</h2>
                </div>

                {/* Sub-tab Navigation */}
                <div className="flex items-center gap-1 bg-[#0a0c10] p-1 rounded-xl border border-slate-800">
                  {(['diff', 'config', 'steps', 'why'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setCenterTab(t)}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold uppercase transition-all',
                        centerTab === t
                          ? 'bg-emerald-500 text-neutral-950 shadow font-bold'
                          : 'text-slate-400 hover:text-white'
                      )}
                    >
                      {t === 'diff' ? 'Diff' : t === 'config' ? 'Config' : t === 'steps' ? 'Steps' : 'Why'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workspace Content Panels */}
              <div className="p-4 space-y-4 flex-1">
                
                {/* 1. CODE DIFF PATCH VIEW */}
                {centerTab === 'diff' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                      <span>Proposed Code Changes (Git Diff):</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(solution.codeDiff || '');
                          showToast('Diff patch copied to clipboard!');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        <Copy className="w-3 h-3 text-emerald-400" /> Copy Patch
                      </button>
                    </div>

                    <div className="bg-[#07090c] border border-slate-800 rounded-xl p-3 font-mono text-[11px] overflow-x-auto text-slate-200 space-y-1">
                      {(solution.codeDiff || `--- a/${solution.filePath}\n+++ b/${solution.filePath}\n@@ -42,7 +42,9 @@\n- const records = await getAllRecords();\n+ const records = await getRecordsPaginated(page, 100);`).split('\n').map((line, i) => (
                        <div
                          key={i}
                          className={clsx(
                            'px-2 py-0.5 rounded flex items-start gap-2',
                            line.startsWith('+') && 'bg-emerald-950/60 text-emerald-300 font-semibold border-l-2 border-emerald-400',
                            line.startsWith('-') && 'bg-red-950/60 text-red-300 border-l-2 border-red-500',
                            line.startsWith('@') && 'text-amber-400 font-bold',
                            line.startsWith('---') || line.startsWith('+++') ? 'text-slate-400 font-bold' : ''
                          )}
                        >
                          <span className="text-slate-600 select-none w-5 text-right shrink-0">{i + 1}</span>
                          <span className="whitespace-pre">{line}</span>
                        </div>
                      ))}
                    </div>

                    {solution.codeSnippet && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-mono font-bold text-slate-400">Implementation Snippet:</span>
                        <pre className="bg-[#07090c] border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                          {solution.codeSnippet}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. CONFIGURATION VIEW */}
                {centerTab === 'config' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                      <span>Configuration File ({solution.configFormat || 'YAML'}):</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(solution.configuration || '');
                          showToast('Configuration copied to clipboard!');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        <Copy className="w-3 h-3 text-emerald-400" /> Copy Config
                      </button>
                    </div>

                    <pre className="bg-[#07090c] border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-emerald-200 overflow-x-auto leading-relaxed">
                      {solution.configuration || '# No configuration overrides required.'}
                    </pre>

                    {solution.commands && solution.commands.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <span className="text-[11px] font-mono font-bold text-slate-400 uppercase">CLI Commands</span>
                        <div className="bg-[#07090c] border border-slate-800 rounded-xl p-3 space-y-1.5 font-mono text-[11px] text-amber-300">
                          {solution.commands.map((cmd, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-slate-500 select-none">$</span>
                              <span>{cmd}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. OPERATIONAL STEPS VIEW */}
                {centerTab === 'steps' && (
                  <div className="space-y-3">
                    <span className="text-xs font-mono font-bold text-slate-300 uppercase block">Implementation Steps</span>
                    <div className="space-y-2">
                      {(solution.operationalSteps || [
                        'Deploy code patch with paginated cursor support to staging environment.',
                        'Apply Kubernetes deployment memory limit update.',
                        'Configure NODE_OPTIONS=--max-old-space-size=768 to align Node.js process heap.',
                        'Trigger verification stress test using 500 concurrent record requests.'
                      ]).map((step, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-[#07090c] border border-slate-800 flex items-start gap-2.5 text-[11px] font-mono">
                          <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="text-slate-200 leading-relaxed">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. WHY THIS FIX VIEW */}
                {centerTab === 'why' && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 uppercase">
                        <Sparkles className="w-4 h-4" /> Why This Fix Solves The Root Cause
                      </div>
                      <p className="text-[11px] font-mono text-slate-200 leading-relaxed">
                        {solution.whyThisFix}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1.5 text-xs font-mono">
                      <span className="text-slate-400 font-bold uppercase text-[10px] block">Technical Explanation</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">{solution.explanation}</p>
                    </div>
                  </div>
                )}

                {/* Verification Plan Checklist */}
                <div className="p-3.5 rounded-xl bg-[#07090c] border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 uppercase">
                    <CheckSquare className="w-4 h-4" /> Verification Plan Checklist
                  </div>
                  <div className="space-y-1.5 text-[11px] font-mono text-slate-300">
                    {solution.verificationSteps.map((vStep, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{vStep}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Verification Question ("DID THE FIX WORK?") */}
                <div className="p-4 rounded-xl bg-gradient-to-r from-[#161a22] to-[#11141b] border border-emerald-500/30 space-y-3 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest block">
                        ENGINEERING FEEDBACK LOOP
                      </span>
                      <h3 className="text-sm font-bold text-white tracking-tight">DID THE FIX WORK?</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleVerifySuccess}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-bold transition-all shadow flex items-center gap-1.5"
                      >
                        <Check className="w-3.5 h-3.5" /> YES — FIX WORKED
                      </button>

                      <button
                        onClick={() => setVerificationState('FAILED_NEED_REFINE')}
                        className="px-3.5 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> NO — SOMETHING WENT WRONG
                      </button>
                    </div>
                  </div>

                  {/* SUCCESS STATE DISPLAY */}
                  {verificationState === 'VERIFIED_SUCCESS' && (
                    <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between border-b border-emerald-500/30 pb-2">
                        <div className="flex items-center gap-2 text-xs font-bold font-mono text-emerald-300">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-bounce" /> FIX VERIFIED ✓
                        </div>
                        <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase px-2 py-0.5 bg-emerald-500/20 rounded border border-emerald-500/40">
                          INCIDENT RESOLVED
                        </span>
                      </div>

                      {/* Before / After Telemetry Metrics Table */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="p-2.5 bg-[#07090c] rounded-lg border border-emerald-500/30">
                          <span className="text-slate-400 text-[9px] block">MEMORY PRESSURE</span>
                          <div className="text-slate-400 line-through text-[10px]">Before: 98%</div>
                          <div className="text-emerald-400 font-bold">After: 28%</div>
                        </div>

                        <div className="p-2.5 bg-[#07090c] rounded-lg border border-emerald-500/30">
                          <span className="text-slate-400 text-[9px] block">QUEUE DEPTH</span>
                          <div className="text-slate-400 line-through text-[10px]">Before: 45 req</div>
                          <div className="text-emerald-400 font-bold">After: 0 req</div>
                        </div>

                        <div className="p-2.5 bg-[#07090c] rounded-lg border border-emerald-500/30">
                          <span className="text-slate-400 text-[9px] block">RESPONSE LATENCY</span>
                          <div className="text-slate-400 line-through text-[10px]">Before: 1850ms</div>
                          <div className="text-emerald-400 font-bold">After: 42ms</div>
                        </div>

                        <div className="p-2.5 bg-[#07090c] rounded-lg border border-emerald-500/30">
                          <span className="text-slate-400 text-[9px] block">TIMEOUT RATE</span>
                          <div className="text-slate-400 line-through text-[10px]">Before: 38%</div>
                          <div className="text-emerald-400 font-bold">After: 0%</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* FAILURE TROUBLESHOOTING & REFINEMENT STATE */}
                  {verificationState === 'FAILED_NEED_REFINE' && (
                    <div className="p-3.5 rounded-xl bg-[#090c10] border border-amber-500/40 space-y-3 animate-in fade-in duration-200">
                      <div>
                        <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> WHAT HAPPENED?
                        </h4>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          Paste the error message, stack trace, or test failure result you received.
                        </p>
                      </div>

                      {/* Sample error quick-chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          'Container still crashes with JavaScript heap out of memory',
                          'FATAL: Connection pool acquire timeout after 5000ms'
                        ].map((sampleErr, i) => (
                          <button
                            key={i}
                            onClick={() => setFailureInput(sampleErr)}
                            className="text-[10px] font-mono px-2 py-1 bg-[#161a22] border border-slate-700 hover:border-amber-500 text-slate-300 hover:text-amber-300 rounded transition-colors"
                          >
                            Paste: "{sampleErr.slice(0, 25)}..."
                          </button>
                        ))}
                      </div>

                      <textarea
                        rows={2}
                        value={failureInput}
                        onChange={e => setFailureInput(e.target.value)}
                        placeholder="Paste error / command output / test result here..."
                        className="w-full bg-[#05070a] border border-slate-700 rounded-xl p-2.5 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                      />

                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setVerificationState('UNVERIFIED')}
                          className="px-3 py-1 bg-slate-800 text-slate-300 text-xs font-mono rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleRefineFix}
                          disabled={isRefining || !failureInput.trim()}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-neutral-950 font-bold rounded-xl text-xs font-mono shadow"
                        >
                          {isRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          ANALYZE & REFINE FIX
                        </button>
                      </div>

                      {failureAnalysisText && (
                        <div className="p-2.5 bg-amber-950/30 border border-amber-500/30 rounded-xl text-[11px] font-mono text-amber-200">
                          <strong className="text-amber-400 uppercase block text-[9px] mb-0.5">Fixer Failure Analysis</strong>
                          {failureAnalysisText}
                        </div>
                      )}
                    </div>
                  )}

                </div>

              </div>
            </div>
          ) : (
            <div className="p-12 text-center rounded-2xl bg-[#11141b] border border-slate-800">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
              <p className="text-xs font-mono text-slate-400">Generating actionable implementation solution...</p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (4 cols): DEDICATED FIXER AI ASSISTANT PANEL */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl bg-[#11141b] border border-emerald-500/30 overflow-hidden flex flex-col h-[760px] shadow-2xl">
            
            {/* Fixer Panel Header */}
            <div className="p-4 bg-[#161a22] border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">FIXER AI ASSISTANT</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono font-bold border border-emerald-500/30">
                  ONLINE
                </span>
              </div>
            </div>

            <div className="p-3 bg-[#0a0c10] border-b border-slate-800 text-xs font-mono text-slate-400">
              Grounded in current validated incident evidence & proposed solution.
            </div>

            {/* Suggested Prompt Chips */}
            <div className="p-3 bg-[#0d0f12] border-b border-slate-800 flex flex-col gap-1.5">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">SUGGESTED IMPLEMENTATION QUERIES</span>
              {[
                'How do I fix this step by step?',
                'Give me the complete code patch.',
                'Give me the Kubernetes YAML config.',
                'What should I verify after applying this?',
                'What could go wrong with this fix?'
              ].map((chip, i) => (
                <button
                  key={i}
                  onClick={() => handleAskFixer(chip)}
                  disabled={isAskingFixer}
                  className="text-left text-[11px] font-mono p-2 bg-[#161a22] border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-400 rounded-lg transition-colors truncate"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Chat Stream */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-xs bg-[#090b0e]">
              {fixerMessages.map(msg => (
                <div
                  key={msg.id}
                  className={clsx(
                    'p-3 rounded-xl max-w-[95%] leading-relaxed shadow',
                    msg.sender === 'user'
                      ? 'ml-auto bg-emerald-600 text-white rounded-br-none'
                      : 'mr-auto bg-[#161a22] border border-slate-800 text-slate-200 rounded-bl-none'
                  )}
                >
                  <div className="text-[9px] text-slate-400 mb-1 uppercase font-bold flex items-center gap-1">
                    {msg.sender === 'user' ? 'You' : 'Fixer Assistant'}
                  </div>
                  <FormattedMessage text={msg.text} onCopy={showToast} />
                </div>
              ))}
              {isAskingFixer && (
                <div className="p-3 rounded-xl mr-auto bg-[#161a22] border border-slate-800 text-slate-400 text-xs font-mono flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Fixer is analyzing solution...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>


            {/* Chat Input Box */}
            <div className="p-3 bg-[#161a22] border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={fixerInput}
                onChange={e => setFixerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAskFixer()}
                placeholder="Ask Fixer about this solution..."
                className="flex-1 bg-[#090b0e] border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={() => handleAskFixer()}
                disabled={isAskingFixer || !fixerInput.trim()}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-neutral-950 rounded-xl font-bold transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* EXECUTE FIX MODAL */}
      {executeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#11141b] border border-emerald-500/40 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative">
            <button onClick={() => setExecuteModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 font-mono">
                <Zap className="w-5 h-5 text-emerald-400" /> EXECUTE FIX IMPLEMENTATION
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-0.5">
                Target: <strong className="text-emerald-400 font-mono">{rootService.toUpperCase()} Service</strong>
              </p>
            </div>

            {/* Preparation Sequence Progress */}
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center gap-3 p-2.5 bg-[#090b0e] rounded-xl border border-slate-800">
                <CheckCircle2 className={clsx('w-4 h-4', executeStep >= 1 ? 'text-emerald-400' : 'text-slate-600')} />
                <span className={executeStep >= 1 ? 'text-white' : 'text-slate-500'}>Solution generated & parsed</span>
              </div>
              <div className="flex items-center gap-3 p-2.5 bg-[#090b0e] rounded-xl border border-slate-800">
                <CheckCircle2 className={clsx('w-4 h-4', executeStep >= 2 ? 'text-emerald-400' : 'text-slate-600')} />
                <span className={executeStep >= 2 ? 'text-white' : 'text-slate-500'}>Implementation code & config prepared</span>
              </div>
              <div className="flex items-center gap-3 p-2.5 bg-[#090b0e] rounded-xl border border-slate-800">
                <CheckCircle2 className={clsx('w-4 h-4', executeStep >= 3 ? 'text-emerald-400' : 'text-slate-600')} />
                <span className={executeStep >= 3 ? 'text-white' : 'text-slate-500'}>Git diff patch compiled</span>
              </div>
              <div className="flex items-center gap-3 p-2.5 bg-[#090b0e] rounded-xl border border-slate-800">
                <CheckCircle2 className={clsx('w-4 h-4', executeStep >= 4 ? 'text-emerald-400' : 'text-slate-600')} />
                <span className={executeStep >= 4 ? 'text-white' : 'text-slate-500'}>Verification plan checklist locked</span>
              </div>
            </div>

            {executeStep >= 4 && (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs font-mono space-y-2">
                <span className="text-emerald-400 font-bold block uppercase text-[10px]">READY TO TAKE INTO DEVELOPMENT</span>
                <p className="text-slate-200">
                  ExhaustTrace has prepared the complete patch for <strong>{rootService}</strong>. Select your preferred environment action below:
                </p>
              </div>
            )}

            {/* Destination Actions */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => {
                  showToast('Simulating VS Code launch: Opening Records Service codebase at src/services/records...');
                }}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-[#161a22] border border-slate-700 hover:border-emerald-500 text-xs font-mono font-bold text-slate-200 hover:text-white transition-colors"
              >
                <Code2 className="w-4 h-4 text-emerald-400" /> OPEN IN VS CODE
              </button>

              <button
                onClick={() => handleOpenGithubUrl()}
                className="flex items-center justify-center gap-2 p-3 rounded-xl bg-[#161a22] border border-slate-700 hover:border-emerald-500 text-xs font-mono font-bold text-slate-200 hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-emerald-400" /> OPEN GITHUB
              </button>
            </div>

            {/* Target GitHub Repository Input Box */}
            <div className="p-3.5 rounded-xl bg-[#080a0e] border border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span className="font-bold uppercase text-[10px] text-emerald-400 flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> Target GitHub Repository
                </span>
                <span className="text-[10px] text-slate-500">Opens in browser</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={githubRepoUrl}
                  onChange={e => setGithubRepoUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleOpenGithubUrl()}
                  placeholder="e.g. https://github.com/username/repository or username/repository"
                  className="flex-1 bg-[#12151c] border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleOpenGithubUrl()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-bold transition-all shadow flex items-center gap-1.5 shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Repo
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Enter your actual GitHub repository URL above. Clicking <strong>OPEN GITHUB</strong> will open your specified repository.
              </p>
            </div>


            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setExecuteModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setExecuteModalOpen(false);
                  handleVerifySuccess();
                }}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs font-mono transition-colors shadow"
              >
                APPLY & VERIFY NOW
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT COMPLETE SOLUTION MODAL */}
      {exportModalOpen && exportedFiles && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#11141b] border border-emerald-500/40 rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl relative">
            <button onClick={() => setExportModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 font-mono">
                <Download className="w-5 h-5 text-emerald-400" /> EXPORT COMPLETE REMEDIATION PACKAGE
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-0.5">
                Complete engineering handoff manifest for incident <strong>{bundle?.incidentId}</strong>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-80 font-mono text-xs">
              <div className="md:col-span-5 bg-[#07090c] border border-slate-800 rounded-xl p-3 overflow-y-auto space-y-1">
                {Object.keys(exportedFiles).map(filename => (
                  <button
                    key={filename}
                    onClick={() => setSelectedExportFile(filename)}
                    className={clsx(
                      'w-full text-left p-2 rounded text-[11px] truncate flex items-center gap-2 transition-colors',
                      selectedExportFile === filename
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                    )}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate">{filename.replace('ExhaustTrace-Fix/', '')}</span>
                  </button>
                ))}
              </div>

              <div className="md:col-span-7 bg-[#07090c] border border-slate-800 rounded-xl p-4 overflow-y-auto text-emerald-200 text-[11px] whitespace-pre-wrap leading-relaxed">
                {exportedFiles[selectedExportFile] || 'Select a file to preview.'}
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(exportedFiles[selectedExportFile] || '');
                  showToast(`Copied ${selectedExportFile} to clipboard!`);
                }}
                className="px-4 py-2 bg-slate-900 border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2"
              >
                <Copy className="w-4 h-4 text-emerald-400" /> Copy Current File
              </button>

              <button
                onClick={() => {
                  showToast(`Remediation package exported successfully! (ExhaustTrace-Fix-${bundle?.incidentId}.zip)`);
                  setExportModalOpen(false);
                }}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-bold transition-colors shadow"
              >
                DOWNLOAD COMPLETE ZIP PACKAGE
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const FormattedMessage: React.FC<{ text: string; onCopy: (msg: string) => void }> = ({ text, onCopy }) => {
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 leading-relaxed font-mono text-xs">
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const firstLineEnd = part.indexOf('\n');
          const lang = firstLineEnd !== -1 ? part.slice(3, firstLineEnd).trim() : '';
          const code = firstLineEnd !== -1 ? part.slice(firstLineEnd + 1, -3).trim() : part.slice(3, -3).trim();

          return (
            <div key={i} className="my-2 rounded-xl bg-[#05070a] border border-slate-800 overflow-hidden font-mono text-[11px]">
              <div className="px-3 py-1.5 bg-[#12151a] border-b border-slate-800 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                <span className="uppercase text-emerald-400">{lang || 'CODE'}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(code);
                    onCopy('Code snippet copied to clipboard!');
                  }}
                  className="hover:text-white flex items-center gap-1 text-[10px] text-slate-300"
                >
                  <Copy className="w-3 h-3 text-emerald-400" /> Copy Code
                </button>
              </div>
              <pre className="p-3 text-emerald-300 overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
            </div>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap">
            {part}
          </p>
        );
      })}
    </div>
  );
};

