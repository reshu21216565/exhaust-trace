/**
 * AIFaultInjector — Judge Mode AI Fault Injection Panel
 *
 * Security contract:
 *   - No Gemini API calls from frontend
 *   - All interpretation routes through backend /api/v1/ai/interpret-fault
 *   - All execution routes through backend /api/v1/ai/inject-fault (double-validated)
 *   - User must explicitly confirm before injection
 *   - Never executes on interpretation alone
 */
import React, { useState, useRef } from 'react';
import {
  Zap, Loader2, CheckCircle2, AlertTriangle, XCircle,
  MessageSquare, ShieldAlert, RotateCcw, ArrowRight, HelpCircle, Bot, Sparkles
} from 'lucide-react';
import { clsx } from 'clsx';

const API_BASE = 'http://localhost:3001/api/v1';

type InjectorState =
  | 'IDLE'
  | 'INTERPRETING'
  | 'AWAITING_CONFIRMATION'
  | 'INJECTING'
  | 'INJECTED'
  | 'REJECTED'
  | 'AMBIGUOUS'
  | 'UNSUPPORTED'
  | 'ERROR';

interface InterpretResult {
  intent: string;
  serviceId: string | null;
  resource: string | null;
  severity: string | null;
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
  geminiAvailable: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface InterpretResponse {
  interpretation: InterpretResult;
  validation: ValidationResult | null;
  auditEvent: { type: string; summary: string };
}

const EXAMPLE_PROMPTS = [
  'Inject critical memory exhaustion into Records.',
  'Exhaust the worker pool on Appointment Service.',
  'Cause high CPU pressure on Records.',
  'Create a critical connection exhaustion on Records.',
];

export const AIFaultInjector: React.FC<{ onInjected?: () => void }> = ({ onInjected }) => {
  const [inputText, setInputText] = useState('');
  const [state, setState] = useState<InjectorState>('IDLE');
  const [interpretation, setInterpretation] = useState<InterpretResult | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<Array<{ type: string; summary: string; time: string }>>([]);
  const [injectedCommand, setInjectedCommand] = useState<{ serviceId: string; resource: string; severity: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addAudit = (type: string, summary: string) => {
    setAuditLog(prev => [{ type, summary, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
  };

  const handleInterpret = async () => {
    const text = inputText.trim();
    if (!text) return;

    setState('INTERPRETING');
    setInterpretation(null);
    setValidation(null);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/ai/interpret-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data: InterpretResponse = await res.json();

      addAudit(data.auditEvent.type, data.auditEvent.summary);
      setInterpretation(data.interpretation);
      setValidation(data.validation);

      if (data.interpretation.intent === 'FAULT_INJECTION' && data.validation?.valid) {
        setState('AWAITING_CONFIRMATION');
      } else if (data.interpretation.intent === 'AMBIGUOUS' || data.interpretation.clarificationRequired) {
        setState('AMBIGUOUS');
      } else if (data.interpretation.intent === 'UNSUPPORTED') {
        setState('UNSUPPORTED');
      } else if (data.interpretation.intent === 'INVESTIGATION_QUESTION') {
        setState('REJECTED');
        setErrorMsg('This looks like an investigation question, not a fault injection request. Try the ExhaustTrace Analyst panel below.');
      } else if (data.validation && !data.validation.valid) {
        setState('REJECTED');
        setErrorMsg(data.validation.errors.join('; '));
      } else {
        setState('REJECTED');
        setErrorMsg('Could not determine a valid fault command from your request.');
      }
    } catch (err: any) {
      setState('ERROR');
      setErrorMsg('Backend unavailable. Is the ExhaustTrace server running?');
    }
  };

  const handleInject = async () => {
    if (!interpretation?.serviceId || !interpretation?.resource || !interpretation?.severity) return;

    setState('INJECTING');
    try {
      const res = await fetch(`${API_BASE}/ai/inject-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: interpretation.serviceId,
          resource: interpretation.resource,
          severity: interpretation.severity,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setState('REJECTED');
        setErrorMsg(data.errors?.join('; ') || data.message || 'Injection rejected by server.');
        addAudit('AI_FAULT_REJECTED', data.auditEvent?.summary ?? 'Fault rejected');
        return;
      }

      setInjectedCommand({ serviceId: interpretation.serviceId!, resource: interpretation.resource!, severity: interpretation.severity! });
      setState('INJECTED');
      addAudit('AI_FAULT_INJECTED', data.auditEvent?.summary ?? 'Fault injected');
      onInjected?.();
    } catch (err: any) {
      setState('ERROR');
      setErrorMsg('Backend unavailable during injection.');
    }
  };

  const handleReset = () => {
    setState('IDLE');
    setInputText('');
    setInterpretation(null);
    setValidation(null);
    setErrorMsg(null);
    setInjectedCommand(null);
  };

  const stateColor = {
    IDLE: 'text-textMuted',
    INTERPRETING: 'text-info',
    AWAITING_CONFIRMATION: 'text-elevated',
    INJECTING: 'text-info',
    INJECTED: 'text-healthy',
    REJECTED: 'text-critical',
    AMBIGUOUS: 'text-elevated',
    UNSUPPORTED: 'text-critical',
    ERROR: 'text-critical',
  }[state] ?? 'text-textMuted';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono font-bold text-primary uppercase tracking-widest">AI FAULT INJECTION</span>
          </div>
          <p className="text-[10px] text-textMuted font-mono">Describe an incident in natural language → Gemini interprets → you confirm → real simulation</p>
        </div>
        <div className={clsx('flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase', stateColor)}>
          <span className={clsx('w-2 h-2 rounded-full', {
            'bg-textMuted': state === 'IDLE',
            'bg-info animate-pulse': state === 'INTERPRETING' || state === 'INJECTING',
            'bg-elevated animate-pulse': state === 'AWAITING_CONFIRMATION' || state === 'AMBIGUOUS',
            'bg-healthy': state === 'INJECTED',
            'bg-critical': state === 'REJECTED' || state === 'UNSUPPORTED' || state === 'ERROR',
          })} />
          {state}
        </div>
      </div>

      {/* Input Area */}
      {(state === 'IDLE' || state === 'AMBIGUOUS' || state === 'UNSUPPORTED' || state === 'REJECTED' || state === 'ERROR') && (
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            id="ai-fault-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleInterpret(); }}
            placeholder="e.g. Inject critical memory exhaustion into Records."
            rows={2}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-textMain placeholder:text-textMuted focus:outline-none focus:border-primary resize-none font-mono transition-colors"
          />

          {/* Example prompts */}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.slice(0, 2).map(p => (
              <button
                key={p}
                onClick={() => { setInputText(p); setTimeout(() => textareaRef.current?.focus(), 50); }}
                className="px-2 py-1 text-[10px] font-mono bg-surface border border-border hover:border-primary/40 hover:bg-surfaceHover text-textMuted hover:text-textMain rounded transition-colors"
              >
                {p.slice(0, 36)}…
              </button>
            ))}
          </div>

          <button
            id="ai-interpret-btn"
            onClick={handleInterpret}
            disabled={!inputText.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primaryHover disabled:opacity-40 text-white rounded-lg font-bold text-xs uppercase tracking-widest transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            INTERPRET
          </button>
        </div>
      )}

      {/* Interpreting spinner */}
      {state === 'INTERPRETING' && (
        <div className="flex items-center gap-2 p-3 bg-info/5 border border-info/20 rounded-lg text-xs font-mono text-info">
          <Loader2 className="w-4 h-4 animate-spin" />
          Gemini is interpreting your request...
        </div>
      )}

      {/* Confirmation Card */}
      {state === 'AWAITING_CONFIRMATION' && interpretation && (
        <div className="space-y-3">
          <div className="p-4 bg-elevated/5 border border-elevated/30 rounded-lg">
            <div className="text-[10px] font-mono text-textMuted uppercase mb-3 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-elevated" />
              AI FAULT REQUEST — AWAITING YOUR CONFIRMATION
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-textMuted">Target Service</span>
                <span className="text-textMain font-bold uppercase">{interpretation.serviceId}</span>
              </div>
              <div className="flex justify-between text-xs font-mono">
                <span className="text-textMuted">Resource</span>
                <span className="text-info font-bold">{interpretation.resource}</span>
              </div>
              <div className="flex justify-between text-xs font-mono">
                <span className="text-textMuted">Severity</span>
                <span className={clsx('font-bold', {
                  'text-critical': interpretation.severity === 'CRITICAL',
                  'text-elevated': interpretation.severity === 'HIGH',
                  'text-healthy': interpretation.severity === 'MEDIUM' || interpretation.severity === 'LOW',
                })}>{interpretation.severity}</span>
              </div>
              <div className="flex justify-between text-xs font-mono">
                <span className="text-textMuted">Source</span>
                <span className={clsx('text-[10px] font-bold uppercase', interpretation.geminiAvailable ? 'text-primary' : 'text-textMuted')}>
                  {interpretation.geminiAvailable ? 'GEMINI' : 'HEURISTIC'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 mb-4 text-[10px] font-mono text-healthy">
              <CheckCircle2 className="w-3.5 h-3.5" />
              SERVER-VALIDATED — READY TO INJECT
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleReset}
                className="px-3 py-2 text-xs font-bold uppercase border border-border text-textMuted hover:text-textMain hover:bg-surfaceHover rounded-lg transition-colors"
              >
                CANCEL
              </button>
              <button
                id="ai-inject-btn"
                onClick={handleInject}
                className="px-3 py-2 text-xs font-bold uppercase bg-critical hover:bg-red-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" />
                INJECT FAULT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Injecting */}
      {state === 'INJECTING' && (
        <div className="flex items-center gap-2 p-3 bg-info/5 border border-info/20 rounded-lg text-xs font-mono text-info">
          <Loader2 className="w-4 h-4 animate-spin" />
          Sending fault command to simulator...
        </div>
      )}

      {/* INJECTED SUCCESS */}
      {state === 'INJECTED' && injectedCommand && (
        <div className="space-y-3">
          <div className="p-4 bg-healthy/5 border border-healthy/30 rounded-lg">
            <div className="flex items-center gap-2 mb-3 text-healthy text-xs font-mono font-bold uppercase">
              <CheckCircle2 className="w-4 h-4" />
              FAULT INJECTED — SIMULATION RUNNING
            </div>
            <div className="space-y-1.5 text-xs font-mono mb-3">
              <div className="flex justify-between">
                <span className="text-textMuted">Service</span>
                <span className="text-textMain font-bold uppercase">{injectedCommand.serviceId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-textMuted">Resource</span>
                <span className="text-info font-bold">{injectedCommand.resource}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-textMuted">Severity</span>
                <span className="text-critical font-bold">{injectedCommand.severity}</span>
              </div>
            </div>
            <p className="text-[10px] text-textMuted font-mono">Watch the causal graph and hypothesis panel evolve in real-time as the cascade propagates.</p>
            <button
              onClick={handleReset}
              className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold uppercase border border-border text-textMuted hover:text-textMain hover:bg-surfaceHover rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              RESET FOR NEW SCENARIO
            </button>
          </div>
        </div>
      )}

      {/* AMBIGUOUS */}
      {state === 'AMBIGUOUS' && interpretation && (
        <div className="p-4 bg-elevated/5 border border-elevated/30 rounded-lg space-y-3">
          <div className="flex items-center gap-1.5 text-elevated text-xs font-mono font-bold uppercase">
            <HelpCircle className="w-3.5 h-3.5" />
            AMBIGUOUS REQUEST
          </div>
          {interpretation.clarificationQuestion && (
            <p className="text-xs text-textMuted font-mono">{interpretation.clarificationQuestion}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS'].map(r => (
              <button
                key={r}
                onClick={() => {
                  const svc = interpretation.serviceId ?? 'records';
                  setInputText(`Inject critical ${r.toLowerCase()} exhaustion into ${svc}.`);
                  setState('IDLE');
                }}
                className="px-2.5 py-1 text-[10px] font-mono font-bold bg-surface border border-border hover:border-primary text-textMuted hover:text-primary rounded transition-colors uppercase"
              >
                {r}
              </button>
            ))}
          </div>
          <button onClick={handleReset} className="text-[10px] text-textMuted hover:text-textMain font-mono underline">
            Start over
          </button>
        </div>
      )}

      {/* UNSUPPORTED */}
      {state === 'UNSUPPORTED' && interpretation && (
        <div className="p-4 bg-critical/5 border border-critical/30 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5 text-critical text-xs font-mono font-bold uppercase">
            <XCircle className="w-3.5 h-3.5" />
            AI REQUEST REJECTED
          </div>
          <p className="text-xs text-textMuted font-mono">
            {interpretation.resource && !['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS'].includes(interpretation.resource)
              ? `Unsupported resource: "${interpretation.resource}". Supported: CPU, MEMORY, CONNECTIONS, WORKERS`
              : `Unsupported service: "${interpretation.serviceId}". Supported: records, appointment, portal, notification`
            }
          </p>
          <button onClick={handleReset} className="text-[10px] text-textMuted hover:text-textMain font-mono underline">
            Try again
          </button>
        </div>
      )}

      {/* ERROR / REJECTED */}
      {state === 'REJECTED' && errorMsg && (
        <div className="p-3 bg-critical/5 border border-critical/30 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5 text-critical text-xs font-mono font-bold uppercase">
            <AlertTriangle className="w-3.5 h-3.5" />
            NOT ACCEPTED
          </div>
          <p className="text-xs text-textMuted font-mono">{errorMsg}</p>
          <button onClick={handleReset} className="text-[10px] text-textMuted hover:text-textMain font-mono underline">Try again</button>
        </div>
      )}

      {state === 'ERROR' && (
        <div className="p-3 bg-critical/5 border border-critical/30 rounded-lg space-y-2">
          <div className="flex items-center gap-1.5 text-critical text-xs font-mono font-bold uppercase">
            <XCircle className="w-3.5 h-3.5" />
            CONNECTION ERROR
          </div>
          <p className="text-xs text-textMuted font-mono">{errorMsg}</p>
          <button onClick={handleReset} className="text-[10px] text-textMuted hover:text-textMain font-mono underline">Try again</button>
        </div>
      )}

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div className="pt-3 border-t border-border/50">
          <div className="text-[10px] font-mono text-textMuted uppercase mb-2">Audit Log</div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {auditLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] font-mono">
                <span className="text-textMuted shrink-0">{entry.time}</span>
                <span className={clsx('font-bold shrink-0', entry.type.includes('REJECTED') ? 'text-critical' : entry.type.includes('INJECTED') ? 'text-healthy' : 'text-info')}>
                  {entry.type}
                </span>
                <span className="text-textMuted truncate">{entry.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
