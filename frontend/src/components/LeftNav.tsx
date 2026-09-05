import React from 'react';
import { useUI } from '../lib/UIContext';
import type { ViewTab } from '../lib/UIContext';
import { useIncident } from '../lib/IncidentContext';
import { LayoutDashboard, Network, Database, FastForward, Beaker, CheckCircle2, Clock, FileText, TrendingUp, Layers, GitFork, Volume2 } from 'lucide-react';
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
  { label: 'Analyst Voice', icon: Volume2 },
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
            return (
              <button
                key={label}
                onClick={() => setActiveTab(label)}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                  active 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-textMuted hover:bg-surfaceHover hover:text-textMain"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </div>
                {!available && (
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
