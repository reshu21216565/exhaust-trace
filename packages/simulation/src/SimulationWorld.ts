import { DependencyGraph, ResourceType } from '@exhausttrace/shared';
import { SimulationConfig, DefaultConfig, clamp } from './config';
import { DeterministicRNG, RNG, Clock, SimulationClock, InjectedExhaustion } from './index';
import { ServiceNode, ServiceStateData } from './ServiceNode';

export interface AuthoritativeState {
  services: Map<string, ServiceStateData>;
  dependencyGraph: DependencyGraph;
  injectedRoot: InjectedExhaustion | null;
  scenarioId: string;
}

export class SimulationWorld {
  public clock: SimulationClock;
  public rng: DeterministicRNG;
  public config: SimulationConfig;
  public nodes: Map<string, ServiceNode>;

  public injectedRoot: InjectedExhaustion | null = null;

  constructor(seed: string, config: SimulationConfig = DefaultConfig) {
    this.config = config;
    this.clock = new Clock(config.tickDurationMs);
    this.rng = new RNG(seed);
    this.nodes = new Map();

    for (const [id, params] of Object.entries(config.services)) {
      this.nodes.set(id, new ServiceNode(id, id.charAt(0).toUpperCase() + id.slice(1), params));
    }
  }

  public get state(): AuthoritativeState {
    const services = new Map<string, ServiceStateData>();
    for (const [id, node] of this.nodes) {
      services.set(id, node.state);
    }
    return {
      services,
      dependencyGraph: {
        nodes: Array.from(this.nodes.keys()).map(id => ({ id })),
        edges: this.config.dependencyTopology.map(t => ({ from: t.from, to: t.to }))
      },
      injectedRoot: this.injectedRoot,
      scenarioId: 'default'
    };
  }

  public injectExhaustion(serviceId: string, resourceId: ResourceType, severity: string) {
    this.injectedRoot = { serviceId, resourceId, severity: 1 }; // numeric severity not used directly here anymore
    const node = this.nodes.get(serviceId);
    if (node) {
      node.injectExhaustion(resourceId, severity);
    }
  }

  public relieveExhaustion(serviceId: string, resourceId: ResourceType) {
    if (this.injectedRoot && this.injectedRoot.serviceId === serviceId && this.injectedRoot.resourceId === resourceId) {
      this.injectedRoot = null;
    }
    const node = this.nodes.get(serviceId);
    if (node) {
      node.relieveExhaustion();
    }
  }

  public createSnapshot(): string {
    const snapshot = {
      clock: { currentTick: this.clock.currentTick, timestamp: this.clock.timestamp },
      rng: this.rng.seed, // Proper restoration needs state, we'll store full state
      rngState: (this.rng as RNG).state, 
      nodes: Array.from(this.nodes.entries()).map(([id, node]) => ({ id, state: node.cloneState() })),
      injectedRoot: this.injectedRoot
    };
    return JSON.stringify(snapshot);
  }

  public restoreSnapshot(snapshotJson: string) {
    const snapshot = JSON.parse(snapshotJson);
    this.clock.currentTick = snapshot.clock.currentTick;
    this.clock.timestamp = snapshot.clock.timestamp;
    this.rng = new RNG(snapshot.rng);
    (this.rng as any).state = snapshot.rngState;
    this.injectedRoot = snapshot.injectedRoot;

    this.nodes.clear();
    for (const data of snapshot.nodes) {
      const node = new ServiceNode(data.id, data.state.name, data.state.params);
      node.restoreState(data.state);
      this.nodes.set(data.id, node);
    }
  }

  public tick(): void {
    // 0. Reset inputs
    for (const node of this.nodes.values()) {
      node.state.incomingRate = 0;
      node.state.retryIncomingRate = 0;
    }

    // 1. Generate external traffic
    for (const [id, baseRate] of Object.entries(this.config.externalTraffic)) {
      const node = this.nodes.get(id);
      if (node) {
        // Traffic jitter ±5%
        const jitter = this.rng.random() * 0.10 - 0.05;
        node.state.incomingRate += baseRate * (1 + jitter);
      }
    }

    // Unrelated noisy signal
    if (this.config.noiseServiceId && !this.injectedRoot) {
      // Noise logic can be external, but we just let normal jitter handle it, 
      // or we can randomly bump it if it's the designated noise service
      const noiseNode = this.nodes.get(this.config.noiseServiceId);
      if (noiseNode && this.rng.random() < 0.05) {
        // Spike incoming rate
        noiseNode.state.incomingRate += 100;
      }
    }

    // 2. Propagate Dependency Load (Topological order)
    // For simplicity and to allow DAG, we do a topological sort or fixed array
    // Portal -> Appointment -> Records
    const topoOrder = ['portal', 'appointment', 'records', 'notification'];

    for (const callerId of topoOrder) {
      const callerNode = this.nodes.get(callerId);
      if (!callerNode) continue;

      // Find dependencies
      const deps = this.config.dependencyTopology.filter(d => d.from === callerId);
      
      callerNode.state.timeoutRate = 0;
      callerNode.state.retryRate = 0;

      for (const dep of deps) {
        const targetNode = this.nodes.get(dep.to);
        if (!targetNode) continue;

        // Calculate dependency latency for caller's timeout
        const depLatency = targetNode.state.latency;
        
        // Timeout starts at 70% of threshold, 100% at 120% of threshold
        const threshold = targetNode.state.params.timeoutThreshold;
        const timeoutProb = clamp((depLatency - threshold * 0.7) / (threshold * 0.5), 0, 1);

        const callAttempts = callerNode.state.lastProcessedRate * dep.callRatio;
        const timeouts = callAttempts * timeoutProb;

        const maxRetryRate = callAttempts * 2;
        const retries = clamp(timeouts * this.config.retryProbability, 0, maxRetryRate);

        callerNode.state.timeoutRate += timeouts;
        callerNode.state.retryRate += retries;

        targetNode.state.incomingRate += callAttempts;
        targetNode.state.retryIncomingRate += retries;

        // Dependency latency creates backpressure on caller's workers and connections
        if (depLatency > this.config.backpressure.latencyTriggerMs) {
          const delayFactor = clamp(depLatency / this.config.backpressure.latencySpreadMs, 0, 1);
          const ramp = delayFactor * this.config.backpressure.utilizationRamp;
          
          callerNode.state.resources.WORKERS.utilization = clamp(callerNode.state.resources.WORKERS.utilization + ramp, 0, 1);
          callerNode.state.resources.CONNECTIONS.utilization = clamp(callerNode.state.resources.CONNECTIONS.utilization + ramp, 0, 1);
        }
      }
    }

    // 3. Process physics for all nodes
    for (const node of this.nodes.values()) {
      node.tick(this.config.tickDurationMs, this.rng);
    }

    // Advance clock
    this.clock.advance();
  }
}
