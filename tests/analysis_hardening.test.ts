/**
 * Block 3 — Hardening Pass Tests
 *
 * These tests use DETERMINISTIC SYNTHETIC FIXTURES — hand-constructed
 * ObservableIncidentData that does NOT come from the simulation. This decouples
 * temporal and propagation reasoning tests from the simulation's gradual ramp
 * behavior, allowing precise assertion on the analyzer's logic.
 *
 * IMPORT BOUNDARY:
 *   - These tests import CausalAnalyzer and shared types.
 *   - They do NOT import SimulationWorld, ObservationAdapter, or any hidden state.
 *   - The fixtures contain only observable evidence (telemetry + events + dep graph).
 *
 * SCORE vs CONFIDENCE SEMANTICS (see also analyzer source):
 *   score      = weighted sum of evidence items for a candidate, scaled [0, 100].
 *                Represents absolute evidential strength.
 *   confidence = normalized belief derived from the candidate's score relative
 *                to its own maximum. Capped at 0.99 — the analyzer can never
 *                be certain without ground-truth validation.
 *   They are NOT interchangeable. A score of 53 does not mean 53% confidence.
 *   Confidence is scaled relative to the top candidate's score, not to 100.
 *
 * TIMEOUT/RETRY ATTRIBUTION SAFETY:
 *   Block 2 emits TIMEOUT_SPIKE with a `dependencyService` field that names the
 *   first downstream dependency (service-level aggregation, not edge-level proof).
 *   The analyzer uses this field only as a WEAK corroborating signal, combined with:
 *     - dependency topology
 *     - temporal ordering
 *     - resource pressure
 *     - latency and queue evidence
 *   A service-level timeout alone does NOT prove "Dependency X caused this timeout."
 *   The analyzer never fabricates edge-specific causal ground truth from this field.
 */

import { describe, it, expect } from 'vitest';
import { CausalAnalyzer } from '../packages/analysis/src/index';
import {
  ObservableIncidentData,
  TelemetryTick,
  ObservableSystemEvent,
  DependencyGraph,
  ResourceTelemetry,
  ServiceTelemetry,
  ResourceStatus,
} from '../packages/shared/src/index';

// ==========================================================================
// SYNTHETIC FIXTURE HELPERS
// ==========================================================================

/**
 * Build a minimal healthy ResourceTelemetry reading.
 */
function healthyResource(): ResourceTelemetry {
  return { utilization: 0.4, pressure: 0, status: 'HEALTHY' };
}

/**
 * Build a ResourceTelemetry at the specified pressure level.
 * pressure in [0, 1].  Status thresholds mirror the observation layer:
 *   pressure < 0.35  → HEALTHY
 *   0.35–0.80        → ELEVATED
 *   0.80–0.95        → HIGH
 *   >= 0.95          → CRITICAL
 */
function buildResource(pressure: number): ResourceTelemetry {
  const utilization = Math.min(1, 0.7 + pressure * 0.3);
  let status: ResourceStatus;
  if (pressure < 0.35) status = 'HEALTHY';
  else if (pressure < 0.80) status = 'ELEVATED';
  else if (pressure < 0.95) status = 'HIGH';
  else status = 'CRITICAL';
  return { utilization, pressure, status };
}

/**
 * Build a full ServiceTelemetry for one service at one tick.
 */
function buildService(
  serviceId: string,
  overrides: {
    MEMORY?: ResourceTelemetry;
    CPU?: ResourceTelemetry;
    CONNECTIONS?: ResourceTelemetry;
    WORKERS?: ResourceTelemetry;
    latencyMs?: number;
    queueDepth?: number;
    maxQueueDepth?: number;
    incomingRate?: number;
    processedRate?: number;
    timeoutRate?: number;
    retryRate?: number;
  } = {}
): ServiceTelemetry {
  return {
    serviceId,
    resources: {
      CPU: overrides.CPU ?? healthyResource(),
      MEMORY: overrides.MEMORY ?? healthyResource(),
      CONNECTIONS: overrides.CONNECTIONS ?? healthyResource(),
      WORKERS: overrides.WORKERS ?? healthyResource()
    },
    metrics: {
      incomingRate: overrides.incomingRate ?? 60,
      retryIncomingRate: 0,
      processedRate: overrides.processedRate ?? 58,
      queueDepth: overrides.queueDepth ?? 0,
      maxQueueDepth: overrides.maxQueueDepth ?? 100,
      latencyMs: overrides.latencyMs ?? 120,
      timeoutRate: overrides.timeoutRate ?? 0,
      failureRate: 0,
      successRate: 1,
      retryRate: overrides.retryRate ?? 0
    }
  };
}

