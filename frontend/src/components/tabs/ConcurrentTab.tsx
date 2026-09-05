import React, { useState } from 'react';
import { Network, Play, ShieldAlert, CheckCircle2, Loader2, Database, Server, AlertTriangle, Clock, Activity, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import type { IncidentEvidenceBundle, ResourceType } from '@exhausttrace/shared';

const SERVICES = ['records', 'appointment', 'portal', 'notification', 'auth'];
const RESOURCES: ResourceType[] = ['MEMORY', 'CPU', 'CONNECTIONS', 'WORKERS'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'];

export const ConcurrentTab: React.FC = () => {
  const [serviceA, setServiceA] = useState<string>('records');
  const [resourceA, setResourceA] = useState<ResourceType>('MEMORY');
  const [severityA, setSeverityA] = useState<string>('CRITICAL');

  const [serviceB, setServiceB] = useState<string>('portal');
  const [resourceB, setResourceB] = useState<ResourceType>('CPU');
  const [severityB, setSeverityB] = useState<string>('CRITICAL');

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [concurrentData, setConcurrentData] = useState<{
    incidentA: IncidentEvidenceBundle | null;
    incidentB: IncidentEvidenceBundle | null;
  } | null>(null);

  const handleStartConcurrent = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    setConcurrentData(null);
    setElapsedMs(null);

    const startTime = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startTime), 200);

    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/concurrent-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceA, resourceA, severityA,
          serviceB, resourceB, severityB
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(err.message || `Server returned status ${res.status}`);
      }
      const data = await res.json();
      setConcurrentData(data);
    } catch (err: any) {
      console.error('Concurrent incident launch failed:', err);
      setErrorMsg(err.message || 'Failed to launch concurrent incidents.');
    } finally {
      clearInterval(timer);
      setElapsedMs(Date.now() - startTime);
      setIsRunning(false);
    }
  };

  const renderIncidentPanel = (
    title: string,
    _label: 'A' | 'B',
    bundle: IncidentEvidenceBundle | null,
    borderAccent: string,
    accentClass: string
  ) => {
    if (!bundle) return null;
    const topCandidate = bundle.causalAnalysis?.topCandidate;
    const confidencePercent = topCandidate ? Math.round(topCandidate.confidence * 100) : 0;
    const events = bundle.events ?? [];
    const nodes = bundle.dependencyGraph?.nodes ?? [];
    const hypotheses = bundle.causalAnalysis?.hypotheses ?? [];

    return (
      <div className={clsx('glass-panel p-6 space-y-5 border-t-4', borderAccent)}>
        {/* Panel Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx('text-xs font-mono font-bold uppercase', accentClass)}>{title}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
                {bundle.status}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono text-textMuted border border-border">
                {bundle.scenarioId}
              </span>
            </div>
            <h3 className="text-base font-bold text-textMain mt-1 font-mono">
              ID: {bundle.incidentId}
            </h3>
          </div>
          <div className="text-right">
            <div className="text-xs text-textMuted">{nodes.length} nodes</div>
            <div className="text-xs text-textMuted">{events.length} events</div>
          </div>
        </div>

        {/* Verdict Badge */}
        <div className="p-4 bg-surface/50 border border-border rounded-lg">
          <div className="text-xs font-medium text-textMuted uppercase mb-2 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-critical" />
            Isolated Root Verdict
          </div>
          {topCandidate ? (
            <>
              <div className="text-xl font-bold text-textMain font-mono">
                {topCandidate.serviceId} / {topCandidate.resource}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
                <div
                  className="h-full bg-healthy rounded-full transition-all"
                  style={{ width: `${confidencePercent}%` }}
                />
              </div>
              <div className="text-xs text-healthy font-mono font-semibold mt-1">
                {confidencePercent}% Statistical Confidence
              </div>
            </>
          ) : (
            <div className="text-sm text-textMuted font-mono">UNRESOLVED — insufficient telemetry</div>
          )}
        </div>

        {/* Hypotheses ranking */}
        {hypotheses.length > 0 && (
          <div>
            <div className="text-xs font-medium text-textMuted uppercase mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-info" />
              Hypothesis Ranking
            </div>
            <div className="space-y-1.5">
              {hypotheses.slice(0, 4).map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-textMuted w-4">#{i + 1}</span>
                  <span className={clsx('flex-1 truncate', i === 0 ? 'text-textMain font-bold' : 'text-textMuted')}>
                    {h.serviceId}/{h.resource}
                  </span>
                  <span className={clsx('font-bold', i === 0 ? 'text-healthy' : 'text-textMuted')}>
                    {Math.round(h.confidence * 100)}%
                  </span>
                  <div className="w-16 h-1 rounded-full bg-surface overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full', i === 0 ? 'bg-healthy' : 'bg-textMuted/40')}
                      style={{ width: `${Math.round(h.confidence * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Graph Nodes */}
        <div>
          <div className="text-xs font-medium text-textMuted uppercase mb-2">Service Topology</div>
          <div className="flex flex-wrap gap-1.5">
            {nodes.map(n => (
              <span
                key={n.id}
                className={clsx(
                  'px-2 py-1 rounded text-xs font-mono border',
                  topCandidate?.serviceId === n.id
                    ? 'bg-critical/20 text-critical border-critical/40 font-bold'
                    : 'bg-surfaceHover text-textMain border-border'
                )}
              >
                {n.id}
              </span>
            ))}
          </div>
        </div>

        {/* Event Timeline */}
        <div>
          <div className="text-xs font-medium text-textMuted uppercase mb-2 flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Isolated Evidence Log ({events.length} events)
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {events.slice(-8).reverse().map((e, idx) => (
              <div key={idx} className="p-2 bg-surface/30 border border-border/50 rounded text-[11px] font-mono flex items-center justify-between gap-2">
                <span className="text-info font-bold shrink-0">T#{e.tick}</span>
                <span className="text-textMain flex-1 truncate">{e.type}</span>
                <span className="text-textMuted shrink-0">{(e as any).serviceId || (e as any).callerService || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Completion stats */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
          <div className="text-center">
            <div className="text-xs text-textMuted">Simulation Ticks</div>
            <div className="text-lg font-bold font-mono text-textMain">{bundle.playback.tick}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-textMuted">Events Generated</div>
            <div className="text-lg font-bold font-mono text-textMain">{events.length}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Header & Launcher */}
      <div className="glass-panel p-6">
        <div className="pb-6 border-b border-border">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
              CONCURRENT INCIDENT ISOLATION
            </span>
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
              DUAL INSTANCE ORCHESTRATOR
            </span>
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-info/10 text-info border border-info/20">
              ZERO CROSS-CONTAMINATION
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">Concurrent Incident Analysis</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Simultaneously execute two independent resource exhaustion cascades without cross-contamination</p>
        </div>

        {/* Dual Incident Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
          {/* Incident A Setup */}
          <div className="p-4 bg-surface/40 border border-primary/20 rounded-lg space-y-3">
            <div className="text-xs font-mono font-bold text-primary uppercase flex items-center gap-2">
              <Database className="w-4 h-4" /> Incident A Setup
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Service</label>
                <select
                  value={serviceA}
                  onChange={e => setServiceA(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Resource</label>
                <select
                  value={resourceA}
                  onChange={e => setResourceA(e.target.value as ResourceType)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {RESOURCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Severity</label>
                <select
                  value={severityA}
                  onChange={e => setSeverityA(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="px-2 py-1.5 bg-primary/5 border border-primary/10 rounded text-xs font-mono text-primary">
              → {serviceA} / {resourceA} / {severityA}
            </div>
          </div>

          {/* Incident B Setup */}
          <div className="p-4 bg-surface/40 border border-info/20 rounded-lg space-y-3">
            <div className="text-xs font-mono font-bold text-info uppercase flex items-center gap-2">
              <Server className="w-4 h-4" /> Incident B Setup
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Service</label>
                <select
                  value={serviceB}
                  onChange={e => setServiceB(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Resource</label>
                <select
                  value={resourceB}
                  onChange={e => setResourceB(e.target.value as ResourceType)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {RESOURCES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Severity</label>
                <select
                  value={severityB}
                  onChange={e => setSeverityB(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-textMain font-mono"
                >
                  {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="px-2 py-1.5 bg-info/5 border border-info/10 rounded text-xs font-mono text-info">
              → {serviceB} / {resourceB} / {severityB}
            </div>
          </div>
        </div>

        <button
          id="concurrent-start-btn"
          onClick={handleStartConcurrent}
          disabled={isRunning}
          className="w-full mt-6 flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              EXECUTING DUAL SIMULATIONS... ({elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : ''})
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              START CONCURRENT INCIDENTS
            </>
          )}
        </button>

        {isRunning && (
          <div className="mt-3 p-3 bg-info/5 border border-info/20 rounded-lg text-xs text-info font-mono">
            Running {serviceA}/{resourceA} and {serviceB}/{resourceB} in fully isolated simulation worlds. Zero shared state.
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 p-3 bg-critical/10 border border-critical/20 rounded-lg text-xs text-critical flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Main Split Display */}
      {!concurrentData ? (
        <div className="glass-panel p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Network className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2 tracking-wide">CONCURRENT MODE READY</h2>
          <p className="text-sm text-textMuted max-w-md mb-6 leading-relaxed">
            Configure Incident A and Incident B target failure modes above, then click{' '}
            <strong>"START CONCURRENT INCIDENTS"</strong> to execute dual isolated orchestrators side-by-side.
          </p>
          <div className="flex items-center gap-6 text-xs text-textMuted font-mono">
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary" /> Isolated world per incident</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-healthy" /> Independent causal analysis</span>
            <span className="flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-critical" /> Zero cross-contamination</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Completion bar */}
          <div className="glass-panel p-4 flex items-center justify-between border-l-4 border-l-healthy">
            <div>
              <div className="text-xs text-textMuted font-mono">DUAL SIMULATION COMPLETED</div>
              <div className="text-sm font-bold text-textMain font-mono mt-0.5">
                Incident A: <span className="text-primary">{serviceA}/{resourceA}</span>
                {'  '}vs{'  '}
                Incident B: <span className="text-info">{serviceB}/{resourceB}</span>
              </div>
            </div>
            {elapsedMs != null && (
              <div className="text-xs text-textMuted font-mono">Completed in {(elapsedMs / 1000).toFixed(1)}s</div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {renderIncidentPanel('Incident A (Isolated Instance)', 'A', concurrentData.incidentA, 'border-t-primary', 'text-primary')}
            {renderIncidentPanel('Incident B (Isolated Instance)', 'B', concurrentData.incidentB, 'border-t-info', 'text-info')}
          </div>
        </div>
      )}
    </div>
  );
};
