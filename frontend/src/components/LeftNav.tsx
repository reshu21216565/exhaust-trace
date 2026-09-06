import React from 'react';
import { useUI } from '../lib/UIContext';
import type { ViewTab } from '../lib/UIContext';
import { useIncident } from '../lib/IncidentContext';
import { LayoutDashboard, Network, Database, FastForward, Beaker, CheckCircle2, Clock, FileText, TrendingUp, Layers, GitFork, Volume2, FlaskConical, Terminal } from 'lucide-react';
import { clsx } from 'clsx';

const navItems: { label: ViewTab; icon: React.FC<any> }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Causal Analysis', icon: Network },
  { label: 'Evidence', icon: Database },
  { label: 'Prediction', icon: FastForward },
  { label: 'Experiment', icon: Beaker },
  { label: 'Validation', icon: CheckCircle2 },
  { label: 'Timeline', icon: Clock },
  { label: 'Report', icon: FileText },
  { label: 'Confidence', icon: TrendingUp },
  { label: 'Benchmark', icon: Layers },
  { label: 'Concurrent', icon: GitFork },
  { label: 'Remedy Lab', icon: FlaskConical },
  { label: 'Fix Station', icon: Terminal },
];


export const LeftNav: React.FC = () => {
  const { activeTab, setActiveTab } = useUI();
  const { bundle } = useIncident();
  
  if (!bundle) return null;
  const status = bundle.status;

  // Simple logic to indicate which phases are "active" or "completed" visually
  const isPhaseActive = (tab: ViewTab) => {
    switch (tab) {
      case 'Prediction': return !!bundle.prediction;
      case 'Experiment': return status === 'EXPERIMENT_RUNNING' || status === 'VALIDATED' || status === 'COMPLETED';
      case 'Validation': return status === 'VALIDATED' || status === 'COMPLETED';
      default: return true;
    }
  };

  return (
    <nav className="w-64 border-r border-border bg-surface/30 flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <div className="text-[10px] text-textMuted uppercase tracking-widest mb-3">Investigation Views</div>
        <div className="space-y-1">
          {navItems.map(({ label, icon: Icon }) => {
            const active = activeTab === label;
            const available = isPhaseActive(label);
            const isRemedy = label === 'Remedy Lab';
            const isFixStation = label === 'Fix Station';
            return (
              <button
                key={label}
                onClick={() => setActiveTab(label)}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                  active && !isRemedy && !isFixStation && "bg-primary/10 text-primary border border-primary/20",
                  active && isRemedy && "bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm shadow-amber-500/20 font-bold",
                  !active && isRemedy && "text-amber-400/90 hover:bg-amber-500/10 hover:text-amber-300",
                  active && isFixStation && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/20 font-bold",
                  !active && isFixStation && "text-emerald-400/90 hover:bg-emerald-500/10 hover:text-emerald-300 font-semibold",
                  !active && !isRemedy && !isFixStation && "text-textMuted hover:bg-surfaceHover hover:text-textMain"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </div>
                {isFixStation && (
                  <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold animate-pulse">
                    IMPLEMENT
                  </span>
                )}
                {!available && !isFixStation && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-surface/80 border border-border text-textMuted/70">
                    {label === 'Prediction' ? 'Pending' : 'Locked'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      
      <div className="p-4 mt-auto">
        <div className="text-[10px] text-textMuted uppercase tracking-widest mb-3">Incident Status</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-textMuted">Phase</span>
            <span className={clsx(
              "font-mono px-2 py-0.5 rounded",
              status === 'COMPLETED' ? "bg-healthy/10 text-healthy border border-healthy/20" :
              status === 'ERROR' ? "bg-critical/10 text-critical border border-critical/20" :
              "bg-info/10 text-info border border-info/20"
            )}>
              {status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
};