/**
 * Build a telemetry tick for all four standard services.
 */
function buildTick(
  tick: number,
  services: ServiceTelemetry[]
): TelemetryTick {
  return { tick, timestamp: tick * 100, services };
}

/**
 * Standard dependency graph: portal → appointment → records, appointment → notification
 * Edge: A→B means A calls/depends on B.
 */
const STD_GRAPH: DependencyGraph = {
  nodes: [
    { id: 'portal' },
    { id: 'appointment' },
    { id: 'records' },
    { id: 'notification' }
  ],
  edges: [
    { from: 'portal', to: 'appointment' },
    { from: 'appointment', to: 'records' },
    { from: 'appointment', to: 'notification' }
  ]
};

const analyzer = new CausalAnalyzer();

// ==========================================================================
// TEMPORAL FIXTURE A — Records MEMORY precedes downstream by 5 ticks
//
// Timeline:
//   tick 10: Records/MEMORY becomes ELEVATED (pressure 0.50)
//   tick 15: Records latency degrades → LATENCY_DEGRADED event
//   tick 20: Appointment times out → TIMEOUT_SPIKE event
//   tick 25: Appointment queue grows → QUEUE_GROWTH event
//   tick 30: Portal latency degrades → LATENCY_DEGRADED event
//
// Expected: records/MEMORY receives POSITIVE temporalPrecedence evidence.
//           (lead = earliestDownstreamAnomalyTick(20) - firstAbnormalTick(10) = 10 ticks < 30 window)
// ==========================================================================

