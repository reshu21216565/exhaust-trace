import React, { useState, useEffect, useRef } from 'react';
import { Bot, MessageSquare, Loader2, Send } from 'lucide-react';
import { useIncident } from '../lib/IncidentContext';
import { useUI } from '../lib/UIContext';

const getFrontendFallback = (tab: string): string[] => {
  const norm = tab.toLowerCase().trim().replace(/\s+/g, '-');
  switch (norm) {
    case 'overview':
      return [
        'Why is the top hypothesis ranked first?',
        'What evidence supports the current candidate?',
        'Show the main anomaly propagation chain.',
        'What telemetry metrics triggered the alert?'
      ];
    case 'causal-analysis':
    case 'evidence':
      return [
        'Why is candidate #1 ranked first?',
        'Which evidence category scored highest?',
        'How are competing hypotheses penalized?',
        'What signals contradict the top candidate?'
      ];
    case 'prediction':
      return [
        'What recovery targets does prediction forecast?',
        'How many ticks is the expected horizon?',
        'What state transitions follow relief?',
        'Why freeze baseline before intervention?'
      ];
    case 'experiment':
      return [
        'How does root relief compare to symptom relief?',
        'Did latency collapse during root trial?',
        'Which metrics recovered fastest in replay?',
        'Why test symptom intervention separately?'
      ];
    case 'validation':
      return [
        'Did actual recovery match predictions?',
        'What is the cascade collapse score?',
        'Were all recovery milestones achieved?',
        'Why was validation status confirmed?'
      ];
    case 'confidence':
      return [
        'How did confidence progress over ticks?',
        'What evidence caused the confidence surge?',
        'When did top hypothesis become dominant?',
        'How stable are candidate rankings over time?'
      ];
    case 'timeline':
      return [
        'What event sequence initiated the failure?',
        'Which microservice degraded first?',
        'How did pressure propagate chronologically?',
        'What tick recorded peak queue depth?'
      ];
    case 'benchmark':
      return [
        'How does time-to-diagnosis compare across runs?',
        'What is the prediction accuracy score?',
        'How consistent are scenario candidate rankings?',
        'What is the average diagnostic latency?'
      ];
    case 'concurrent':
      return [
        'How were dual incidents isolated?',
        'Which incident started first in timeline?',
        'How are overlapping cascades separated?',
        'What signals differentiate root failures?'
      ];
    case 'remedy-lab':
    case 'fix-station':
      return [
        'What mitigation plan is recommended for this failure?',
        'How will code patches prevent future resource exhaustion?',
        'What system safety checks validate the fix?',
        'How does the remedy plan restore baseline capacity?'
      ];
    default:
      return [
        'Why is the top hypothesis ranked first?',
        'Why not the second candidate?',
        'Show the propagation chain.',
        'What did the prediction expect?'
      ];
  }
};

export const RightDrawer: React.FC = () => {
  const { bundle } = useIncident();
  const { activeTab } = useUI();

  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    {
      role: 'assistant',
      text: 'I answer from the observable incident evidence only. Ask me about the current hypothesis, prediction, or validation trail.'
    }
  ]);
  const [questionInput, setQuestionInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState<boolean>(true);
  const cacheRef = useRef<Record<string, string[]>>({});

  // Fetch or retrieve cached tab-relevant suggested queries
  useEffect(() => {
    let isMounted = true;
    const topCandidate = bundle?.causalAnalysis?.topCandidate?.serviceId || 'none';
    const hasPrediction = bundle?.prediction ? 'pred' : 'nopred';
    const hasValidation = bundle?.rootValidation ? 'val' : 'noval';
    const status = bundle?.status || 'IDLE';

    const cacheKey = `${activeTab}:${status}:${topCandidate}:${hasPrediction}:${hasValidation}`;

    if (cacheRef.current[cacheKey]) {
      setSuggestedQueries(cacheRef.current[cacheKey]);
      setIsLoadingQueries(false);
      return;
    }

    setIsLoadingQueries(true);

    fetch('http://localhost:3001/api/v1/incident/suggested-queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab: activeTab })
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load queries');
        return res.json();
      })
      .then(data => {
        if (!isMounted) return;
        const queries = Array.isArray(data?.queries) && data.queries.length > 0
          ? data.queries
          : getFrontendFallback(activeTab);
        cacheRef.current[cacheKey] = queries;
        setSuggestedQueries(queries);
      })
      .catch(() => {
        if (!isMounted) return;
        const fallback = getFrontendFallback(activeTab);
        cacheRef.current[cacheKey] = fallback;
        setSuggestedQueries(fallback);
      })
      .finally(() => {
        if (isMounted) setIsLoadingQueries(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeTab, bundle?.status, bundle?.causalAnalysis?.topCandidate?.serviceId, bundle?.prediction, bundle?.rootValidation]);

  // Hide the global Analyst drawer specifically on the Fix Station section
  if (activeTab === 'Fix Station') {
    return null;
  }

  const submitQuery = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isThinking) return;

    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setQuestionInput('');
    setErrorText(null);
    setIsThinking(true);

    try {
      const res = await fetch('http://localhost:3001/api/v1/incident/analyst-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed })
      });

      if (!res.ok) {
        const details = await res.text();
        throw new Error(details || 'Analyst temporarily unavailable — try again');
      }

      const answer = await res.text();
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: answer || 'I don’t have enough confidence in the current evidence to answer that decisively.'
      }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analyst temporarily unavailable — try again';
      setErrorText('Analyst temporarily unavailable — try again');
      setMessages(prev => [...prev, { role: 'assistant', text: message }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <aside className="w-80 border-l border-border bg-surface/50 flex flex-col shrink-0">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-info" />
          <h2 className="text-sm font-semibold tracking-wide">EXHAUSTTRACE ANALYST</h2>
        </div>
        <div className="px-2 py-0.5 rounded text-[10px] font-mono border border-border bg-background text-textMuted uppercase tracking-wider">
          {isThinking ? 'Thinking...' : 'Online'}
        </div>
      </div>

      <div className="flex-1 flex flex-col p-4 overflow-y-auto gap-4">
        <p className="text-xs text-textMuted italic">Grounded in current incident evidence</p>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.map((msg, idx) => (
            <div key={`${msg.role}-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary/10 border-primary/30 text-textMain'
                    : 'bg-background border-border text-textMain'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-lg border border-border bg-background px-3 py-2 text-xs text-textMuted flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            </div>
          )}
        </div>

        {errorText && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
            {errorText}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border">
          <h3 className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-3">Suggested Queries</h3>
          
          {isLoadingQueries ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="w-full p-2 rounded bg-surface/50 border border-border/50 h-8 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {suggestedQueries.map((q) => (
                <button
                  key={q}
                  onClick={() => submitQuery(q)}
                  disabled={isThinking || !bundle}
                  className="w-full text-left p-2 rounded bg-surface border border-border text-xs text-textMain hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <input
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitQuery(questionInput);
                }
              }}
              placeholder="Ask a follow-up..."
              className="flex-1 rounded border border-border bg-background px-3 py-2 text-xs text-textMain placeholder:text-textMuted outline-none focus:border-primary/50"
            />
            <button
              onClick={() => submitQuery(questionInput)}
              disabled={isThinking || !questionInput.trim() || !bundle}
              className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Send question"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

