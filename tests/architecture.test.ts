import { describe, it, expect } from 'vitest';
import { RNG } from '../packages/simulation/src/index';
import { ObservationAdapter } from '../packages/observation/src/index';
import { SimulationWorld } from '../packages/simulation/src/index';

describe('Architecture & Boundaries', () => {
  it('Deterministic RNG produces reproducible sequences', () => {
    const rng1 = new RNG('test-seed-123');
    const seq1 = [rng1.random(), rng1.random(), rng1.random()];

    const rng2 = new RNG('test-seed-123');
    const seq2 = [rng2.random(), rng2.random(), rng2.random()];

    expect(seq1).toEqual(seq2);
    expect(seq1[0]).not.toEqual(seq1[1]); // Ensure it actually changes
  });

  it('Observation layer strips hidden ground truth', () => {
    const world = new SimulationWorld('seed');
    // We need to advance time or interact properly to have state
    const recordsNode = world.nodes.get('records')!;
    recordsNode.state.queueDepth = 5;
    recordsNode.state.resources['MEMORY'].utilization = 1.0;

    world.injectedRoot = {
      serviceId: 'records',
      resourceId: 'MEMORY',
      severity: 100
    };

    const observer = new ObservationAdapter();
    const telemetryTick = observer.extractObservableTelemetry(world);

    const recTele = telemetryTick.services.find(t => t.serviceId === 'records')!;
    expect(recTele.metrics.queueDepth).toBe(5);
    expect(recTele.resources.MEMORY.utilization).toBe(1);

    // But MUST NOT contain any reference to 'injectedRoot'
    const stringified = JSON.stringify(telemetryTick);
    expect(stringified).not.toContain('injectedRoot');
    expect(stringified).not.toContain('severity":100'); // the hidden config severity
  });
});