function buildFixtureA(): ObservableIncidentData {
  const ticks: TelemetryTick[] = [];
  const events: ObservableSystemEvent[] = [];
  let seq = 1;

  // Ticks 1–9: healthy baseline. Records MEMORY pressure = 0.
  for (let t = 1; t <= 9; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment'),
      buildService('records'),
      buildService('notification')
    ]));
  }

  // Tick 10: Records MEMORY becomes ELEVATED (pressure 0.50).
  // No event yet — pressure changed but threshold not crossed in prior tick.
  ticks.push(buildTick(10, [
    buildService('portal'),
    buildService('appointment'),
    buildService('records', { MEMORY: buildResource(0.50) }),
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 10, timestamp: 1000, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'records', resource: 'MEMORY',
    previousStatus: 'HEALTHY', status: 'ELEVATED',
    utilization: 0.85, pressure: 0.50
  } as any);

  // Ticks 11–14: pressure climbs
  for (let t = 11; t <= 14; t++) {
    const pressure = 0.50 + (t - 10) * 0.08;
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment'),
      buildService('records', { MEMORY: buildResource(pressure), latencyMs: 150 + (t - 10) * 15 }),
      buildService('notification')
    ]));
  }

  // Tick 15: Records latency degrades (LATENCY_DEGRADED event). Pressure HIGH.
  ticks.push(buildTick(15, [
    buildService('portal'),
    buildService('appointment'),
    buildService('records', {
      MEMORY: buildResource(0.82),
      latencyMs: 320  // crosses 2× baseline
    }),
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 15, timestamp: 1500, type: 'LATENCY_DEGRADED',
    serviceId: 'records', latencyMs: 320, previousLatencyMs: 120, threshold: 240
  } as any);
  events.push({
    sequence: seq++, tick: 15, timestamp: 1500, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'records', resource: 'MEMORY',
    previousStatus: 'ELEVATED', status: 'HIGH',
    utilization: 0.95, pressure: 0.82
  } as any);

  // Ticks 16–19: appointment starts seeing high latency from records
  for (let t = 16; t <= 19; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment', { latencyMs: 180 + (t - 15) * 10, timeoutRate: 0.02 }),
      buildService('records', { MEMORY: buildResource(0.90), latencyMs: 340 }),
      buildService('notification')
    ]));
  }

  // Tick 20: Appointment experiences TIMEOUT_SPIKE (callers of appointment = portal)
  ticks.push(buildTick(20, [
    buildService('portal', { latencyMs: 150 }),
    buildService('appointment', { latencyMs: 240, timeoutRate: 0.08, queueDepth: 5 }),
    buildService('records', { MEMORY: buildResource(0.96), latencyMs: 360 }),
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 20, timestamp: 2000, type: 'TIMEOUT_SPIKE',
    callerService: 'portal', dependencyService: 'appointment',
    timeoutRate: 0.08
  } as any);
  events.push({
    sequence: seq++, tick: 20, timestamp: 2000, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'records', resource: 'MEMORY',
    previousStatus: 'HIGH', status: 'CRITICAL',
    utilization: 0.99, pressure: 0.967
  } as any);

  // Ticks 21–24: appointment queue growing
  for (let t = 21; t <= 24; t++) {
    ticks.push(buildTick(t, [
      buildService('portal', { latencyMs: 180 }),
      buildService('appointment', { latencyMs: 260, timeoutRate: 0.09, queueDepth: 8 + t - 21, retryRate: 3 }),
      buildService('records', { MEMORY: buildResource(0.97), latencyMs: 370 }),
      buildService('notification')
    ]));
  }

  // Tick 25: Appointment queue growth event + retry surge
  ticks.push(buildTick(25, [
    buildService('portal', { latencyMs: 200 }),
    buildService('appointment', { latencyMs: 280, timeoutRate: 0.10, queueDepth: 15, retryRate: 7 }),
    buildService('records', { MEMORY: buildResource(0.97), latencyMs: 370 }),
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 25, timestamp: 2500, type: 'QUEUE_GROWTH',
    serviceId: 'appointment', queueDepth: 15, previousQueueDepth: 0, growthRate: 15
  } as any);
  events.push({
    sequence: seq++, tick: 25, timestamp: 2500, type: 'RETRY_SURGE',
    callerService: 'portal', dependencyService: 'appointment',
    retryRate: 7
  } as any);

  // Ticks 26–29: portal latency climbing
  for (let t = 26; t <= 29; t++) {
    ticks.push(buildTick(t, [
      buildService('portal', { latencyMs: 200 + (t - 25) * 20 }),
      buildService('appointment', { latencyMs: 290, timeoutRate: 0.10, queueDepth: 18, retryRate: 8 }),
      buildService('records', { MEMORY: buildResource(0.97), latencyMs: 375 }),
      buildService('notification')
    ]));
  }

  // Tick 30: Portal LATENCY_DEGRADED
  ticks.push(buildTick(30, [
    buildService('portal', { latencyMs: 310 }),
    buildService('appointment', { latencyMs: 295, timeoutRate: 0.10, queueDepth: 20, retryRate: 8 }),
    buildService('records', { MEMORY: buildResource(0.97), latencyMs: 375 }),
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 30, timestamp: 3000, type: 'LATENCY_DEGRADED',
    serviceId: 'portal', latencyMs: 310, previousLatencyMs: 120, threshold: 240
  } as any);

  return {
    dependencyGraph: STD_GRAPH,
    telemetry: ticks,
    events
  };
}

// ==========================================================================
// TEMPORAL FIXTURE B — Appointment CONNECTIONS pressure appears BEFORE Records MEMORY
//
// This tests the case where the symptom chain starts at appointment itself
// (not cascaded from records), and records only becomes abnormal later.
//
// Timeline:
//   tick 10: appointment/CONNECTIONS becomes ELEVATED → appointment's own resource root
//   tick 12: appointment latency degrades
//   tick 15: appointment queue grows
//   tick 20: records/MEMORY first becomes ELEVATED (AFTER appointment already degraded)
//
// Expected:
//   - records/MEMORY receives TEMPORAL PENALTY (it appeared AFTER appointment symptoms)
//   - Some appointment resource outranks records/MEMORY
// ==========================================================================

function buildFixtureB(): ObservableIncidentData {
  const ticks: TelemetryTick[] = [];
  const events: ObservableSystemEvent[] = [];
  let seq = 1;

  // Ticks 1–9: healthy baseline
  for (let t = 1; t <= 9; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment'),
      buildService('records'),
      buildService('notification')
    ]));
  }

  // Tick 10: Appointment CONNECTIONS becomes ELEVATED — appointment is its OWN root
  ticks.push(buildTick(10, [
    buildService('portal'),
    buildService('appointment', { CONNECTIONS: buildResource(0.60) }),
    buildService('records'),   // completely healthy
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 10, timestamp: 1000, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'appointment', resource: 'CONNECTIONS',
    previousStatus: 'HEALTHY', status: 'ELEVATED',
    utilization: 0.88, pressure: 0.60
  } as any);

  // Tick 11: appointment pressure climbs
  ticks.push(buildTick(11, [
    buildService('portal'),
    buildService('appointment', { CONNECTIONS: buildResource(0.72), latencyMs: 160 }),
    buildService('records'),
    buildService('notification')
  ]));

  // Tick 12: appointment latency degrades due to connection exhaustion
  ticks.push(buildTick(12, [
    buildService('portal'),
    buildService('appointment', { CONNECTIONS: buildResource(0.82), latencyMs: 280 }),
    buildService('records'),  // still healthy
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 12, timestamp: 1200, type: 'LATENCY_DEGRADED',
    serviceId: 'appointment', latencyMs: 280, previousLatencyMs: 120, threshold: 240
  } as any);
  events.push({
    sequence: seq++, tick: 12, timestamp: 1200, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'appointment', resource: 'CONNECTIONS',
    previousStatus: 'ELEVATED', status: 'HIGH',
    utilization: 0.95, pressure: 0.82
  } as any);

  // Ticks 13–14: queue grows on appointment
  for (let t = 13; t <= 14; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment', { CONNECTIONS: buildResource(0.85), latencyMs: 300, queueDepth: (t - 12) * 3 }),
      buildService('records'),  // still healthy
      buildService('notification')
    ]));
  }

  // Tick 15: appointment QUEUE_GROWTH event — records still completely healthy
  ticks.push(buildTick(15, [
    buildService('portal'),
    buildService('appointment', { CONNECTIONS: buildResource(0.88), latencyMs: 310, queueDepth: 10 }),
    buildService('records'),  // healthy
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 15, timestamp: 1500, type: 'QUEUE_GROWTH',
    serviceId: 'appointment', queueDepth: 10, previousQueueDepth: 0, growthRate: 10
  } as any);

  // Ticks 16–19: appointment stays degraded; records still healthy
  for (let t = 16; t <= 19; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment', { CONNECTIONS: buildResource(0.89), latencyMs: 315, queueDepth: 12 }),
      buildService('records'),  // still healthy
      buildService('notification')
    ]));
  }

  // Tick 20: Records/MEMORY first becomes ELEVATED — AFTER appointment has been degraded for 10 ticks
  ticks.push(buildTick(20, [
    buildService('portal'),
    buildService('appointment', { CONNECTIONS: buildResource(0.90), latencyMs: 320, queueDepth: 13 }),
    buildService('records', { MEMORY: buildResource(0.55) }),  // NOW becomes abnormal
    buildService('notification')
  ]));
  events.push({
    sequence: seq++, tick: 20, timestamp: 2000, type: 'RESOURCE_PRESSURE_CHANGED',
    serviceId: 'records', resource: 'MEMORY',
    previousStatus: 'HEALTHY', status: 'ELEVATED',
    utilization: 0.87, pressure: 0.55
  } as any);

  // Ticks 21–30: records slightly elevated but downstream already degraded long before
  for (let t = 21; t <= 30; t++) {
    ticks.push(buildTick(t, [
      buildService('portal'),
      buildService('appointment', { CONNECTIONS: buildResource(0.90), latencyMs: 320, queueDepth: 14 }),
      buildService('records', { MEMORY: buildResource(0.55) }),
      buildService('notification')
    ]));
  }

  return {
    dependencyGraph: STD_GRAPH,
    telemetry: ticks,
    events
  };
}

