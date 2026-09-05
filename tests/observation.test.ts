import { describe, it, expect, beforeEach } from 'vitest';
import { 
  SimulationWorld, 
  DefaultConfig 
} from '../packages/simulation/src/index';
import { 
  ObservationAdapter, 
  ObservationHistory 
} from '../packages/observation/src/index';
import { DefaultObservationConfig } from '../packages/shared/src/index';

describe('Block 2: Observation Layer', () => {
  
  let world: SimulationWorld;
  let adapter: ObservationAdapter;
  let history: ObservationHistory;

  beforeEach(() => {
    world = new SimulationWorld(DefaultConfig);
    adapter = new ObservationAdapter(DefaultObservationConfig);
    history = new ObservationHistory(adapter.extractDependencyGraph(world));
  });

  const getBaseCapacities = () => {
    const caps: Record<string, number> = {};
    world.state.services.forEach((s, sid) => {
      caps[sid] = s.resources.CPU.capacity; // Simplification for tests
    });
    return caps;
  };

  const getBaseLatencies = () => {
    const lats: Record<string, number> = {};
    world.state.services.forEach((s, sid) => {
      lats[sid] = s.params.baseLatency;
    });
    return lats;
  };

  it('Test 1 - Telemetry Projection matches simulation exactly', () => {
    world.tick();
    const obs = adapter.extractObservableTelemetry(world);
    
    // Portal memory utilization check
    const portalTrue = world.state.services.get('portal')!;
    const portalObs = obs.services.find(s => s.serviceId === 'portal')!;
    expect(portalObs.resources.MEMORY.utilization).toBe(portalTrue.resources.MEMORY.utilization);
    expect(portalObs.metrics.queueDepth).toBe(portalTrue.queueDepth);
    expect(portalObs.metrics.latencyMs).toBe(portalTrue.latency);
  });

  it('Test 2, 22 - Ground Truth Security (Recursive)', () => {
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i=0; i<10; i++) {
      world.tick();
      const tick = adapter.extractObservableTelemetry(world);
      const events = adapter.generateEvents(tick, adapter.extractDependencyGraph(world), getBaseCapacities(), getBaseLatencies());
      history.appendTelemetry(tick);
      history.appendEvents(events);
    }

    const bundle = history.getObservableBundle();
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain('injectedRoot');
    expect(serialized).not.toContain('injectedResource');
    expect(serialized).not.toContain('trueRoot');
    expect(serialized).not.toContain('AuthoritativeState');
    expect(serialized).not.toContain('SimulationWorld');
    
    const checkObj = (obj: any) => {
      if (!obj) return;
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          expect(k).not.toBe('injectedRoot');
          expect(k).not.toBe('injectedResource');
          expect(k).not.toBe('trueRoot');
          expect(k).not.toBe('trueRootService');
          expect(k).not.toBe('trueRootResource');
          checkObj(obj[k]);
        }
      }
    };
    checkObj(bundle);
  });

  it('Test 3 - Root Non-Disclosure Across Scenarios', () => {
    // Run Records/MEMORY
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for(let i=0;i<5;i++) world.tick();
    const t1 = adapter.extractObservableTelemetry(world);
    
    // Run Records/CPU
    const world2 = new SimulationWorld(DefaultConfig);
    const adapter2 = new ObservationAdapter(DefaultObservationConfig);
    world2.injectExhaustion('records', 'CPU', 'CRITICAL');
    for(let i=0;i<5;i++) world2.tick();
    const t2 = adapter2.extractObservableTelemetry(world2);
    
    const bundle1 = JSON.stringify(t1);
    const bundle2 = JSON.stringify(t2);
    expect(bundle1).not.toContain('injectedRoot');
    expect(bundle2).not.toContain('injectedRoot');
  });

  it('Test 4 & 5 - Resource State Events & Deduplication', () => {
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    
    let criticalCount = 0;
    
    for (let i = 0; i < 25; i++) {
      world.tick();
      const tick = adapter.extractObservableTelemetry(world);
      const events = adapter.generateEvents(tick, adapter.extractDependencyGraph(world), getBaseCapacities(), getBaseLatencies());
      const evs = events.filter(e => e.type === 'RESOURCE_PRESSURE_CHANGED' && (e as any).status === 'CRITICAL');
      criticalCount += evs.length;
    }
    
    expect(criticalCount).toBe(1); // Emitted exactly once
  });

  it('Test 6 - Temporal Ordering', () => {
    world.tick();
    const tick = adapter.extractObservableTelemetry(world);
    expect(tick.tick).toBe(world.clock.currentTick);
    expect(tick.timestamp).toBe(world.clock.timestamp);
  });

  it('Test 7 - Same Seed Determinism', () => {
    const w1 = new SimulationWorld({...DefaultConfig, seed: 12345});
    const a1 = new ObservationAdapter(DefaultObservationConfig);
    const h1 = new ObservationHistory(a1.extractDependencyGraph(w1));

    const w2 = new SimulationWorld({...DefaultConfig, seed: 12345});
    const a2 = new ObservationAdapter(DefaultObservationConfig);
    const h2 = new ObservationHistory(a2.extractDependencyGraph(w2));

    for (let i=0; i<10; i++) {
      w1.tick();
      w2.tick();
      const t1 = a1.extractObservableTelemetry(w1);
      const t2 = a2.extractObservableTelemetry(w2);
      h1.appendTelemetry(t1);
      h1.appendEvents(a1.generateEvents(t1, a1.extractDependencyGraph(w1), getBaseCapacities(), getBaseLatencies()));
      h2.appendTelemetry(t2);
      h2.appendEvents(a2.generateEvents(t2, a2.extractDependencyGraph(w2), getBaseCapacities(), getBaseLatencies()));
    }

    expect(JSON.stringify(h1.getObservableBundle())).toBe(JSON.stringify(h2.getObservableBundle()));
  });

  it('Test 9 - Bounds verification', () => {
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i=0; i<20; i++) {
      world.tick();
      const tick = adapter.extractObservableTelemetry(world);
      for (const s of tick.services) {
        expect(s.metrics.latencyMs).toBeGreaterThanOrEqual(0);
        expect(s.metrics.queueDepth).toBeGreaterThanOrEqual(0);
        expect(s.metrics.queueDepth).toBeLessThanOrEqual(s.metrics.maxQueueDepth);
        expect(s.resources.MEMORY.utilization).toBeLessThanOrEqual(1);
        expect(s.resources.MEMORY.utilization).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(s.metrics.latencyMs)).toBe(false);
      }
    }
  });

  it('Test 10 & 18 - Dependency edge semantics and direction', () => {
    const g = adapter.extractDependencyGraph(world);
    // portal calls appointment
    expect(g.edges.find(e => e.from === 'portal' && e.to === 'appointment')).toBeDefined();
    expect(g.edges.find(e => e.from === 'appointment' && e.to === 'portal')).toBeUndefined();
  });

  it('Test 11 - Queue Event Deduplication', () => {
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    let qEvents = 0;
    for (let i=0; i<50; i++) {
      world.tick();
      const tick = adapter.extractObservableTelemetry(world);
      const events = adapter.generateEvents(tick, adapter.extractDependencyGraph(world), getBaseCapacities(), getBaseLatencies());
      qEvents += events.filter(e => e.type === 'QUEUE_GROWTH').length;
    }
    expect(qEvents).toBeGreaterThan(0);
    expect(qEvents).toBeLessThanOrEqual(5 * world.state.services.size); 
  });

  it('Test 17 - Historical Immutability', () => {
    world.tick();
    const tick = adapter.extractObservableTelemetry(world);
    history.appendTelemetry(tick);
    
    const retrieved = history.getTelemetry();
    retrieved[0].services[0].metrics.latencyMs = 9999;
    
    const retrievedAgain = history.getTelemetry();
    expect(retrievedAgain[0].services[0].metrics.latencyMs).not.toBe(9999);
  });
});
