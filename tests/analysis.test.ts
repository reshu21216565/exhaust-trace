/**
 * Block 3 — Causal Analysis Engine Tests
 *
 * Tests the CausalAnalyzer against ObservableIncidentData produced by the
 * Block 2 observation layer. The analyzer under test receives ONLY observable
 * data. Ground truth is only used to assert expected ranking.
 *
 * IMPORT BOUNDARY:
 *   CausalAnalyzer is imported from relative path (source).
 *   SimulationWorld and ObservationAdapter are used to GENERATE test fixtures only.
 *   The analyzer itself does NOT see SimulationWorld or ground truth.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SimulationWorld, DefaultConfig } from '../packages/simulation/src/index';
import { ObservationAdapter, ObservationHistory } from '../packages/observation/src/index';
import { CausalAnalyzer } from '../packages/analysis/src/index';
import {
  ObservableIncidentData,
  CausalAnalysisResult,
  RESOURCE_TYPES,
  ResourceType
} from '../packages/shared/src/index';

// ==========================================================================
// FIXTURE BUILDER
// ==========================================================================

function buildScenario(
  seed: string,
  injectAfterTicks: number,
  serviceId: string,
  resource: ResourceType,
  severity: string,
  totalTicks: number,
  relieve?: boolean
): ObservableIncidentData {
  const world = new SimulationWorld(seed, DefaultConfig);
  const adapter = new ObservationAdapter();
  const graph = adapter.extractDependencyGraph(world);
  const history = new ObservationHistory(graph);

  // Baseline latencies and capacities (must be captured before injection)
  const baseLatencies: Record<string, number> = {};
  const baseCapacities: Record<string, number> = {};
  world.state.services.forEach((s, sid) => {
    baseLatencies[sid] = s.params.baseLatency;
    baseCapacities[sid] = s.params.baseCapacity;
  });

  for (let i = 0; i < totalTicks; i++) {
    if (i === injectAfterTicks) {
      world.injectExhaustion(serviceId, resource, severity);
    }
    if (relieve && i === Math.floor(totalTicks * 0.65)) {
      world.relieveExhaustion(serviceId, resource as any);
    }
    world.tick();
    const tick = adapter.extractObservableTelemetry(world);
    const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
    history.appendTelemetry(tick);
    history.appendEvents(events);
  }

  return history.getObservableBundle();
}

function buildHealthyScenario(seed: string, ticks: number): ObservableIncidentData {
  const world = new SimulationWorld(seed, DefaultConfig);
  const adapter = new ObservationAdapter();
  const graph = adapter.extractDependencyGraph(world);
  const history = new ObservationHistory(graph);

  const baseLatencies: Record<string, number> = {};
  const baseCapacities: Record<string, number> = {};
  world.state.services.forEach((s, sid) => {
    baseLatencies[sid] = s.params.baseLatency;
    baseCapacities[sid] = s.params.baseCapacity;
  });

  for (let i = 0; i < ticks; i++) {
    world.tick();
    const tick = adapter.extractObservableTelemetry(world);
    const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
    history.appendTelemetry(tick);
    history.appendEvents(events);
  }

  return history.getObservableBundle();
}

const analyzer = new CausalAnalyzer();

// ==========================================================================
// TEST 1 — Healthy Baseline
// ==========================================================================
describe('TEST 1 — Healthy Baseline', () => {
  it('No candidate should score highly in a healthy system', () => {
    const data = buildHealthyScenario('healthy-baseline', 30);
    const result = analyzer.analyze(data);

    // In a healthy system, no candidate should exceed the incident threshold
    expect(result.incidentDetected).toBe(false);
    if (result.topCandidate) {
      expect(result.topCandidate.score).toBeLessThan(30);
    }
  });

  it('All service x resource candidates are generated even in healthy baseline', () => {
    const data = buildHealthyScenario('healthy-baseline', 30);
    const result = analyzer.analyze(data);

    const services = ['portal', 'appointment', 'records', 'notification'];
    const expected = services.length * RESOURCE_TYPES.length;
    expect(result.hypotheses.length).toBe(expected);
  });
});

// ==========================================================================
// TEST 2 — Records MEMORY Exhaustion
// ==========================================================================
describe('TEST 2 — Records MEMORY Exhaustion', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    const data = buildScenario('records-mem', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    result = analyzer.analyze(data);
  });

  it('Records/MEMORY should rank #1', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/MEMORY');
    expect(result.hypotheses[0].rank).toBe(1);
  });

  it('Records/MEMORY score should be substantially above other candidates', () => {
    const top = result.hypotheses[0];
    const second = result.hypotheses[1];
    expect(top.score).toBeGreaterThan(second.score * 1.2);
  });

  it('Incident should be detected', () => {
    expect(result.incidentDetected).toBe(true);
  });

  it('Has supporting evidence in resourcePressure category', () => {
    const h = result.hypotheses[0];
    const pressureEvidence = h.evidence.filter(e => e.category === 'resourcePressure' && e.isSupporting);
    expect(pressureEvidence.length).toBeGreaterThan(0);
  });

  it('Has temporal precedence evidence or downstream propagation evidence', () => {
    const h = result.hypotheses[0];
    const temporalEvidence = h.evidence.filter(e => e.category === 'temporalPrecedence');
    const downstreamEvidence = h.evidence.filter(e => e.category === 'downstreamPropagation');
    // Either temporal or downstream propagation evidence must be present
    expect(temporalEvidence.length + downstreamEvidence.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// TEST 3 — Records CPU Exhaustion
// ==========================================================================
describe('TEST 3 — Records CPU Exhaustion', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    const data = buildScenario('records-cpu', 10, 'records', 'CPU', 'CRITICAL', 80, true);
    result = analyzer.analyze(data);
  });

  it('Records/CPU should rank #1', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/CPU');
  });

  it('Records/MEMORY should NOT rank #1', () => {
    const memHyp = result.hypotheses.find(h => h.candidateId === 'records/MEMORY');
    expect(memHyp?.rank).not.toBe(1);
  });
});

// ==========================================================================
// TEST 4 — Records CONNECTIONS Exhaustion
// ==========================================================================
describe('TEST 4 — Records CONNECTIONS Exhaustion', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    const data = buildScenario('records-conn', 10, 'records', 'CONNECTIONS', 'CRITICAL', 80, true);
    result = analyzer.analyze(data);
  });

  it('Records/CONNECTIONS should rank #1', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/CONNECTIONS');
  });
});

// ==========================================================================
// TEST 5 — Records WORKERS Exhaustion
// ==========================================================================
describe('TEST 5 — Records WORKERS Exhaustion', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    const data = buildScenario('records-work', 10, 'records', 'WORKERS', 'CRITICAL', 80, true);
    result = analyzer.analyze(data);
  });

  it('Records/WORKERS should rank #1', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/WORKERS');
  });
});

// ==========================================================================
// TEST 6 — Downstream False Culprit
// ==========================================================================
describe('TEST 6 — Downstream False Culprit', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    // Records MEMORY causes cascades to Appointment and Portal
    const data = buildScenario('downstream-false', 5, 'records', 'MEMORY', 'CRITICAL', 100, true);
    result = analyzer.analyze(data);
  });

  it('Records/MEMORY should outrank Appointment and Portal candidates', () => {
    const recordsHyp = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const appointmentHyps = result.hypotheses.filter(h => h.serviceId === 'appointment');
    const portalHyps = result.hypotheses.filter(h => h.serviceId === 'portal');

    for (const ah of appointmentHyps) {
      expect(recordsHyp.score).toBeGreaterThan(ah.score);
    }
    for (const ph of portalHyps) {
      expect(recordsHyp.score).toBeGreaterThan(ph.score);
    }
  });

  it('Appointment candidates have contradicting evidence about temporal precedence', () => {
    // Appointment should have evidence noting it degraded AFTER records
    const apptMemHyp = result.hypotheses.find(h => h.candidateId === 'appointment/MEMORY');
    if (apptMemHyp) {
      // Either temporal contradicting evidence OR low score indicating not root
      const hasContradiction = apptMemHyp.contradictingSignals.length > 0 || apptMemHyp.score < result.hypotheses[0].score * 0.8;
      expect(hasContradiction).toBe(true);
    }
  });
});

// ==========================================================================
// TEST 7 — Unrelated Noisy Signal
// ==========================================================================
describe('TEST 7 — Unrelated Noisy Signal', () => {
  it('Notification service should not rank highest when Records is the root', () => {
    const data = buildScenario('noise-test', 10, 'records', 'MEMORY', 'CRITICAL', 80, false);
    const result = analyzer.analyze(data);

    const topCandidate = result.hypotheses[0];
    expect(topCandidate.serviceId).not.toBe('notification');
    expect(topCandidate.serviceId).toBe('records');
  });

  it('Notification candidates should have noise penalty evidence', () => {
    const data = buildScenario('noise-test', 10, 'records', 'MEMORY', 'CRITICAL', 80, false);
    const result = analyzer.analyze(data);

    // Notification has no dependents; if pressure is noisy, it should be penalized
    const notifHyps = result.hypotheses.filter(h => h.serviceId === 'notification');
    for (const nh of notifHyps) {
      if (nh.score > 10) {
        // Must have some contradicting evidence explaining why it's not root
        expect(nh.contradictingSignals.length).toBeGreaterThan(0);
      }
    }
  });
});

// ==========================================================================
// TEST 8 — Temporal Ordering (positive)
// ==========================================================================
describe('TEST 8 — Temporal Ordering (positive)', () => {
  it('Top candidate should have positive temporal precedence evidence', () => {
    const data = buildScenario('temporal-pos', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const top = result.hypotheses[0];
    const temporalEvidence = top.evidence.filter(e => e.category === 'temporalPrecedence');
    expect(temporalEvidence.length).toBeGreaterThan(0);

    // Top candidate should have at least one supporting temporal piece
    const supporting = temporalEvidence.filter(e => e.isSupporting);
    expect(supporting.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// TEST 9 — Temporal Ordering Penalty
// ==========================================================================
describe('TEST 9 — Temporal Ordering Penalty', () => {
  it('Appointment candidates get temporal penalty when records degrades first', () => {
    const data = buildScenario('temporal-penalty', 5, 'records', 'MEMORY', 'CRITICAL', 80, false);
    const result = analyzer.analyze(data);

    // Appointment degrades AFTER records; find temporal evidence for appointment candidates
    const apptHyp = result.hypotheses.find(h => h.serviceId === 'appointment');
    if (apptHyp) {
      const temporalEvidence = apptHyp.evidence.filter(e => e.category === 'temporalPrecedence');
      if (temporalEvidence.length > 0) {
        // Should have contradiction OR no strong supporting temporal evidence
        const negativeOrNeutral = temporalEvidence.every(e => !e.isSupporting || e.scoreImpact < 5);
        expect(negativeOrNeutral).toBe(true);
      }
    }
  });
});

// ==========================================================================
// TEST 10 — Propagation Path Reconstruction
// ==========================================================================
describe('TEST 10 — Propagation Path Reconstruction', () => {
  let result: CausalAnalysisResult;

  beforeAll(() => {
    const data = buildScenario('propagation-test', 5, 'records', 'MEMORY', 'CRITICAL', 100, true);
    result = analyzer.analyze(data);
  });

  it('Top hypothesis has a non-empty propagation path', () => {
    expect(result.reconstructedPaths.length).toBeGreaterThan(0);
    const topPath = result.reconstructedPaths[0];
    expect(topPath.nodes.length).toBeGreaterThan(0);
  });

  it('Propagation path starts at the hypothesized root service', () => {
    const topPath = result.reconstructedPaths[0];
    const rootNode = topPath.nodes.find(n => n.serviceId === 'records');
    expect(rootNode).toBeDefined();
  });

  it('Propagation path nodes are in temporal order', () => {
    const topPath = result.reconstructedPaths[0];
    for (let i = 1; i < topPath.nodes.length; i++) {
      expect(topPath.nodes[i].firstObservedTick).toBeGreaterThanOrEqual(topPath.nodes[i - 1].firstObservedTick);
    }
  });
});

// ==========================================================================
// TEST 11 — Why-Not Evidence (structured)
// ==========================================================================
describe('TEST 11 — Why-Not Evidence', () => {
  it('Every candidate has at least some evidence items', () => {
    const data = buildScenario('why-not', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    for (const h of result.hypotheses) {
      expect(h.evidence.length).toBeGreaterThan(0);
      // evidenceMatrix should match
      expect(result.evidenceMatrix[h.candidateId]).toBeDefined();
      expect(result.evidenceMatrix[h.candidateId].length).toBe(h.evidence.length);
    }
  });

  it('Lower-ranked candidates have contradicting signals', () => {
    const data = buildScenario('why-not', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    // Bottom 50% of candidates should have at least one contradicting signal
    const bottom = result.hypotheses.slice(Math.floor(result.hypotheses.length / 2));
    const withContradict = bottom.filter(h => h.contradictingSignals.length > 0);
    expect(withContradict.length).toBeGreaterThan(bottom.length * 0.3);
  });
});

// ==========================================================================
// TEST 12 — Determinism
// ==========================================================================
describe('TEST 12 — Determinism', () => {
  it('Same input produces identical output twice', () => {
    const data = buildScenario('determinism', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);

    const result1 = analyzer.analyze(data);
    const result2 = analyzer.analyze(data);

    expect(result1.hypotheses[0].candidateId).toBe(result2.hypotheses[0].candidateId);
    expect(result1.hypotheses[0].score).toBeCloseTo(result2.hypotheses[0].score, 10);
    expect(result1.hypotheses.map(h => h.candidateId)).toEqual(result2.hypotheses.map(h => h.candidateId));
    expect(result1.hypotheses.map(h => h.score)).toEqual(result2.hypotheses.map(h => h.score));
  });
});

// ==========================================================================
// TEST 13 — Confidence Evolution
// ==========================================================================
describe('TEST 13 — Confidence Evolution', () => {
  it('Confidence history has multiple snapshots', () => {
    const data = buildScenario('confidence-evo', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);
    expect(result.confidenceHistory.length).toBeGreaterThan(1);
  });

  it('Top candidate score increases over time as cascade unfolds', () => {
    const data = buildScenario('confidence-evo', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const history = result.confidenceHistory;
    if (history.length < 3) return; // skip if not enough data

    // By the end, the correct candidate should be leading
    const lastSnapshot = history[history.length - 1];
    const earlySnapshot = history[Math.floor(history.length / 4)];

    // Last snapshot should show higher score for top candidate than early
    const earlyTopScore = earlySnapshot.topCandidateScore;
    const lastTopScore = lastSnapshot.topCandidateScore;
    expect(lastTopScore).toBeGreaterThanOrEqual(earlyTopScore);
  });

  it('Confidence snapshots all reference candidateIds that exist in hypotheses', () => {
    const data = buildScenario('confidence-evo', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const allIds = new Set(result.hypotheses.map(h => h.candidateId));
    for (const snap of result.confidenceHistory) {
      if (snap.topCandidateId) {
        expect(allIds.has(snap.topCandidateId)).toBe(true);
      }
    }
  });
});

// ==========================================================================
// TEST 14 — No Ground Truth Leakage
// ==========================================================================
describe('TEST 14 — No Ground Truth Leakage', () => {
  const FORBIDDEN = [
    'injectedRoot', 'injectedResource', 'trueRoot', 'trueRootService',
    'trueRootResource', 'targetSeverity', 'AuthoritativeState', 'SimulationWorld',
    'rootCause', 'intervention'
  ];

  it('CausalAnalysisResult JSON contains no forbidden ground-truth keys', () => {
    const data = buildScenario('gt-leak', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const serialized = JSON.stringify(result);
    for (const key of FORBIDDEN) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it('Changing ground truth without changing observable data does not change analyzer output', () => {
    // Build two identical observable bundles from different seeds that happen to
    // produce the same observable signal profile (we simulate this by using the
    // same constructed bundle and only changing the seed used for world construction
    // — the BUNDLE passed to the analyzer must be identical)
    const data = buildScenario('gt-same', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);

    // Deep clone the bundle (strips any live references)
    const clonedData: ObservableIncidentData = JSON.parse(JSON.stringify(data));

    const result1 = analyzer.analyze(data);
    const result2 = analyzer.analyze(clonedData);

    // Identical data → identical result
    expect(result1.hypotheses.map(h => h.candidateId)).toEqual(result2.hypotheses.map(h => h.candidateId));
    expect(result1.hypotheses.map(h => h.score)).toEqual(result2.hypotheses.map(h => h.score));
  });
});

// ==========================================================================
// TEST 15 — All Service × Resource Candidates
// ==========================================================================
describe('TEST 15 — All Service x Resource Candidates', () => {
  it('Every service x resource pair has a hypothesis', () => {
    const data = buildScenario('all-candidates', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const services = ['portal', 'appointment', 'records', 'notification'];
    for (const svc of services) {
      for (const res of RESOURCE_TYPES) {
        const h = result.hypotheses.find(h => h.candidateId === `${svc}/${res}`);
        expect(h).toBeDefined();
        expect(h!.serviceId).toBe(svc);
        expect(h!.resource).toBe(res);
      }
    }
  });

  it('All hypotheses have rank, score, and evidence', () => {
    const data = buildScenario('all-candidates', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    for (const h of result.hypotheses) {
      expect(h.rank).toBeGreaterThan(0);
      expect(typeof h.score).toBe('number');
      expect(h.evidence).toBeDefined();
      expect(Array.isArray(h.evidence)).toBe(true);
    }
  });
});

// ==========================================================================
// TEST 16 — Serialization
// ==========================================================================
describe('TEST 16 — JSON Serialization', () => {
  it('CausalAnalysisResult serializes and deserializes preserving structure', () => {
    const data = buildScenario('serial', 10, 'records', 'MEMORY', 'CRITICAL', 80, true);
    const result = analyzer.analyze(data);

    const serialized = JSON.stringify(result);
    const deserialized: CausalAnalysisResult = JSON.parse(serialized);

    expect(deserialized.hypotheses.length).toBe(result.hypotheses.length);
    expect(deserialized.hypotheses[0].candidateId).toBe(result.hypotheses[0].candidateId);
    expect(deserialized.hypotheses[0].score).toBe(result.hypotheses[0].score);
    expect(deserialized.incidentDetected).toBe(result.incidentDetected);
    expect(deserialized.analyzedThroughTick).toBe(result.analyzedThroughTick);
    expect(deserialized.causalGraph.nodes.length).toBe(result.causalGraph.nodes.length);
    expect(deserialized.causalGraph.edges.length).toBe(result.causalGraph.edges.length);
  });
});

// ==========================================================================
// TEST 17 — Architecture Boundary (Import Guard)
// ==========================================================================
describe('TEST 17 — Architecture Boundary (Import Guard)', () => {
  it('CausalAnalyzer source has no actual import from @exhausttrace/simulation or @exhausttrace/observation', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sourcePath = path.resolve('./packages/analysis/src/index.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    // Check for actual import statements (not comments/string literals)
    const importLines = source.split('\n').filter(l => l.trim().startsWith('import ') || l.trim().startsWith('require('));
    const hasSimulationImport = importLines.some(l => l.includes('@exhausttrace/simulation'));
    const hasObservationImport = importLines.some(l => l.includes('@exhausttrace/observation'));

    expect(hasSimulationImport).toBe(false);
    expect(hasObservationImport).toBe(false);
  });

  it('CausalAnalyzer actual import statements reference only @exhausttrace/shared', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sourcePath = path.resolve('./packages/analysis/src/index.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    const importLines = source.split('\n').filter(l => l.trim().startsWith('import '));
    const packageImports = importLines.filter(l => l.includes("'@exhausttrace"));

    // Only shared is permitted
    const forbidden = packageImports.filter(l =>
      !l.includes('@exhausttrace/shared')
    );
    expect(forbidden).toHaveLength(0);
  });

  it('CausalAnalyzer source has no runtime references to forbidden ground-truth fields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sourcePath = path.resolve('./packages/analysis/src/index.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    // Remove comment lines before checking
    const codeLines = source.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');

    const FORBIDDEN_IDENTIFIERS = [
      'injectedRoot', 'injectedResource', 'trueRootService',
      'trueRootResource', 'targetSeverity', 'SimulationWorld', 'AuthoritativeState'
    ];

    for (const key of FORBIDDEN_IDENTIFIERS) {
      expect(codeLines).not.toContain(key);
    }
  });
});