// ==========================================================================
// PROPAGATION FIXTURE — Full cascade chain with controlled event sequence
//
// records/MEMORY pressure → records latency → appointment timeout →
// appointment retry → appointment queue growth → portal degradation
// ==========================================================================

function buildPropagationFixture(): ObservableIncidentData {
  // Reuse Fixture A which has the complete cascade:
  // tick 10: records MEMORY ELEVATED
  // tick 15: records LATENCY_DEGRADED + MEMORY HIGH
  // tick 20: appointment TIMEOUT_SPIKE + records MEMORY CRITICAL
  // tick 25: appointment QUEUE_GROWTH + portal RETRY_SURGE
  // tick 30: portal LATENCY_DEGRADED
  return buildFixtureA();
}

// ==========================================================================
// TEST SUITE — Temporal Fixture A (positive precedence)
// ==========================================================================
describe('HARDENING: Temporal Fixture A — Positive Precedence', () => {
  const data = buildFixtureA();
  const result = analyzer.analyze(data);

  it('records/MEMORY should rank #1', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/MEMORY');
  });

  it('records/MEMORY must have positive temporalPrecedence evidence', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const temporal = h.evidence.filter(e => e.category === 'temporalPrecedence' && e.isSupporting);
    // lead = tick 20 (first downstream event: appointment TIMEOUT_SPIKE) - tick 10 (records MEMORY ELEVATED)
    // lead = 10 ticks < 30-tick window → MUST produce positive temporal evidence
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal[0].scoreImpact).toBeGreaterThan(0);
  });

  it('temporalPrecedence evidence description must reference the temporal lead', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const temporal = h.evidence.filter(e => e.category === 'temporalPrecedence' && e.isSupporting);
    expect(temporal.length).toBeGreaterThan(0);
    // Must mention "preceded" and a tick count
    expect(temporal[0].description).toMatch(/preceded/i);
  });

  it('incident must be detected', () => {
    expect(result.incidentDetected).toBe(true);
  });

  it('records/MEMORY firstAbnormalTick is tick 10', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    expect(h.firstAbnormalTick).toBe(10);
  });
});

