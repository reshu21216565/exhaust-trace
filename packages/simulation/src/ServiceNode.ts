import { ResourceType } from '@exhausttrace/shared';
import { BaseServiceParams, clamp, RECOVERY_RATE, SEVERITY_RAMPS, SEVERITY_TARGETS } from './config';
import { DeterministicRNG } from './index';

export interface ResourceState {
  utilization: number;
  pressure: number;
  capacity: number; // 0 to 1
  failureProbability: number;
}

export interface ServiceStateData {
  serviceId: string;
  name: string;
  params: BaseServiceParams;
  resources: Record<ResourceType, ResourceState>;
  
  // Traffic state
  incomingRate: number; // req/s
  retryIncomingRate: number; // req/s
  queueDepth: number;
  
  // Health Metrics
  latency: number;
  successRate: number;
  errorRate: number;
  timeoutRate: number;
  retryRate: number; // rate of retries we issue
  lastProcessedRate: number;
  
  // Injection
  injectedResource: ResourceType | null;
  targetSeverity: string | null; // NONE, LOW, MEDIUM, HIGH, CRITICAL
}

export class ServiceNode {
  public state: ServiceStateData;

  constructor(serviceId: string, name: string, params: BaseServiceParams) {
    this.state = {
      serviceId,
      name,
      params,
      resources: {
        CPU: { utilization: 0, pressure: 0, capacity: 1, failureProbability: 0 },
        MEMORY: { utilization: 0, pressure: 0, capacity: 1, failureProbability: 0 },
        CONNECTIONS: { utilization: 0, pressure: 0, capacity: 1, failureProbability: 0 },
        WORKERS: { utilization: 0, pressure: 0, capacity: 1, failureProbability: 0 }
      },
      incomingRate: 0,
      retryIncomingRate: 0,
      queueDepth: 0,
      latency: params.baseLatency,
      successRate: 0,
      errorRate: 0,
      timeoutRate: 0,
      retryRate: 0,
      lastProcessedRate: 0,
      injectedResource: null,
      targetSeverity: null
    };
  }

  public cloneState(): ServiceStateData {
    return JSON.parse(JSON.stringify(this.state));
  }

  public restoreState(state: ServiceStateData) {
    this.state = JSON.parse(JSON.stringify(state));
  }

  public injectExhaustion(resourceId: ResourceType, severity: string) {
    this.state.injectedResource = resourceId;
    this.state.targetSeverity = severity;
  }

  public relieveExhaustion() {
    this.state.injectedResource = null;
    this.state.targetSeverity = null;
  }

  public tick(dtMs: number, rng: DeterministicRNG) {
    this.updateResources(rng);
    this.processTraffic(dtMs, rng);
  }

  private updateResources(rng: DeterministicRNG) {
    const workloadRatio = clamp((this.state.incomingRate + this.state.retryIncomingRate) / this.state.params.baseCapacity, 0, 1.5);
    
    // Base healthy utilization from workload
    const baseCpu = 0.1 + workloadRatio * 0.4; // up to ~0.7
    const baseMem = 0.2 + workloadRatio * 0.3; 
    const baseWork = 0.1 + workloadRatio * 0.4;
    const baseConn = 0.1 + workloadRatio * 0.4;

    const resources: Record<ResourceType, number> = {
      CPU: baseCpu,
      MEMORY: baseMem,
      WORKERS: baseWork,
      CONNECTIONS: baseConn
    };

    // Apply injection or recovery
    for (const key of Object.keys(this.state.resources) as ResourceType[]) {
      const res = this.state.resources[key];
      const jitter = rng.random() * 0.04 - 0.02; // ±0.02

      if (this.state.injectedResource === key && this.state.targetSeverity) {
        // Ramp up toward target
        const target = SEVERITY_TARGETS[this.state.targetSeverity] || 0;
        const ramp = SEVERITY_RAMPS[this.state.targetSeverity] || 0;
        if (res.utilization < target) {
          res.utilization = clamp(res.utilization + ramp, 0, target);
        }
      } else {
        // Recover toward base
        const target = resources[key] + jitter;
        if (res.utilization > target) {
          res.utilization = clamp(res.utilization - RECOVERY_RATE, target, 1.0);
        } else {
          res.utilization = clamp(target, 0, 1.0);
        }
      }

      // Calculate pressure & capacity
      res.pressure = clamp((res.utilization - 0.70) / 0.30, 0, 1);
      
      if (key === 'CPU') {
        res.capacity = 1 - 0.75 * res.pressure;
        res.failureProbability = 0;
      } else if (key === 'MEMORY') {
        res.capacity = 1 - 0.65 * res.pressure;
        res.failureProbability = 0.02 * res.pressure;
      } else if (key === 'WORKERS') {
        res.capacity = 1 - 0.70 * res.pressure;
        res.failureProbability = 0;
      } else if (key === 'CONNECTIONS') {
        res.capacity = 1 - 0.60 * res.pressure;
        res.failureProbability = 0.03 * res.pressure;
      }
    }
  }

  private processTraffic(dtMs: number, rng: DeterministicRNG) {
    const totalIncoming = this.state.incomingRate + this.state.retryIncomingRate;
    
    // Effective Capacity
    let resourceCapacityFactor = 1.0;
    let resourceFailProb = 0.0;
    let maxPressure = 0;

    for (const res of Object.values(this.state.resources)) {
      resourceCapacityFactor = Math.min(resourceCapacityFactor, res.capacity);
      resourceFailProb = Math.max(resourceFailProb, res.failureProbability);
      maxPressure = Math.max(maxPressure, res.pressure);
    }

    const effectiveCapacity = this.state.params.baseCapacity * resourceCapacityFactor;

    const dtSec = dtMs / 1000;
    
    // We can process up to effectiveCapacity per tick
    const workAvailable = (totalIncoming * dtSec) + this.state.queueDepth;
    const workCapacity = effectiveCapacity * dtSec;
    
    const processedWork = Math.min(workAvailable, workCapacity);
    this.state.lastProcessedRate = processedWork / dtSec;

    this.state.queueDepth = clamp(
      workAvailable - processedWork,
      0,
      this.state.params.maxQueueDepth
    );

    // Latency Model
    const queuePressure = clamp(this.state.queueDepth / this.state.params.maxQueueDepth, 0, 1);
    const queueLatencyFactor = 1 + 4 * queuePressure;
    const resourceLatencyFactor = 1 + 2 * maxPressure;
    
    const jitter = rng.random() * 10 - 5; // ±5ms
    this.state.latency = clamp(
      this.state.params.baseLatency * resourceLatencyFactor * queueLatencyFactor + jitter,
      0,
      5000
    );

    // Timeout Model (Calls to this service might timeout for the caller)
    // Wait, if this service has 1500ms latency, the CALLER times out.
    // The prompt says "if dependencyLatency > timeoutThreshold the call becomes a timeout".
    // We will model the caller's timeout based on this service's latency when propagating back.

    // Success / Failure (Internal to this service processing)
    // Internal resource failures
    if (totalIncoming > 0) {
      this.state.errorRate = totalIncoming * resourceFailProb;
      this.state.successRate = totalIncoming - this.state.errorRate;
    } else {
      this.state.errorRate = 0;
      this.state.successRate = 0;
    }
    
    // Note: timeoutRate and retryRate on THIS service represent timeouts/retries 
    // it experiences when calling ITS dependencies. That will be calculated by SimulationWorld.
  }
}
