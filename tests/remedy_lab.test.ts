import { describe, it, expect } from 'vitest';
import { SimulationWorld, DefaultConfig } from '@exhausttrace/simulation';
import { RemedyValidator } from '../backend/src/remedy/RemedyValidator';
import { RemedySimulator } from '../backend/src/remedy/RemedySimulator';
import { RemedyPlanner } from '../backend/src/remedy/RemedyPlanner';
import type { RemedyProposal } from '@exhausttrace/shared';

describe('Remedy Lab Architecture & Security Tests', () => {
  it('1. Rejects proposals with invalid services', () => {
    const invalidProposal: Partial<RemedyProposal> = {
      id: 'rem-invalid-1',
      title: 'Invalid Service Remedy',
      category: 'FIX',
      targetService: 'non_existent_database_service',
      targetResource: 'MEMORY',
      action: 'RELIEVE_RESOURCE'
    };
    const res = RemedyValidator.validateProposal(invalidProposal);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/Unsupported target service/);
  });

  it('2. Rejects proposals with invalid resources', () => {
    const invalidProposal: Partial<RemedyProposal> = {
      id: 'rem-invalid-2',
      title: 'Invalid Resource Remedy',
      category: 'FIX',
      targetService: 'records',
      targetResource: 'GPU' as any,
      action: 'RELIEVE_RESOURCE'
    };
    const res = RemedyValidator.validateProposal(invalidProposal);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/Unsupported target resource/);
  });

  it('3. Validates supported proposals correctly', () => {
    const validProposal: Partial<RemedyProposal> = {
      id: 'rem-valid-1',
      title: 'Relieve Records Memory',
      category: 'FIX',
      targetService: 'records',
      targetResource: 'MEMORY',
      action: 'RELIEVE_RESOURCE',
      risk: 'LOW',
      confidence: 0.95
    };
    const res = RemedyValidator.validateProposal(validProposal);
    expect(res.valid).toBe(true);
    expect(res.sanitizedProposal?.simulatable).toBe(true);
  });

  it('4. Simulation isolation: Remedy simulation DOES NOT mutate live world state', () => {
    const seed = `remedy-isolation-test-${Date.now()}`;
    const liveWorld = new SimulationWorld(seed, DefaultConfig);
    
    // Inject exhaustion into live world
    liveWorld.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i = 0; i < 10; i++) liveWorld.tick();

    const liveTickBefore = liveWorld.clock.currentTick;
    const recordsStateBefore = liveWorld.nodes.get('records')?.state.resources.MEMORY.pressure;

    const proposal: RemedyProposal = {
      id: 'rem-test-1',
      category: 'FIX',
      title: 'Fix Records Memory',
      description: 'Relieve records memory',
      targetService: 'records',
      targetResource: 'MEMORY',
      action: 'RELIEVE_RESOURCE',
      parameters: {},
      rationale: 'Root cause fix',
      evidenceReferences: [],
      risk: 'LOW',
      confidence: 0.9,
      simulatable: true
    };

    // Run simulation
    const result = RemedySimulator.simulateRemedy(liveWorld, proposal, 30);

    // Verify live world was NOT mutated
    expect(liveWorld.clock.currentTick).toBe(liveTickBefore);
    expect(liveWorld.nodes.get('records')?.state.resources.MEMORY.pressure).toBe(recordsStateBefore);
    expect(typeof result.effectivenessScore).toBe('number');
    expect(result.trajectory.length).toBe(30);
  });

  it('5. Determinism: Identical snapshot + identical proposal = identical simulation output', () => {
    const seed = `remedy-determinism-test-${Date.now()}`;
    const liveWorld = new SimulationWorld(seed, DefaultConfig);
    liveWorld.injectExhaustion('records', 'MEMORY', 'CRITICAL');
    for (let i = 0; i < 15; i++) liveWorld.tick();

    const proposal: RemedyProposal = {
      id: 'rem-det-1',
      category: 'FIX',
      title: 'Fix Records Memory',
      description: 'Relieve records memory',
      targetService: 'records',
      targetResource: 'MEMORY',
      action: 'RELIEVE_RESOURCE',
      parameters: {},
      rationale: 'Root cause fix',
      evidenceReferences: [],
      risk: 'LOW',
      confidence: 0.9,
      simulatable: true
    };

    const sim1 = RemedySimulator.simulateRemedy(liveWorld, proposal, 20);
    const sim2 = RemedySimulator.simulateRemedy(liveWorld, proposal, 20);

    expect(sim1.effectivenessScore).toBe(sim2.effectivenessScore);
    expect(sim1.trajectory.length).toBe(sim2.trajectory.length);
    expect(sim1.trajectory[15].rootPressure).toBe(sim2.trajectory[15].rootPressure);
  });
});