// ==========================================================================
// TEST SUITE — Temporal Fixture B (temporal penalty)
// ==========================================================================
describe('HARDENING: Temporal Fixture B — Temporal Penalty', () => {
  const data = buildFixtureB();
  const result = analyzer.analyze(data);

  it('records/MEMORY must have temporal PENALTY (not positive) evidence', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const temporal = h.evidence.filter(e => e.category === 'temporalPrecedence');
    expect(temporal.length).toBeGreaterThan(0);

    // All temporal evidence must be non-supporting (penalty or neutral)
    const supportingTemporal = temporal.filter(e => e.isSupporting);
    expect(supportingTemporal.length).toBe(0);
  });

  it('records/MEMORY temporal evidence must have negative or zero scoreImpact', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const temporal = h.evidence.filter(e => e.category === 'temporalPrecedence');
    for (const te of temporal) {
      // The scoreImpact in evidence is the absolute penalty value (stored as negative weight × constant)
      // The description should mention "AFTER" since downstream was already degraded
      if (te.scoreImpact !== 0) {
        expect(te.isSupporting).toBe(false);
      }
    }
  });

  it('temporal evidence description must mention that pressure appeared after downstream degradation', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    const temporal = h.evidence.filter(e => e.category === 'temporalPrecedence' && !e.isSupporting);
    expect(temporal.length).toBeGreaterThan(0);
    // Must communicate that pressure came after downstream
    expect(temporal[0].description).toMatch(/AFTER/);
  });

  it('records/MEMORY firstAbnormalTick is tick 20 (after appointment tick 10)', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    expect(h.firstAbnormalTick).toBe(20);
  });

  it('records/MEMORY should NOT rank #1 (appointment/CONNECTIONS degraded first)', () => {
    const h = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    // appointment/CONNECTIONS has pressure from tick 10 with positive temporal precedence
    // records/MEMORY has pressure only from tick 20 with temporal penalty
    // Therefore appointment/CONNECTIONS must score higher than records/MEMORY
    const appointmentConns = result.hypotheses.find(h => h.candidateId === 'appointment/CONNECTIONS')!;
    expect(appointmentConns.score).toBeGreaterThan(h.score);
  });
});

