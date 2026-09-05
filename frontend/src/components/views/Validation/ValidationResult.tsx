import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import type { InterventionValidationResult } from '@exhausttrace/shared';
import { CheckCircle2, XCircle, MinusCircle, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

export const ValidationResult: React.FC = () => {
  const { bundle } = useIncident();
  if (!bundle) return null;

  const rootResult = bundle.rootValidation;
  const symptomResult = bundle.symptomValidation;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
      {rootResult ? (
        <ValidationPanel title="ROOT RELIEF" result={rootResult} isRoot={true} />
      ) : (
        <EmptyValidationPanel title="ROOT RELIEF" />
      )}
      
      {symptomResult ? (
        <ValidationPanel title="SYMPTOM RELIEF" result={symptomResult} isRoot={false} />
      ) : (
        <EmptyValidationPanel title="SYMPTOM RELIEF" />
      )}
    </div>
  );
};

const ValidationPanel: React.FC<{ title: string, result: InterventionValidationResult, isRoot: boolean }> = ({ title, result, isRoot }) => {
  const isPass = result.validationStatus === 'MATCH';
  const isPartial = result.validationStatus === 'PARTIAL_MATCH';
  
  return (
    <div className={clsx(
      "glass-panel flex flex-col border-t-4",
      isPass ? "border-t-healthy" : (isPartial ? "border-t-elevated" : "border-t-critical")
    )}>
      <div className="p-6 border-b border-border text-center">
        <h3 className="text-[10px] text-textMuted uppercase tracking-[0.2em] font-bold mb-2">{title}</h3>
        <div className="text-xl font-bold tracking-tight">
          Target: <span className="font-mono text-primary">{result.target}</span>
        </div>
      </div>

      <div className="p-6 space-y-3 flex-1">
        <div className="grid grid-cols-[1fr_auto_auto] gap-4 text-xs font-mono border-b border-border pb-2">
          <div className="text-textMuted font-sans uppercase tracking-wider">Metric</div>
          <div className="text-textMuted text-right">PREDICTED</div>
          <div className="text-textMuted text-right w-16">ACTUAL</div>
        </div>

        {result.metricErrors.slice(0, 5).map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-4 text-sm items-center">
            <div className="text-textMain truncate pr-2 text-xs">{m.metricName}</div>
            <div className="font-mono text-right text-textMuted/60 line-through text-xs">
              ~{Math.round(m.predictedValue)}
            </div>
            <div className={clsx("font-mono text-right font-bold w-16 text-xs", m.relativeError < 0.2 ? "text-healthy" : "text-critical")}>
              {Math.round(m.actualValue)}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface/50 p-6 border-t border-border space-y-3">
        <div className="flex justify-between items-center text-sm">
          <span className="text-textMuted uppercase tracking-wider text-xs">Recovery Accuracy</span>
          <span className="font-mono font-bold text-lg">{(result.recoveryAccuracy * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-textMuted uppercase tracking-wider text-xs">Cascade Collapse</span>
          <span className="font-mono font-bold text-lg">{(result.cascadeCollapseScore * 100).toFixed(1)}%</span>
        </div>
        
        <div className={clsx(
          "mt-4 p-4 rounded-lg flex items-center justify-center gap-3 font-bold tracking-widest text-sm",
          isPass ? "bg-healthy/10 border border-healthy/30 text-healthy" : 
          (isPartial ? "bg-elevated/10 border border-elevated/30 text-elevated" : "bg-critical/10 border border-critical/30 text-critical")
        )}>
          {isPass ? <CheckCircle2 className="w-5 h-5" /> : (isPartial ? <MinusCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />)}
          {isRoot ? (isPass ? "PREDICTION VALIDATED" : "VALIDATION FAILED") : (isPass ? "SYMPTOM RELIEVED" : "CASCADE PERSISTS")}
        </div>
      </div>
    </div>
  );
};

const EmptyValidationPanel: React.FC<{ title: string }> = ({ title }) => (
  <div className="glass-panel border-t-4 border-t-border flex flex-col items-center justify-center min-h-[400px] text-center p-6">
    <ShieldAlert className="w-8 h-8 text-border mb-4" />
    <h3 className="text-sm font-bold text-textMuted uppercase tracking-widest">{title}</h3>
    <p className="text-xs text-textMuted/70 mt-2">Experiment not executed.</p>
  </div>
);
