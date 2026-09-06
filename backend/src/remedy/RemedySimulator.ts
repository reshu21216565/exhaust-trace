import { SimulationWorld } from '@exhausttrace/simulation';
import { ObservationAdapter } from '@exhausttrace/observation';
import type { RemedyProposal, RemedySimulationResult, RemedySimulationPoint, ResourceType } from '@exhausttrace/shared';

export class RemedySimulator {
  public static simulateRemedy(
    liveWorld: SimulationWorld,
    proposal: RemedyProposal,
    horizonTicks = 50
  ): RemedySimulationResult {
    // 1. Capture snapshot of live world
    const snapshot = liveWorld.createSnapshot();

    // 2. Instantiate remedy fork world & baseline control world
    const forkWorld = new SimulationWorld(`remedy-fork-${Date.now()}`, liveWorld.config);
    forkWorld.restoreSnapshot(snapshot);

    const baselineWorld = new SimulationWorld(`remedy-base-${Date.now()}`, liveWorld.config);
    baselineWorld.restoreSnapshot(snapshot);

    const observationAdapter = new ObservationAdapter();

    const startTick = forkWorld.clock.currentTick;
    const targetService = proposal.targetService || 'records';
    const targetResource = (proposal.targetResource || 'MEMORY') as ResourceType;

    // Ensure baseline and fork worlds both have an active exhaustion scenario if liveWorld is fresh
    if (!forkWorld.injectedRoot) {
      forkWorld.injectExhaustion(targetService, targetResource, 'CRITICAL');
      baselineWorld.injectExhaustion(targetService, targetResource, 'CRITICAL');
    }

    // Warm up both worlds briefly if at tick 0 so telemetry reflects active resource pressure
    if (forkWorld.clock.currentTick < 3) {
      for (let w = 0; w < 5; w++) {
        forkWorld.tick();
        baselineWorld.tick();
      }
    }

    // Capture initial baseline incident telemetry BEFORE applying remedy to fork
    let initialTickTelemetry = observationAdapter.extractObservableTelemetry(baselineWorld);
    let initialRootSvc = initialTickTelemetry.services.find(s => s.serviceId === targetService);

    let initialRootPressure = Math.max(0.7, initialRootSvc?.resources[targetResource]?.pressure ?? 0.95);
    let initialRootLatency = Math.max(250, initialRootSvc?.metrics.latencyMs ?? 550);
    let initialTimeout = Math.max(0.05, initialRootSvc?.metrics.timeoutRate ?? 0.15);
    let initialQueue = Math.max(10, initialRootSvc?.metrics.queueDepth ?? 30);

    // 3. Apply proposed remedy action ONLY to remedy fork world
    if (proposal.action === 'RELIEVE_RESOURCE' || proposal.category === 'FIX') {
      forkWorld.relieveExhaustion(targetService, targetResource);
    } else if (proposal.action === 'REDUCE_RETRY_PRESSURE' || proposal.action === 'RATE_LIMIT' || proposal.action === 'SHED_LOAD') {
      forkWorld.relieveExhaustion(targetService, targetResource);
    } else if (proposal.action === 'ADJUST_CAPACITY') {
      forkWorld.relieveExhaustion(targetService, targetResource);
    }

    const trajectory: RemedySimulationPoint[] = [];

    // 4. Step both worlds forward in parallel
    for (let i = 1; i <= horizonTicks; i++) {
      forkWorld.tick();
      baselineWorld.tick();

      const tickData = observationAdapter.extractObservableTelemetry(forkWorld);
      const baseTickData = observationAdapter.extractObservableTelemetry(baselineWorld);

      const rootSvc = tickData.services.find(s => s.serviceId === targetService);
      const apptSvc = tickData.services.find(s => s.serviceId === 'appointment');

      const baseRootSvc = baseTickData.services.find(s => s.serviceId === targetService);

      trajectory.push({
        tick: forkWorld.clock.currentTick,
        relativeTick: i,
        rootPressure: rootSvc?.resources[targetResource]?.pressure ?? 0.1,
        rootLatency: rootSvc?.metrics.latencyMs ?? 20,
        downstreamLatency: apptSvc?.metrics.latencyMs ?? 25,
        queueDepth: rootSvc?.metrics.queueDepth ?? 0,
        timeoutRate: rootSvc?.metrics.timeoutRate ?? 0,
        retryRate: rootSvc?.metrics.retryRate ?? 0,
        baselineRootPressure: Math.max(0.7, baseRootSvc?.resources[targetResource]?.pressure ?? initialRootPressure),
        baselineRootLatency: Math.max(250, baseRootSvc?.metrics.latencyMs ?? initialRootLatency),
        baselineQueueDepth: Math.max(10, baseRootSvc?.metrics.queueDepth ?? initialQueue),
        baselineTimeoutRate: Math.max(0.05, baseRootSvc?.metrics.timeoutRate ?? initialTimeout),
      });
    }

    const finalPoint = trajectory[trajectory.length - 1] || {
      rootPressure: 0.1,
      rootLatency: 20,
      downstreamLatency: 25,
      queueDepth: 0,
      timeoutRate: 0,
      retryRate: 0,
      baselineRootPressure: initialRootPressure,
      baselineRootLatency: initialRootLatency,
      baselineQueueDepth: initialQueue,
      baselineTimeoutRate: initialTimeout,
    };

    const basePressure = Math.max(0.5, finalPoint.baselineRootPressure ?? initialRootPressure);
    const baseLatency = Math.max(200, finalPoint.baselineRootLatency ?? initialRootLatency);
    const baseTimeout = Math.max(0.05, finalPoint.baselineTimeoutRate ?? initialTimeout);
    const baseQueue = Math.max(10, finalPoint.baselineQueueDepth ?? initialQueue);

    // 5. Calculate deterministic effectiveness metrics
    const pressureReduction = Math.max(0, Math.min(1, (basePressure - finalPoint.rootPressure) / basePressure));
    const latencyReduction = Math.max(0, Math.min(1, (baseLatency - finalPoint.rootLatency) / baseLatency));
    const timeoutReduction = Math.max(0, Math.min(1, (baseTimeout - finalPoint.timeoutRate) / baseTimeout));
    const queueDrainScore = Math.max(0, Math.min(1, (baseQueue - finalPoint.queueDepth) / baseQueue));

    const rawScore = (pressureReduction * 35) + (latencyReduction * 25) + (timeoutReduction * 20) + (queueDrainScore * 20);
    const effectivenessScore = Math.round(Math.max(10, Math.min(100, rawScore)));

    const summary = `Simulated ${proposal.title}: Root pressure reduced by ${Math.round(pressureReduction * 100)}%, latency by ${Math.round(latencyReduction * 100)}%, timeout rate dropped to ${(finalPoint.timeoutRate * 100).toFixed(1)}%.`;

    return {
      remedyId: proposal.id,
      simulatedAtTick: startTick,
      horizonTicks,
      effectivenessScore,
      pressureReduction: Math.round(pressureReduction * 1000) / 1000,
      latencyReduction: Math.round(latencyReduction * 1000) / 1000,
      timeoutReduction: Math.round(timeoutReduction * 1000) / 1000,
      queueDrainScore: Math.round(queueDrainScore * 1000) / 1000,
      trajectory,
      summary
    };
  }
}
