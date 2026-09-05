import React from 'react';
import { useIncident } from '../lib/IncidentContext';
import { useUI } from '../lib/UIContext';
import { Activity, Play, Pause, FastForward, RotateCcw, Network } from 'lucide-react';
import { clsx } from 'clsx';

export const TopBar: React.FC = () => {
  const { bundle, isConnected, pause, resume, step, setSpeed, reset } = useIncident();
  const { setJudgeMode } = useUI();

  if (!bundle) return null;

  const { incidentId, playback } = bundle;
  const isRunning = playback.isRunning;

  return (
    <header className="h-14 glass-header px-4 flex items-center justify-between shrink-0 z-50">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-sm font-bold tracking-widest text-textMain leading-tight">EXHAUSTTRACE</h1>
            <p className="text-[10px] text-textMuted uppercase tracking-wider leading-tight">Causal Debugger</p>
          </div>
        </div>
        
        <div className="h-6 w-px bg-border" />
        
        <div className="flex items-center gap-2 text-xs">
          <span className="text-textMuted uppercase">Incident:</span>
          <span className="font-mono text-textMain bg-surface px-2 py-0.5 rounded border border-border">{incidentId.split('-')[1]}</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className={clsx("w-2 h-2 rounded-full", isConnected ? "bg-healthy" : "bg-critical animate-pulse")} />
          <span className="text-textMuted uppercase tracking-wider">{isConnected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Playback Controls */}
        <div className="flex items-center bg-surface border border-border rounded-lg overflow-hidden p-0.5">
          <button onClick={reset} title="Reset" className="p-1.5 text-textMuted hover:text-textMain hover:bg-surfaceHover rounded">
            <RotateCcw className="w-4 h-4" />
          </button>
          
          <div className="w-px h-4 bg-border mx-1" />
          
          {isRunning ? (
            <button onClick={pause} title="Pause" className="p-1.5 text-elevated hover:text-elevated hover:bg-surfaceHover rounded">
              <Pause className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button onClick={resume} title="Play" className="p-1.5 text-healthy hover:text-healthy hover:bg-surfaceHover rounded">
              <Play className="w-4 h-4 fill-current" />
            </button>
          )}
          
          <button onClick={step} disabled={isRunning} title="Step" className="p-1.5 text-textMuted hover:text-textMain hover:bg-surfaceHover rounded disabled:opacity-30">
            <FastForward className="w-4 h-4" />
          </button>
          
          <div className="w-px h-4 bg-border mx-1" />
          
          <select 
            className="bg-transparent text-xs font-mono text-textMuted outline-none px-1 appearance-none cursor-pointer hover:text-textMain"
            value={playback.speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={2}>2.0x</option>
            <option value={4}>4.0x</option>
            <option value={8}>8.0x</option>
          </select>
        </div>

        {/* Tick Counter */}
        <div className="flex flex-col items-end justify-center min-w-[60px]">
          <span className="text-[10px] text-textMuted uppercase tracking-widest leading-none mb-1">Tick</span>
          <span className="font-mono text-sm leading-none">{playback.tick.toString().padStart(4, '0')}</span>
        </div>

        <div className="h-6 w-px bg-border mx-2" />

        <button 
          onClick={() => setJudgeMode(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border hover:border-primary/50 text-xs text-textMain rounded-md transition-colors"
        >
          <Network className="w-3.5 h-3.5" />
          JUDGE MODE
        </button>
      </div>
    </header>
  );
};
