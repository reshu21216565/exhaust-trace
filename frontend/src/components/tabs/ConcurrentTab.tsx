import React, { useState } from 'react';
import { Network, Play, ShieldAlert, CheckCircle2, Loader2, Cpu, Database, Server } from 'lucide-react';
import { clsx } from 'clsx';
import type { IncidentEvidenceBundle, ResourceType } from '@exhausttrace/shared';

export const ConcurrentTab: React.FC = () => {
  const [serviceA, setServiceA] = useState<string>('records');
  const [resourceA, setResourceA] = useState<ResourceType>('MEMORY');
  const [severityA, setSeverityA] = useState<string>('CRITICAL');

  const [serviceB, setServiceB] = useState<string>('portal');
  const [resourceB, setResourceB] = useState<ResourceType>('CPU');
  const [severityB, setSeverityB] = useState<string>('CRITICAL');

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [concurrentData, setConcurrentData] = useState<{
    incidentA: IncidentEvidenceBundle | null;
    incidentB: IncidentEvidenceBundle | null;
  } | null>(null);

  const handleStartConcurrent = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/concurrent-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceA, resourceA, severityA,
          serviceB, resourceB, severityB
        })
      });
      if (res.ok) {
        const data = await res.json();
        setConcurrentData(data);
      }
    } catch (err) {
      console.error("Concurrent incident launch failed:", err);
    } finally {
      setIsRunning(false);
    }
  };

  const renderIncidentPanel = (title: string, bundle: IncidentEvidenceBundle | null, borderAccent: string) => {
    if (!bundle) return null;
    const topCandidate = bundle.causalAnalysis?.topCandidate;
    const confidencePercent = topCandidate ? Math.round(topCandidate.confidence * 100) : 0;
    const events = bundle.events ?? [];
    const nodes = bundle.dependencyGraph?.nodes ?? [];

    return (
      <div className={clsx("glass-panel p-6 space-y-4 border-l-4", borderAccent)}>
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-primary uppercase">{title}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
                {bundle.status}
              </span>
            </div>
            <h3 className="text-lg font-bold text-textMain mt-1 font-mono">
              ID: #{bundle.incidentId || 'INC-A'}
            </h3>
          </div>
          <span className="text-xs font-mono text-textMuted">{nodes.length} Graph Nodes</span>
        </div>

        {/* Verdict Badge */}
        <div className="p-4 bg-surface/50 border border-border rounded-lg">
          <div className="text-xs font-medium text-textMuted uppercase mb-1 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-critical" />
            Isolated Root Verdict
          </div>
          <div className="text-lg font-bold text-textMain font-mono">
            {topCandidate ? `${topCandidate.serviceId} / ${topCandidate.resource}` : 'UNRESOLVED'}
          </div>
          <div className="text-xs text-healthy font-mono font-semibold mt-1">
            {confidencePercent}% Statistical Confidence
          </div>
        </div>

        {/* Graph Nodes Highlight */}
        <div>
          <div className="text-xs font-medium text-textMuted uppercase mb-2">Monitored Service Topology</div>
          <div className="flex flex-wrap gap-2">
            {nodes.map(n => (
              <span
                key={n.id}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs font-mono border",
                  topCandidate?.serviceId === n.id
                    ? "bg-critical/20 text-critical border-critical/40 font-bold"
                    : "bg-surfaceHover text-textMain border-border"
                )}
              >
                {n.id}
              </span>
            ))}
          </div>
        </div>

        {/* Evidence Events Timeline */}
        <div>
          <div className="text-xs font-medium text-textMuted uppercase mb-2">Isolated Evidence Log ({events.length} Events)</div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {events.slice(-5).map((e, idx) => (
              <div key={idx} className="p-2 bg-surface/30 border border-border/50 rounded text-xs font-mono flex items-center justify-between">
                <span className="text-info font-bold">Tick #{e.tick}</span>
                <span className="text-textMain">{e.type}</span>
                <span className="text-textMuted font-mono">{(e as any).serviceId || (e as any).callerService}</span>
              </div>
            ))}
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
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
              CONCURRENT INCIDENT ISOLATION
            </span>
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-healthy/10 text-healthy border border-healthy/20">
              DUAL INSTANCE ORCHESTRATOR
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">Concurrent Incident Analysis</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Simultaneously execute two independent resource exhaustion cascades without cross-contamination</p>
        </div>

        {/* Dual Incident Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
          {/* Incident A Setup */}
          <div className="p-4 bg-surface/40 border border-border rounded-lg space-y-3">
            <div className="text-xs font-mono font-bold text-primary uppercase flex items-center gap-2">
              <Database className="w-4 h-4" /> Incident A Setup
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Target Service</label>
                <select
                  value={serviceA}
                  onChange={e => setServiceA(e.target.value)}
                  className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-xs text-textMain font-mono"
                >
                  <option value="records">records</option>
                  <option value="appointment">appointment</option>
                  <option value="portal">portal</option>
                  <option value="notification">notification</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Resource</label>
                <select
                  value={resourceA}
                  onChange={e => setResourceA(e.target.value as ResourceType)}
                  className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-xs text-textMain font-mono"
                >
                  <option value="MEMORY">MEMORY</option>
                  <option value="CPU">CPU</option>
                  <option value="CONNECTIONS">CONNECTIONS</option>
                  <option value="WORKERS">WORKERS</option>
                </select>
              </div>
            </div>
          </div>

          {/* Incident B Setup */}
          <div className="p-4 bg-surface/40 border border-border rounded-lg space-y-3">
            <div className="text-xs font-mono font-bold text-info uppercase flex items-center gap-2">
              <Server className="w-4 h-4" /> Incident B Setup
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Target Service</label>
                <select
                  value={serviceB}
                  onChange={e => setServiceB(e.target.value)}
                  className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-xs text-textMain font-mono"
                >
                  <option value="portal">portal</option>
                  <option value="appointment">appointment</option>
                  <option value="records">records</option>
                  <option value="notification">notification</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-textMuted uppercase mb-1">Resource</label>
                <select
                  value={resourceB}
                  onChange={e => setResourceB(e.target.value as ResourceType)}
                  className="w-full bg-surface border border-border rounded px-2.5 py-1.5 text-xs text-textMain font-mono"
                >
                  <option value="CPU">CPU</option>
                  <option value="MEMORY">MEMORY</option>
                  <option value="CONNECTIONS">CONNECTIONS</option>
                  <option value="WORKERS">WORKERS</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleStartConcurrent}
          disabled={isRunning}
          className="w-full mt-6 flex items-center justify-center gap-2 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-50 text-white rounded-lg font-medium text-sm transition-colors shadow-lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              RUNNING CONCURRENT INSTANCES...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-white" />
              START CONCURRENT INCIDENTS
            </>
          )}
        </button>
      </div>

      {/* Main Split Display */}
      {!concurrentData || !concurrentData.incidentA ? (
        <div className="glass-panel p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Network className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2 tracking-wide">CONCURRENT MODE READY</h2>
          <p className="text-sm text-textMuted max-w-md mb-6 leading-relaxed">
            Configure Incident A and Incident B target failure modes above, then click <strong>"START CONCURRENT INCIDENTS"</strong> to execute dual isolated orchestrators side-by-side.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderIncidentPanel("Incident A (Isolated Instance)", concurrentData.incidentA, "border-l-primary")}
          {renderIncidentPanel("Incident B (Isolated Instance)", concurrentData.incidentB, "border-l-info")}
        </div>
      )}
    </div>
  );
};
