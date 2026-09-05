import { ResourceType } from '@exhausttrace/shared';

export interface BaseServiceParams {
  baseCapacity: number; // req/s
  baseLatency: number; // ms
  timeoutThreshold: number; // ms
  maxQueueDepth: number;
}

export interface SimulationConfig {
  tickDurationMs: number;
  services: Record<string, BaseServiceParams>;
  dependencyTopology: { from: string; to: string; callRatio: number }[];
  externalTraffic: Record<string, number>; // serviceId -> req/s
  noiseServiceId?: string;
  retryProbability: number;
  backpressure: {
    latencyTriggerMs: number;
    latencySpreadMs: number;
    utilizationRamp: number;
  };
}

export const DefaultConfig: SimulationConfig = {
  tickDurationMs: 100,
  services: {
    portal: { baseCapacity: 120, baseLatency: 80, timeoutThreshold: 1000, maxQueueDepth: 500 },
    appointment: { baseCapacity: 100, baseLatency: 100, timeoutThreshold: 1000, maxQueueDepth: 500 },
    records: { baseCapacity: 90, baseLatency: 120, timeoutThreshold: 1000, maxQueueDepth: 500 },
    notification: { baseCapacity: 150, baseLatency: 80, timeoutThreshold: 1000, maxQueueDepth: 500 }
  },
  dependencyTopology: [
    { from: 'portal', to: 'appointment', callRatio: 1.0 },
    { from: 'appointment', to: 'records', callRatio: 1.0 },
    { from: 'appointment', to: 'notification', callRatio: 0.2 }
  ],
  externalTraffic: {
    portal: 60
  },
  noiseServiceId: 'notification',
  retryProbability: 0.4,
  backpressure: {
    latencyTriggerMs: 150,
    latencySpreadMs: 2000,
    utilizationRamp: 0.2
  }
};

export const SEVERITY_TARGETS: Record<string, number> = {
  NONE: 0.0,
  LOW: 0.82,
  MEDIUM: 0.90,
  HIGH: 0.96,
  CRITICAL: 0.99
};

export const SEVERITY_RAMPS: Record<string, number> = {
  NONE: 0.0,
  LOW: 0.01,
  MEDIUM: 0.02,
  HIGH: 0.03,
  CRITICAL: 0.04
};

export const RECOVERY_RATE = 0.03;

export function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}