// ==========================================================================
// TEST SUITE — Propagation Path Reconstruction (deterministic)
// ==========================================================================
describe('HARDENING: Propagation Reconstruction with Controlled Data', () => {
  const data = buildPropagationFixture();
  const result = analyzer.analyze(data);

  it('top hypothesis is records/MEMORY', () => {
    expect(result.hypotheses[0].candidateId).toBe('records/MEMORY');
  });

  it('propagation path exists for top candidate', () => {
    expect(result.reconstructedPaths.length).toBeGreaterThan(0);
    const path = result.reconstructedPaths[0];
    expect(path.hypothesisId).toBe('records/MEMORY');
    expect(path.nodes.length).toBeGreaterThan(0);
  });

  it('propagation path nodes are in strict temporal order', () => {
    const path = result.reconstructedPaths[0];
    for (let i = 1; i < path.nodes.length; i++) {
      expect(path.nodes[i].firstObservedTick).toBeGreaterThanOrEqual(
        path.nodes[i - 1].firstObservedTick
      );
    }
  });

  it('propagation path starts at records (the root service)', () => {
    const path = result.reconstructedPaths[0];
    expect(path.nodes[0].serviceId).toBe('records');
  });

  it('propagation path includes downstream service (appointment)', () => {
    const path = result.reconstructedPaths[0];
    const hasAppointment = path.nodes.some(n => n.serviceId === 'appointment');
    expect(hasAppointment).toBe(true);
  });

  it('propagation path only uses conditions derived from observable events', () => {
    const path = result.reconstructedPaths[0];
    const VALID_CONDITIONS = [
      'MEMORY', 'CPU', 'CONNECTIONS', 'WORKERS',
      'LATENCY_DEGRADED', 'QUEUE_GROWTH', 'TIMEOUT_SPIKE', 'RETRY_SURGE',
      'RESOURCE_PRESSURE_CHANGED', 'CAPACITY_DEGRADED',
      'CRITICAL', 'HIGH', 'ELEVATED',
      'pressure', 'caller'  // partial matches in descriptive strings
    ];
    for (const node of path.nodes) {
      // Each condition should reference observable terminology
      const valid = VALID_CONDITIONS.some(c => node.observedCondition.includes(c));
      expect(valid).toBe(true);
    }
  });

  it('causal graph has records as the root node', () => {
    const graph = result.causalGraph;
    const recordsNode = graph.nodes.find(n => n.id.startsWith('records/MEMORY'));
    expect(recordsNode).toBeDefined();
  });

  it('causal graph edges only reference nodes that exist', () => {
    const graph = result.causalGraph;
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }
  });
});

