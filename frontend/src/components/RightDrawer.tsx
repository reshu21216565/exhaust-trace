import React from 'react';
import { Bot, MessageSquare } from 'lucide-react';

export const RightDrawer: React.FC = () => {
  return (
    <aside className="w-80 border-l border-border bg-surface/50 flex flex-col shrink-0">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-info" />
          <h2 className="text-sm font-semibold tracking-wide">EXHAUSTTRACE ANALYST</h2>
        </div>
        <div className="px-2 py-0.5 rounded text-[10px] font-mono border border-border bg-background text-textMuted uppercase tracking-wider">
          Disconnected
        </div>
      </div>
      
      <div className="flex-1 flex flex-col p-4 overflow-y-auto">
        <p className="text-xs text-textMuted mb-6 italic">Grounded in current incident evidence</p>
        
        <div className="bg-background border border-border border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center mt-auto mb-auto">
          <MessageSquare className="w-8 h-8 text-border mb-3" />
          <p className="text-sm text-textMuted font-medium mb-2">AI Analyst Unavailable</p>
          <p className="text-xs text-textMuted/70">
            The Gemini backend integration is not yet connected for this session.
          </p>
        </div>

        <div className="mt-auto">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Suggested Queries</h3>
          <div className="space-y-2">
            {[
              "Why is Records Memory the top hypothesis?",
              "Why not Appointment Workers?",
              "Show the propagation chain.",
              "What did the prediction expect?",
              "Did the intervention validate it?"
            ].map(q => (
              <button key={q} disabled className="w-full text-left p-2 rounded bg-surface border border-border text-xs text-textMuted/50 cursor-not-allowed">
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
