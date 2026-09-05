/**
 * AnalystPanel — ExhaustTrace Analyst powered by Gemini.
 * Evidence-grounded Q&A using the actual IncidentEvidenceBundle.
 * Used in both JudgeMode and the AnalystVoiceTab.
 * No API key exposure — all requests go through backend /api/v1/ai/analyze.
 */
import React, { useState, useRef, useEffect } from 'react';
import { useIncident } from '../../lib/IncidentContext';
import {
  Bot, Send, Wifi, WifiOff, Sparkles, MessageSquare,
  ChevronRight, Loader2, RefreshCw
} from 'lucide-react';
import { clsx } from 'clsx';

const API_BASE = 'http://localhost:3001/api/v1';

interface Message {
  id: string;
  role: 'user' | 'analyst';
  text: string;
  geminiAvailable?: boolean;
  timestamp: number;
}

const SUGGESTED_QUESTIONS = [
  'Why is the top hypothesis ranked first?',
  'Why not the second candidate?',
  'Explain the propagation chain.',
  'What evidence changed the confidence?',
  'What did the prediction expect?',
  'Did the experiment validate the hypothesis?',
  'What is happening right now?',
  'Which service is most affected?',
];

interface AnalystPanelProps {
  compact?: boolean;
}

export const AnalystPanel: React.FC<AnalystPanelProps> = ({ compact = false }) => {
  const { bundle } = useIncident();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendQuestion = async (question: string) => {
    const q = question.trim();
    if (!q || isLoading) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: q,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Server error' }));
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`,
          role: 'analyst',
          text: `ExhaustTrace Analyst is unavailable: ${err.message}`,
          geminiAvailable: false,
          timestamp: Date.now(),
        }]);
        setGeminiStatus('unavailable');
        return;
      }

      const data = await res.json();
      setGeminiStatus(data.geminiAvailable ? 'available' : 'unavailable');
      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'analyst',
        text: data.answer,
        geminiAvailable: data.geminiAvailable,
        timestamp: Date.now(),
      }]);
    } catch (err: any) {
      setGeminiStatus('unavailable');
      setMessages(prev => [...prev, {
        id: `a-err-${Date.now()}`,
        role: 'analyst',
        text: 'ExhaustTrace Analyst is currently unavailable. Core causal investigation remains fully operational.',
        geminiAvailable: false,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (compact) {
    // Compact mode for Judge Mode sidebar
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-mono font-bold text-primary uppercase tracking-widest">EXHAUSTTRACE ANALYST</span>
          </div>
          <span className={clsx('flex items-center gap-1 text-[10px] font-mono font-bold', {
            'text-textMuted': geminiStatus === 'unknown',
            'text-healthy': geminiStatus === 'available',
            'text-elevated': geminiStatus === 'unavailable',
          })}>
            {geminiStatus === 'available' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {geminiStatus === 'available' ? 'GEMINI' : geminiStatus === 'unavailable' ? 'FALLBACK' : 'READY'}
          </span>
        </div>

        {/* Message list (compact) */}
        {messages.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {messages.slice(-4).map(msg => (
              <div key={msg.id} className={clsx('text-xs font-mono rounded p-2', {
                'bg-surface/40 text-textMuted border border-border/50 text-right': msg.role === 'user',
                'bg-primary/5 text-textMain border border-primary/10': msg.role === 'analyst',
              })}>
                {msg.role === 'analyst' && (
                  <div className="text-[9px] text-primary font-bold mb-1 flex items-center gap-1">
                    <Bot className="w-2.5 h-2.5" />
                    {msg.geminiAvailable ? 'GEMINI ANALYST' : 'EVIDENCE ENGINE'}
                  </div>
                )}
                <p className="leading-relaxed">{msg.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* Quick chips */}
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_QUESTIONS.slice(0, 3).map(q => (
            <button
              key={q}
              onClick={() => sendQuestion(q)}
              disabled={isLoading}
              className="px-2 py-0.5 text-[9px] font-mono bg-surface border border-border hover:border-primary/40 text-textMuted hover:text-primary rounded transition-colors"
            >
              {q.slice(0, 30)}…
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendQuestion(inputText)}
            placeholder="Ask about the investigation..."
            className="flex-1 bg-background border border-border rounded px-2.5 py-1.5 text-xs text-textMain placeholder:text-textMuted focus:outline-none focus:border-primary font-mono"
          />
          <button
            onClick={() => sendQuestion(inputText)}
            disabled={isLoading || !inputText.trim()}
            className="p-1.5 bg-primary hover:bg-primaryHover disabled:opacity-40 text-white rounded transition-colors"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  }

  // Full-size mode for AnalystVoiceTab
  return (
    <div className="flex-1 p-6 overflow-y-auto bg-background space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-primary/20 text-primary border border-primary/30 flex items-center gap-1.5 uppercase">
              <Bot className="w-3.5 h-3.5" /> EXHAUSTTRACE ANALYST
            </span>
            <span className={clsx('px-2.5 py-1 rounded text-xs font-mono font-bold uppercase flex items-center gap-1.5', {
              'bg-surface text-textMuted border border-border': geminiStatus === 'unknown',
              'bg-healthy/10 text-healthy border border-healthy/20': geminiStatus === 'available',
              'bg-elevated/10 text-elevated border border-elevated/20': geminiStatus === 'unavailable',
            })}>
              {geminiStatus === 'available' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {geminiStatus === 'available' ? 'GEMINI CONNECTED' : geminiStatus === 'unavailable' ? 'AI UNAVAILABLE — EVIDENCE ENGINE ACTIVE' : 'CONNECTED'}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-textMain tracking-tight">ExhaustTrace Analyst</h1>
          <p className="text-xs text-textMuted font-mono mt-1">Grounded in current incident evidence — no fabrication, no hardcoded answers</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="flex items-center gap-1.5 px-3 py-2 border border-border text-textMuted hover:text-textMain hover:bg-surfaceHover rounded-lg text-xs font-mono transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Security Notice */}
      <div className="px-4 py-3 bg-surface border border-border/50 rounded-lg text-[10px] font-mono text-textMuted flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <span>Gemini receives only observable incident evidence — no hidden ground truth, no API keys, no simulation internals. All answers are grounded in <strong className="text-textMain">real IncidentEvidenceBundle data</strong>.</span>
      </div>

      {/* Suggested Questions */}
      <div className="glass-panel p-5">
        <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          Suggested Questions
        </h3>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendQuestion(q)}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border hover:border-primary/40 hover:bg-surfaceHover text-textMuted hover:text-textMain rounded-lg transition-colors"
            >
              <ChevronRight className="w-3 h-3 text-primary" />
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className="glass-panel p-5">
        <h3 className="text-xs font-medium text-textMuted uppercase tracking-wider mb-4 pb-3 border-b border-border flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
          Investigation Q&A
        </h3>

        {messages.length === 0 && !isLoading ? (
          <div className="py-10 text-center text-textMuted">
            <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Ask a question about the current investigation above.</p>
            <p className="text-xs mt-1 text-textMuted/60">Answers are grounded in the actual incident evidence bundle.</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {messages.map(msg => (
              <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'analyst' && (
                  <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <div className={clsx('max-w-[85%] rounded-xl px-4 py-3 text-sm', {
                  'bg-primary/10 text-textMain border border-primary/10': msg.role === 'user',
                  'bg-surface border border-border text-textMain': msg.role === 'analyst',
                })}>
                  {msg.role === 'analyst' && (
                    <div className={clsx('text-[10px] font-mono font-bold mb-1.5 flex items-center gap-1.5', msg.geminiAvailable ? 'text-primary' : 'text-textMuted')}>
                      {msg.geminiAvailable ? (
                        <><Wifi className="w-2.5 h-2.5" /> GEMINI ANALYST</>
                      ) : (
                        <><Sparkles className="w-2.5 h-2.5" /> EVIDENCE ENGINE (OFFLINE FALLBACK)</>
                      )}
                    </div>
                  )}
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <div className="text-[10px] text-textMuted mt-1.5 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-surface border border-border rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-textMuted font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    Analyzing incident evidence...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="glass-panel p-4">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            id="analyst-question-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendQuestion(inputText)}
            placeholder="Ask about the investigation... (e.g. Why is the top hypothesis ranked first?)"
            className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-textMain placeholder:text-textMuted focus:outline-none focus:border-primary font-mono transition-colors"
          />
          <button
            id="analyst-send-btn"
            onClick={() => sendQuestion(inputText)}
            disabled={isLoading || !inputText.trim()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors shadow"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            ASK
          </button>
        </div>
        {geminiStatus === 'unavailable' && (
          <p className="text-[10px] text-elevated font-mono mt-2 flex items-center gap-1">
            <WifiOff className="w-3 h-3" />
            Gemini AI is currently unavailable. Answers are generated from the evidence engine using actual incident data.
          </p>
        )}
      </div>
    </div>
  );
};
