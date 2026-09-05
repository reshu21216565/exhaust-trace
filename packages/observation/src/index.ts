import { 
  TelemetryTick, 
  ObservableSystemEvent,
  DependencyGraph,
  ObservableIncidentData,
  ServiceTelemetry,
  ResourceStatus,
  ObservationConfig,
  DefaultObservationConfig,
  ResourcePressureChangedEvent,
  QueueGrowthEvent,
  LatencyDegradedEvent,
  TimeoutSpikeEvent,
  RetrySurgeEvent,
  CapacityDegradedEvent,
  RecoveryEvent
} from '@exhausttrace/shared';
import { SimulationWorld } from '@exhausttrace/simulation';

/**
 * OBSERVATION BOUNDARY
 * This package is strictly responsible for transforming AuthoritativeState
 * into stripped, observable data.
 */

export class ObservationHistory {
  private telemetry: TelemetryTick[] = [];
  private events: ObservableSystemEvent[] = [];
  private graph: DependencyGraph | null = null;

  constructor(graph?: DependencyGraph) {
    if (graph) {
      this.graph = JSON.parse(JSON.stringify(graph));
    }
  }

  public setGraph(graph: DependencyGraph) {
    this.graph = JSON.parse(JSON.stringify(graph));
  }

  public appendTelemetry(tick: TelemetryTick) {
    // Defensive copy
    this.telemetry.push(JSON.parse(JSON.stringify(tick)));
  }

  public appendEvents(events: ObservableSystemEvent[]) {
    for (const e of events) {
      this.events.push(JSON.parse(JSON.stringify(e)));
    }
  }

  public getTelemetry(): TelemetryTick[] {
    return JSON.parse(JSON.stringify(this.telemetry));
  }

  public getEvents(): ObservableSystemEvent[] {
    return JSON.parse(JSON.stringify(this.events));
  }

  public getTelemetryInRange(startTick: number, endTick: number): TelemetryTick[] {
    return this.getTelemetry().filter(t => t.tick >= startTick && t.tick <= endTick);
  }

  public getEventsInRange(startTick: number, endTick: number): ObservableSystemEvent[] {
    return this.getEvents().filter(e => e.tick >= startTick && e.tick <= endTick);
  }

  public clear() {
    this.telemetry = [];
    this.events = [];
  }

  public getObservableBundle(): ObservableIncidentData {
    return {
      dependencyGraph: this.graph ? JSON.parse(JSON.stringify(this.graph)) : { nodes: [], edges: [] },
      telemetry: this.getTelemetry(),
      events: this.getEvents()
    };
  }
}

export class ObservationAdapter {
  private config: ObservationConfig;
  private sequenceCounter: number = 0;
  
  // State tracking for event deduplication
  private resourceStatuses = new Map<string, ResourceStatus>();
  private prevQueueDepths = new Map<string, number>();
  private prevLatencies = new Map<string, number>();
  private prevTimeouts = new Map<string, number>();
  private prevRetries = new Map<string, number>();
  private prevCapacities = new Map<string, number>();
  
  // Recovery tracking: maps serviceId to number of consecutive healthy ticks
  private healthyTicks = new Map<string, number>();
  private recoveringServices = new Set<string>();

  constructor(config: ObservationConfig = DefaultObservationConfig) {
    this.config = config;
  }

