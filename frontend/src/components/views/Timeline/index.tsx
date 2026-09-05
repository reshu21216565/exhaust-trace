import React from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { ObservableSystemEvent } from '@exhausttrace/shared';

// Helpers to extract serviceId and readable summary from discriminated union events
function getEventServiceId(event: ObservableSystemEvent): string {
  if ('serviceId' in event && event.serviceId) return event.serviceId;
  if ('callerService' in event && event.callerService) return event.callerService;
  return 'system';
}

function getEventSummary(event: ObservableSystemEvent): string {
  switch (event.type) {
    case 'RESOURCE_PRESSURE_CHANGED':
      return `${event.resource} moved to ${event.status} (${Math.round(event.utilization * 100)}% utilization)`;
    case 'QUEUE_GROWTH':
      return `Queue grew to ${event.queueDepth} (from ${event.previousQueueDepth})`;
    case 'LATENCY_DEGRADED':
      return `Latency degraded to ${Math.round(event.latencyMs)}ms (threshold: ${Math.round(event.threshold)}ms)`;
    case 'TIMEOUT_SPIKE':
      return `Timeout rate ${(event.timeoutRate * 100).toFixed(1)}% calling ${event.dependencyService}`;
    case 'RETRY_SURGE':
      return `Retry rate ${(event.retryRate).toFixed(1)}/s calling ${event.dependencyService}`;
    case 'CAPACITY_DEGRADED':
      return `Capacity at ${Math.round((event.capacity / event.baselineCapacity) * 100)}% of baseline`;
    case 'RECOVERY_STARTED':
      return 'Recovery phase detected';
    case 'RECOVERY_COMPLETED':
      return 'System recovery complete';
    default:
      return '';
  }
}

function getEventColor(event: ObservableSystemEvent): string {
  if (event.type === 'RECOVERY_COMPLETED') return 'bg-healthy';
  if (event.type === 'RECOVERY_STARTED') return 'bg-info';
  if (event.type === 'RESOURCE_PRESSURE_CHANGED' && 'status' in event && event.status === 'CRITICAL') return 'bg-critical';
  if (event.type === 'TIMEOUT_SPIKE' || event.type === 'QUEUE_GROWTH') return 'bg-degraded';
  return 'bg-elevated';
}

export const Timeline: React.FC = () => {
  const { bundle } = useIncident();
  if (!bundle) return null;

  const events = [...bundle.events].reverse();

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-wide flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Incident Timeline
          </h2>
          <p className="text-sm text-textMuted mt-1">Chronological record of observable system events</p>
        </div>
      </div>

      <div className="glass-panel p-6 max-w-4xl">
        <div className="relative border-l border-border ml-3 space-y-8 py-4">
          {events.length === 0 ? (
            <p className="text-sm text-textMuted pl-6">No events recorded yet.</p>
          ) : (
            events.map((event, i) => {
              const svcId = getEventServiceId(event);
              const summary = getEventSummary(event);
              const dotColor = getEventColor(event);

              return (
                <div key={`${event.tick}-${event.sequence}-${i}`} className="relative pl-8 flex flex-col gap-1">
                  <div className={clsx(
                    "absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full ring-4 ring-background",
                    dotColor
                  )} />
                  <div className="flex items-center gap-3 text-xs text-textMuted">
                    <span className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded">
                      TICK {event.tick}
                    </span>
                    <span className="text-textMuted/60">{svcId}</span>
                  </div>
                  <h4 className="text-sm font-bold text-textMain mt-1">{event.type.replace(/_/g, ' ')}</h4>
                  {summary && <p className="text-sm text-textMuted">{summary}</p>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