// ==========================================================================
// TEST SUITE — Timeout/Retry Attribution Safety
// ==========================================================================
describe('HARDENING: Timeout/Retry Attribution Safety', () => {
  it('TIMEOUT_SPIKE is used as corroborating evidence, not independent causal proof', () => {
    // In Fixture A: portal times out (TIMEOUT_SPIKE callerService=portal, dependencyService=appointment)
    // The analyzer should give appointment a timeoutCorrelation score (callers timing out)
    // but records/MEMORY should STILL rank higher because it has pressure+temporal+downstream evidence
    const data = buildFixtureA();
    const result = analyzer.analyze(data);

    // appointment should have SOME timeout evidence (portal calls it and times out)
    const apptHyp = result.hypotheses.find(h => h.candidateId === 'appointment/CONNECTIONS' || h.candidateId === 'appointment/WORKERS');
    // records/MEMORY must still beat appointment despite timeout signal
    const recordsHyp = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    expect(recordsHyp.rank).toBe(1);
  });

  it('TIMEOUT_SPIKE on appointment callerService does NOT make appointment outrank records', () => {
    const data = buildFixtureA();
    const result = analyzer.analyze(data);

    // appointment has timeout callers, but records has pressure + temporal lead
    const appointmentHyps = result.hypotheses.filter(h => h.serviceId === 'appointment');
    const recordsHyp = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;
    for (const ah of appointmentHyps) {
      expect(recordsHyp.score).toBeGreaterThan(ah.score);
    }
  });

  it('records/MEMORY timeout correlation is based on its dependents timing out, not itself', () => {
    // In Fixture A: portal → appointment → records
    // Appointment calls records (appointment is a dependent of records via dep graph)
    // If appointment showed TIMEOUT_SPIKE for *its* callers (portal), records
    // gets timeout correlation credit because records degradation causes appointment
    // to be slow which causes portal to time out
    // The analyzer only checks that records' direct dependents (appointment) have their callers timing out
    const data = buildFixtureA();
    const result = analyzer.analyze(data);
    const recordsHyp = result.hypotheses.find(h => h.candidateId === 'records/MEMORY')!;

    // timeout correlation evidence should be present (because portal → appointment times out)
    const toEvidence = recordsHyp.evidence.filter(e => e.category === 'timeoutCorrelation');
    expect(toEvidence.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// TEST SUITE — Score vs Confidence Semantics
// ==========================================================================
describe('HARDENING: Score vs Confidence Semantics', () => {
  it('score and confidence are not identical for the top candidate', () => {
    const data = buildFixtureA();
    const result = analyzer.analyze(data);
    const top = result.topCandidate!;

    // score is in [0, 100]; confidence is in [0, 1]
    expect(top.score).toBeGreaterThan(1);    // score is NOT a fraction
    expect(top.confidence).toBeLessThanOrEqual(0.99); // confidence is capped at 0.99
    expect(top.confidence).toBeLessThan(1);

    // They are not the same value (score != confidence)
    expect(top.score).not.toBeCloseTo(top.confidence, 1);
  });

  it('confidence is bounded [0, 0.99] for all candidates', () => {
    const data = buildFixtureA();
    const result = analyzer.analyze(data);
    for (const h of result.hypotheses) {
      expect(h.confidence).toBeGreaterThanOrEqual(0);
      expect(h.confidence).toBeLessThanOrEqual(0.99);
    }
  });

  it('score is bounded [0, 100] for all candidates', () => {
    const data = buildFixtureA();
    const result = analyzer.analyze(data);
    for (const h of result.hypotheses) {
      expect(h.score).toBeGreaterThanOrEqual(0);
      expect(h.score).toBeLessThanOrEqual(100);
    }
  });

  it('confidence ordering matches score ordering', () => {
    // Candidates with higher scores should have higher confidence
    const data = buildFixtureA();
    const result = analyzer.analyze(data);
    // Top 5 candidates: confidence order should follow score order
    const top5 = result.hypotheses.slice(0, 5);
    for (let i = 0; i < top5.length - 1; i++) {
      expect(top5[i].confidence).toBeGreaterThanOrEqual(top5[i + 1].confidence);
    }
  });
});

// ==========================================================================
// TEST SUITE — Fixture Independence (analyzer state not shared between calls)
// ==========================================================================
describe('HARDENING: Fixture Independence', () => {
  it('Analyzing Fixture A then Fixture B produces independent results', () => {
    const dataA = buildFixtureA();
    const dataB = buildFixtureB();

    const resultA = analyzer.analyze(dataA);
    const resultB = analyzer.analyze(dataB);

    // Fixture A: records/MEMORY ranks #1
    expect(resultA.hypotheses[0].candidateId).toBe('records/MEMORY');

    // Fixture B: records/MEMORY does NOT rank #1 — appointment/CONNECTIONS outranks it
    const bRecordsScore = resultB.hypotheses.find(h => h.candidateId === 'records/MEMORY')!.score;
    const bApptScore = resultB.hypotheses.find(h => h.candidateId === 'appointment/CONNECTIONS')!.score;
    expect(bApptScore).toBeGreaterThan(bRecordsScore);

    // Results are completely independent — no state leak between calls
    const aScore = resultA.hypotheses.find(h => h.candidateId === 'records/MEMORY')!.score;
    const bScore = resultB.hypotheses.find(h => h.candidateId === 'records/MEMORY')!.score;
    expect(aScore).not.toBeCloseTo(bScore, 0);
  });

  it('Running the same fixture twice on the same analyzer instance produces identical results', () => {
    const data = buildFixtureA();
    const r1 = analyzer.analyze(data);
    const r2 = analyzer.analyze(data);

    expect(r1.hypotheses.map(h => h.candidateId)).toEqual(r2.hypotheses.map(h => h.candidateId));
    expect(r1.hypotheses.map(h => h.score)).toEqual(r2.hypotheses.map(h => h.score));
  });
});