  private validateNumber(val: number, min: number, max: number, name: string): number {
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      throw new Error(`Observation bounds violation: ${name} is ${val} (expected finite number)`);
    }
    if (val < min || val > max) {
      throw new Error(`Observation bounds violation: ${name} is ${val} (expected [${min}, ${max}])`);
    }
    return val;
  }

  private mapResourceStatus(pressure: number): ResourceStatus {
    // Simulation pressure = clamp((utilization - 0.70) / 0.30, 0, 1)
    // CRITICAL target util 0.99 → pressure ≈ 0.967
    // HIGH target util 0.96 → pressure ≈ 0.867
    // MEDIUM target util 0.90 → pressure ≈ 0.667
    // LOW target util 0.82 → pressure ≈ 0.400
    if (pressure >= 0.95) return 'CRITICAL';
    if (pressure >= 0.80) return 'HIGH';
    if (pressure >= 0.35) return 'ELEVATED';
    return 'HEALTHY';
  }

  /**
   * Safely extracts only the observable telemetry from the authoritative state.
   * Strips all hidden ground truth and injected root identifiers.
   */
  public extractObservableTelemetry(world: SimulationWorld): TelemetryTick {
    const services: ServiceTelemetry[] = [];
    
    // Iterate over entries instead of relying on any hidden logic
    const state = world.state;
    
    for (const [serviceId, nodeState] of state.services.entries()) {
      const getRes = (resId: string) => {
        const res = (nodeState.resources as any)[resId];
        const util = this.validateNumber(res.utilization, 0, 1, `${serviceId}.${resId}.utilization`);
        const press = this.validateNumber(res.pressure, 0, 1, `${serviceId}.${resId}.pressure`);
        return {
          utilization: util,
          pressure: press,
          status: this.mapResourceStatus(press)
        };
      };

      const maxQ = nodeState.params.maxQueueDepth;
      
      services.push({
        serviceId,
        resources: {
          CPU: getRes('CPU'),
          MEMORY: getRes('MEMORY'),
          CONNECTIONS: getRes('CONNECTIONS'),
          WORKERS: getRes('WORKERS')
        },
        metrics: {
          incomingRate: this.validateNumber(nodeState.incomingRate, 0, Infinity, `${serviceId}.incomingRate`),
          retryIncomingRate: this.validateNumber(nodeState.retryIncomingRate, 0, Infinity, `${serviceId}.retryIncomingRate`),
          processedRate: this.validateNumber(nodeState.lastProcessedRate, 0, Infinity, `${serviceId}.processedRate`),
          queueDepth: this.validateNumber(nodeState.queueDepth, 0, maxQ, `${serviceId}.queueDepth`),
          maxQueueDepth: maxQ,
          latencyMs: this.validateNumber(nodeState.latency, 0, Infinity, `${serviceId}.latencyMs`),
          timeoutRate: this.validateNumber(nodeState.timeoutRate, 0, Infinity, `${serviceId}.timeoutRate`),
          failureRate: this.validateNumber(nodeState.errorRate, 0, Infinity, `${serviceId}.failureRate`),
          successRate: this.validateNumber(nodeState.successRate, 0, Infinity, `${serviceId}.successRate`),
          retryRate: this.validateNumber(nodeState.retryRate, 0, Infinity, `${serviceId}.retryRate`)
        }
      });
    }

    return {
      timestamp: world.clock.timestamp,
      tick: world.clock.currentTick,
      services
    };
  }

  public extractDependencyGraph(world: SimulationWorld): DependencyGraph {
    // Strip everything except nodes (id) and edges (from/to)
    return {
      nodes: world.state.dependencyGraph.nodes.map(n => ({ id: n.id })),
      edges: world.state.dependencyGraph.edges.map(e => ({ from: e.from, to: e.to }))
    };
  }

  private nextSeq(): number {
    return ++this.sequenceCounter;
  }

  /**
   * Translates internal physics state changes into strongly typed system events.
   */
  public generateEvents(
    tick: TelemetryTick,
    graph: DependencyGraph,
    baseCapacities: Record<string, number>,
    baseLatencies: Record<string, number>
  ): ObservableSystemEvent[] {
    const events: ObservableSystemEvent[] = [];
    const t = tick.tick;
    const ts = tick.timestamp;

    for (const service of tick.services) {
      const sid = service.serviceId;
      let serviceIsHealthy = true;

      // 1. Resource Status Events
      for (const [resId, res] of Object.entries(service.resources)) {
        const key = `${sid}:${resId}`;
        const prevStatus = this.resourceStatuses.get(key) || 'HEALTHY';
        
        if (prevStatus !== res.status) {
          events.push({
            sequence: this.nextSeq(),
            tick: t,
            timestamp: ts,
            type: 'RESOURCE_PRESSURE_CHANGED',
            serviceId: sid,
            resource: resId,
            previousStatus: prevStatus,
            status: res.status,
            utilization: res.utilization,
            pressure: res.pressure
          });
          this.resourceStatuses.set(key, res.status);
        }
        
        if (res.status !== 'HEALTHY') {
          serviceIsHealthy = false;
        }
      }

      // 2. Queue Growth Events
      const q = service.metrics.queueDepth;
      const maxQ = service.metrics.maxQueueDepth;
      const prevQ = this.prevQueueDepths.get(sid) || 0;
      
      if (q > prevQ) {
        // Did we cross a growth band?
        const qRatio = q / maxQ;
        const prevQRatio = prevQ / maxQ;
        
        for (const band of this.config.queueGrowthBands) {
          if (prevQRatio < band && qRatio >= band) {
            events.push({
              sequence: this.nextSeq(),
              tick: t,
              timestamp: ts,
              type: 'QUEUE_GROWTH',
              serviceId: sid,
              queueDepth: q,
              previousQueueDepth: prevQ,
              growthRate: q - prevQ
            });
            break; // Only emit one crossing per tick
          }
        }
      }
      this.prevQueueDepths.set(sid, q);
      if (q > 0) serviceIsHealthy = false;

      // 3. Latency Degraded Events
      const lat = service.metrics.latencyMs;
      const prevLat = this.prevLatencies.get(sid) || 0;
      const baseLat = baseLatencies[sid] || 100;
      const latThreshold = baseLat * this.config.latencyDegradationMultiplier;
      
      if (lat > latThreshold && prevLat <= latThreshold) {
        events.push({
          sequence: this.nextSeq(),
          tick: t,
          timestamp: ts,
          type: 'LATENCY_DEGRADED',
          serviceId: sid,
          latencyMs: lat,
          previousLatencyMs: prevLat,
          threshold: latThreshold
        });
      }
      this.prevLatencies.set(sid, lat);
      if (lat > latThreshold) serviceIsHealthy = false;

      // 4. Timeouts & Retries (Caller to Dependency)
      // If this service is generating timeouts/retries, who is the dependency?
      // Since timeoutRate is just an aggregate in metrics right now (not per dependency), 
      // we know this service is the caller. If a service only calls one downstream, we map it.
      // ExhaustTrace dependency graph: Portal->Appt, Appt->Records, Appt->Notification.
      const toRate = service.metrics.timeoutRate;
      const prevTo = this.prevTimeouts.get(sid) || 0;
      
      if (toRate > this.config.timeoutSpikeThreshold && prevTo <= this.config.timeoutSpikeThreshold) {
        // Find downstream dependencies for this caller
        const deps = graph.edges.filter(e => e.from === sid).map(e => e.to);
        const primaryDep = deps[0] || 'unknown'; // Approximation since metrics aren't split by edge
        
        events.push({
          sequence: this.nextSeq(),
          tick: t,
          timestamp: ts,
          type: 'TIMEOUT_SPIKE',
          callerService: sid,
          dependencyService: primaryDep,
          timeoutRate: toRate
        });
      }
      this.prevTimeouts.set(sid, toRate);
      if (toRate > this.config.timeoutSpikeThreshold) serviceIsHealthy = false;

      const retRate = service.metrics.retryRate;
      const prevRet = this.prevRetries.get(sid) || 0;
      if (retRate > this.config.retrySurgeThreshold && prevRet <= this.config.retrySurgeThreshold) {
        const deps = graph.edges.filter(e => e.from === sid).map(e => e.to);
        const primaryDep = deps[0] || 'unknown';
        events.push({
          sequence: this.nextSeq(),
          tick: t,
          timestamp: ts,
          type: 'RETRY_SURGE',
          callerService: sid,
          dependencyService: primaryDep,
          retryRate: retRate
        });
      }
      this.prevRetries.set(sid, retRate);
      if (retRate > this.config.retrySurgeThreshold) serviceIsHealthy = false;

      // 5. Capacity Degraded (using processedRate compared to baseCapacity when incoming is high)
      // Alternatively, we can calculate effective capacity proxy.
      // But Block 1 effectiveCapacity is not directly observable. We can infer it if queue builds up.
      // A safe observable proxy: if queue > 0 and processedRate < capacityDegradationThreshold * baseCapacity
      const baseCap = baseCapacities[sid] || 100;
      const processed = service.metrics.processedRate;
      const prevCapEventState = this.prevCapacities.get(sid) || 0;
      const capThreshold = baseCap * this.config.capacityDegradationThreshold;
      
      if (q > 0 && processed < capThreshold) {
        if (prevCapEventState === 0) {
          events.push({
            sequence: this.nextSeq(),
            tick: t,
            timestamp: ts,
            type: 'CAPACITY_DEGRADED',
            serviceId: sid,
            capacity: processed,
            baselineCapacity: baseCap
          });
          this.prevCapacities.set(sid, 1);
        }
      } else if (q === 0 || processed >= capThreshold) {
        this.prevCapacities.set(sid, 0);
      }

      // 6. Recovery Events
      if (serviceIsHealthy) {
        const count = (this.healthyTicks.get(sid) || 0) + 1;
        this.healthyTicks.set(sid, count);
        
        if (count === this.config.recoveryStabilityTicks && this.recoveringServices.has(sid)) {
          events.push({
            sequence: this.nextSeq(),
            tick: t,
            timestamp: ts,
            type: 'RECOVERY_COMPLETED',
            serviceId: sid
          });
          this.recoveringServices.delete(sid);
          this.prevCapacities.delete(sid + '_recovery_started'); // Reset
        }
      } else {
        this.healthyTicks.set(sid, 0);
        this.recoveringServices.add(sid);
        
        // Basic heuristic for RECOVERY_STARTED: If pressure drops across status bands
        for (const [resId, res] of Object.entries(service.resources)) {
           const key = `${sid}:${resId}`;
           const prevStatus = this.resourceStatuses.get(key) || 'HEALTHY';
           if ((prevStatus === 'CRITICAL' && res.status === 'HIGH') || 
               (prevStatus === 'HIGH' && res.status === 'ELEVATED')) {
               
               if (!this.prevCapacities.has(sid + '_recovery_started')) {
                 events.push({
                   sequence: this.nextSeq(),
                   tick: t,
                   timestamp: ts,
                   type: 'RECOVERY_STARTED',
                   serviceId: sid
                 });
                 this.prevCapacities.set(sid + '_recovery_started', 1);
               }
           }
        }
      }
    }

    return events;
  }
}

