import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { Database, ThumbsUp, Info } from 'lucide-react';
import { clsx } from 'clsx';
import type { CausalHypothesis } from '@exhausttrace/shared';

export const Evidence: React.FC = () => {
  const { bundle } = useIncident();
  if (!bundle || !bundle.causalAnalysis) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center max-w-lg mx-auto">
        <Database className="w-12 h-12 text-primary/70 mb-4 animate-pulse" />
        <h2 className="text-xl font-bold tracking-wide mb-2">Awaiting Causal Evidence Matrix</h2>
        <p className="text-textMuted text-sm mb-6 leading-relaxed">
          The causal analysis engine requires at least 10 ticks of active telemetry observation to generate hypothesis evidence scores.
        </p>
        <div className="glass-panel p-4 w-full text-xs text-textMuted font-mono border-l-4 border-l-primary flex items-center justify-between">
          <span>PIPELINE STATUS</span>
          <span className="text-primary font-bold">ACCUMULATING TELEMETRY</span>
        </div>
      </div>
    );
  }

  const { hypotheses } = bundle.causalAnalysis;

  const dimensions = [
    { key: 'resourcePressure', label: 'Pressure' },
    { key: 'temporalPrecedence', label: 'Temporal' },
    { key: 'downstreamPropagation', label: 'Propagation' },
    { key: 'queueGrowth', label: 'Queue' },
    { key: 'latencyCorrelation', label: 'Latency' },
    { key: 'noisePenalty', label: 'Noise' },
  ];

  const getEvidenceDot = (hypothesis: CausalHypothesis, category: string) => {
    const matches = hypothesis.evidence.filter(e => e.category === category);
    if (matches.length === 0) return <span className="text-border text-center w-full block">—</span>;
    const isSupporting = matches.some(e => e.isSupporting);
    return isSupporting
      ? <div className="w-3 h-3 rounded-full bg-healthy mx-auto shadow-[0_0_8px_rgba(16,185,129,0.4)]" title={matches[0].description} />
      : <div className="w-3 h-3 rounded-full bg-critical mx-auto shadow-[0_0_8px_rgba(239,68,68,0.4)]" title={matches[0].description} />;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Causal Evidence Matrix
          </h2>
          <p className="text-sm text-textMuted mt-1">Structured evidence supporting or refuting each candidate hypothesis</p>
        </div>
        <div className="px-3 py-1 bg-surface border border-border rounded text-xs font-mono text-textMuted flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-healthy animate-pulse" />
          ANALYZED THROUGH TICK #{bundle.causalAnalysis.analyzedThroughTick}
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-surface border-b border-border text-xs uppercase tracking-wider text-textMuted">
              <tr>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Candidate</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Conf</th>
                {dimensions.map(dim => (
                  <th key={dim.key} className="px-3 py-3 font-medium text-center">{dim.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {hypotheses.map((h, i) => (
                <tr key={h.candidateId} className={clsx("hover:bg-surfaceHover transition-colors", i === 0 && "bg-surfaceHover/50")}>
                  <td className="px-4 py-3 font-mono text-textMuted">#{h.rank}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold">{h.serviceId}</div>
                    <div className="text-xs text-textMuted font-mono">{h.resource}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{Math.round(h.score)}</td>
                  <td className="px-4 py-3 font-mono">{Math.round(h.confidence * 100)}%</td>
                  {dimensions.map(dim => (
                    <td key={dim.key} className="px-3 py-3 text-center">
                      {getEvidenceDot(h, dim.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 border-l-4 border-l-healthy">
          <div className="flex items-center gap-2 mb-4">
            <ThumbsUp className="w-5 h-5 text-healthy" />
            <h3 className="font-bold tracking-wide">Why {hypotheses[0]?.serviceId} / {hypotheses[0]?.resource}?</h3>
          </div>
          <ul className="space-y-2">
            {hypotheses[0]?.evidence.filter(e => e.isSupporting).slice(0, 6).map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-healthy mt-0.5 shrink-0">•</span>
                <span className="text-textMain">{e.description}
                  <span className="text-textMuted text-xs ml-2 font-mono">(+{e.scoreImpact.toFixed(1)})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {hypotheses.length > 1 && (
          <div className="glass-panel p-6 border-l-4 border-l-border">
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-5 h-5 text-textMuted" />
              <h3 className="font-bold tracking-wide">Why not {hypotheses[1]?.serviceId} / {hypotheses[1]?.resource}?</h3>
            </div>
            <ul className="space-y-2">
              {hypotheses[1]?.evidence.filter(e => !e.isSupporting).slice(0, 6).map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="text-critical mt-0.5 shrink-0">•</span>
                  <span className="text-textMain">{e.description}
                    <span className="text-textMuted text-xs ml-2 font-mono">({e.scoreImpact.toFixed(1)})</span>
                  </span>
                </li>
              ))}
              {hypotheses[1]?.evidence.filter(e => !e.isSupporting).length === 0 && (
                <p className="text-sm text-textMuted">Insufficient relative evidence to overcome the top candidate.</p>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
