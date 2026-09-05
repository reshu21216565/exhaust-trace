import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationWorld } from '../packages/simulation/src/index';

describe('Simulation Behavioral Tests', () => {
  
  it('Test A — Healthy stability', () => {
    const world = new SimulationWorld('seed-A');
    for (let i = 0; i < 300; i++) world.tick();
    
    for (const [id, node] of world.nodes) {
      expect(node.state.queueDepth).toBeLessThan(10);
      expect(node.state.timeoutRate).toBeLessThan(5);
      expect(node.state.retryRate).toBeLessThan(5);
      for (const res of Object.values(node.state.resources)) {
        expect(res.pressure).toBeLessThan(0.85);
      }
    }
  });

  it('Test B — Determinism', () => {
    const world1 = new SimulationWorld('seed-B');
    const world2 = new SimulationWorld('seed-B');
    
    for (let i = 0; i < 50; i++) {
      world1.tick();
      world2.tick();
    }
    
    expect(world1.createSnapshot()).toEqual(world2.createSnapshot());
  });

  it('Test C — Different seeds', () => {
    const world1 = new SimulationWorld('seed-C1');
    const world2 = new SimulationWorld('seed-C2');
    
    for (let i = 0; i < 50; i++) {
      world1.tick();
      world2.tick();
    }
    
    expect(world1.createSnapshot()).not.toEqual(world2.createSnapshot());
  });

  it('Test D — Resource injection & Test F - Latency coupling', () => {
    const world = new SimulationWorld('seed-D');
    for (let i = 0; i < 50; i++) world.tick();
    
    const records = world.nodes.get('records')!;
    const initialLatency = records.state.latency;
    
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i = 0; i < 150; i++) world.tick();
    
    expect(records.state.resources['MEMORY'].pressure).toBeGreaterThan(0.9);
    expect(records.state.latency).toBeGreaterThan(initialLatency * 1.5);
  });

  it('Test G, H, I, J — Timeout coupling, Retry coupling, Dependency Propagation', () => {
    const world = new SimulationWorld('seed-G');
    // Warmup
    for (let i = 0; i < 100; i++) world.tick();
    
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    
    // Give it time to propagate
    for (let i = 0; i < 300; i++) world.tick();

    const portal = world.nodes.get('portal')!;
    const appt = world.nodes.get('appointment')!;
    const records = world.nodes.get('records')!;

    // Records has high latency
    expect(records.state.latency).toBeGreaterThan(150);
    
    // Appointment calls Records, gets timeouts -> generates retries
    expect(appt.state.timeoutRate).toBeGreaterThan(0);
    expect(appt.state.retryRate).toBeGreaterThan(0);

    // Dependency load on Records increases due to retries
    const recordsTotalRate = records.state.incomingRate + records.state.retryIncomingRate;
    // Expected incoming was ~60. With retries, it should be significantly higher.
    // We check that retries > 0 for records incoming
    expect(records.state.retryIncomingRate).toBeGreaterThan(0);

    // Portal is affected
    expect(portal.state.timeoutRate).toBeGreaterThan(0);
  });

  it('Test M — Root recovery', () => {
    const world = new SimulationWorld('seed-M');
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i = 0; i < 400; i++) world.tick();

    const appt = world.nodes.get('appointment')!;
    const peakTimeouts = appt.state.timeoutRate;
    
    world.relieveExhaustion('records', 'MEMORY');
    for (let i = 0; i < 400; i++) world.tick();

    expect(appt.state.timeoutRate).toBeLessThan(peakTimeouts);
    expect(world.nodes.get('records')!.state.resources['MEMORY'].pressure).toBeLessThan(0.7);
  });

  it('Test O — Snapshot determinism', () => {
    const worldA = new SimulationWorld('seed-O');
    const worldB = new SimulationWorld('seed-O');
    
    for (let i = 0; i < 100; i++) {
      worldA.tick();
      worldB.tick();
    }

    const snap = worldA.createSnapshot();
    worldB.restoreSnapshot(snap);

    for (let i = 0; i < 100; i++) {
      worldA.tick();
      worldB.tick();
    }

    expect(worldA.createSnapshot()).toEqual(worldB.createSnapshot());
  });
});
