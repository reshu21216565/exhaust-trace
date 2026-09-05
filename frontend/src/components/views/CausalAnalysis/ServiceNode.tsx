import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { clsx } from 'clsx';
import { Server, Activity, ArrowRight } from 'lucide-react';

export const ServiceNode: React.FC<any> = ({ data }) => {
  const { serviceId, metrics, resources, isTopCandidate, isSelected, onSelect } = data;

  const getStatusColor = (health: string) => {
    switch (health) {
      case 'CRITICAL': return 'text-critical';
      case 'HIGH': return 'text-degraded';
      case 'ELEVATED': return 'text-elevated';
      default: return 'text-healthy';
    }
  };

  const getStatusDot = (health: string) => {
    switch (health) {
      case 'CRITICAL': return 'bg-critical';
      case 'HIGH': return 'bg-degraded';
      case 'ELEVATED': return 'bg-elevated';
      default: return 'bg-healthy';
    }
  };

  const healthOrder = { HEALTHY: 0, ELEVATED: 1, HIGH: 2, CRITICAL: 3 } as const;
  const derivedHealth = (Object.values(resources ?? {}) as Array<{ status?: string }>).reduce((highest, resource) => {
    const status = resource?.status ?? 'HEALTHY';
    return healthOrder[status as keyof typeof healthOrder] > healthOrder[highest as keyof typeof healthOrder]
      ? status
      : highest;
  }, 'HEALTHY' as string);

  // Safe fallback if metrics are missing (e.g. before first tick)
  const cpu = (resources?.CPU?.utilization ?? 0) * 100;
  const memory = (resources?.MEMORY?.utilization ?? 0) * 100;
  const connections = (resources?.CONNECTIONS?.utilization ?? 0) * 100;
  const workers = (resources?.WORKERS?.utilization ?? 0) * 100;

  const health = derivedHealth;

  const drawBar = (pct: number) => {
    const bars = Math.round((pct / 100) * 10);
    return '█'.repeat(Math.max(0, Math.min(10, bars))) + '░'.repeat(Math.max(0, 10 - Math.min(10, bars)));
  };

  return (
    <>
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-textMuted border-none" />
      
      <div 
        onClick={onSelect}
        className={clsx(
          "w-[260px] glass-panel p-4 cursor-pointer transition-all duration-200 select-none",
          isSelected ? "ring-2 ring-primary bg-surfaceHover shadow-xl" : "hover:border-primary/50",
          isTopCandidate && !isSelected && "ring-1 ring-degraded shadow-[0_0_15px_rgba(249,115,22,0.15)]"
        )}
      >
        <div className="flex items-center justify-between mb-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Server className={clsx("w-4 h-4", getStatusColor(health))} />
            <h3 className="text-sm font-bold tracking-wide">{serviceId}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={clsx("w-2 h-2 rounded-full", getStatusDot(health))} />
            <span className={clsx("text-[10px] font-bold tracking-wider", getStatusColor(health))}>
              {health}
            </span>
          </div>
        </div>

        <div className="space-y-1.5 mb-4">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-textMuted w-24">CPU</span>
            <span className={cpu > 80 ? 'text-critical' : 'text-textMain'}>{Math.round(cpu)}%</span>
            <span className="text-textMuted/50 tracking-[2px]">{drawBar(cpu)}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-textMuted w-24">MEMORY</span>
            <span className={memory > 80 ? 'text-critical' : 'text-textMain'}>{Math.round(memory)}%</span>
            <span className="text-textMuted/50 tracking-[2px]">{drawBar(memory)}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-textMuted w-24">CONNECTIONS</span>
            <span className={connections > 80 ? 'text-critical' : 'text-textMain'}>{Math.round(connections)}%</span>
            <span className="text-textMuted/50 tracking-[2px]">{drawBar(connections)}</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-textMuted w-24">WORKERS</span>
            <span className={workers > 80 ? 'text-critical' : 'text-textMain'}>{Math.round(workers)}%</span>
            <span className="text-textMuted/50 tracking-[2px]">{drawBar(workers)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-1.5 text-xs text-textMain font-mono">
            <Activity className="w-3.5 h-3.5 text-textMuted" />
            {Math.round(metrics?.latencyMs ?? 0)} <span className="text-textMuted text-[10px] font-sans">ms</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-textMain font-mono">
            <ArrowRight className="w-3.5 h-3.5 text-textMuted" />
            {metrics?.queueDepth ?? 0} <span className="text-textMuted text-[10px] font-sans">q</span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-textMuted border-none" />
    </>
  );
};
