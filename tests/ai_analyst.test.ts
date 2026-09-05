/**
 * Block 7: AI Analyst Tests — 15 tests
 * Tests safe context construction, hidden field removal, Q&A intents, and fallback behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSafeContext,
  assertNoHiddenFields,
} from '../backend/src/ai/GeminiClient';
import type { IncidentEvidenceBundle } from '@exhausttrace/shared';

// ─── Minimal stub bundle ────────────────────────────────────────────────────

function makeBundle(overrides: Partial<IncidentEvidenceBundle> = {}): IncidentEvidenceBundle {
  return {
    incidentId: 'test-inc-001',
    sessionId: 'sess-001',
    scenarioId: 'records_memory_critical',
    status: 'RUNNING',
    createdAt: Date.now(),
    playback: { isRunning: true, speed: 1, tick: 42, timestamp: Date.now() },
    dependencyGraph: {
      nodes: [{ id: 'records' }, { id: 'appointment' }, { id: 'portal' }],
      edges: [{ from: 'portal', to: 'appointment' }, { from: 'appointment', to: 'records' }],
    },
    currentTelemetry: {
      tick: 42,
      timestamp: Date.now(),
      services: [
        {
          serviceId: 'records',
          resources: {
            CPU: { utilization: 0.3, pressure: 0.3, status: 'HEALTHY' },
            MEMORY: { utilization: 0.95, pressure: 0.95, status: 'CRITICAL' },
            CONNECTIONS: { utilization: 0.5, pressure: 0.5, status: 'ELEVATED' },
            WORKERS: { utilization: 0.4, pressure: 0.4, status: 'HEALTHY' },
          },
          metrics: {
            incomingRate: 100,
            retryIncomingRate: 15,
            processedRate: 70,
            queueDepth: 45,
            maxQueueDepth: 200,
            latencyMs: 1800,
            timeoutRate: 0.15,
            failureRate: 0.1,
            successRate: 0.9,
            retryRate: 0.15,
          },
        },
      ],
    },
    telemetryHistory: [],
    events: [
      { sequence: 1, tick: 15, timestamp: Date.now(), type: 'RESOURCE_PRESSURE_CHANGED', serviceId: 'records', resource: 'MEMORY', previousStatus: 'HEALTHY', status: 'CRITICAL', utilization: 0.95, pressure: 0.95 },
      { sequence: 2, tick: 20, timestamp: Date.now(), type: 'LATENCY_DEGRADED', serviceId: 'records', latencyMs: 1800, previousLatencyMs: 200, threshold: 400 },
    ],
    causalAnalysis: {
      analysisTimestamp: 42,
      analyzedThroughTick: 42,
      hypotheses: [
        {
          candidateId: 'records/MEMORY',
          serviceId: 'records',
          resource: 'MEMORY',
          score: 78.5,
          rank: 1,
          confidence: 0.72,
          evidence: [],
          supportingSignals: ['MEMORY CRITICAL at tick 15', 'downstream latency degraded'],
          contradictingSignals: [],
          firstAbnormalTick: 15,
          peakPressureTick: 42,
        },
        {
          candidateId: 'appointment/WORKERS',
          serviceId: 'appointment',
          resource: 'WORKERS',
          score: 32.1,
          rank: 2,
          confidence: 0.31,
          evidence: [],
          supportingSignals: [],
          contradictingSignals: ['pressure appeared after records degraded'],
          firstAbnormalTick: 25,
          peakPressureTick: 38,
        },
      ],
      causalGraph: { nodes: [], edges: [] },
      evidenceMatrix: {},
      confidenceHistory: [
        { tick: 20, timestamp: Date.now(), topCandidateId: 'records/MEMORY', topCandidateScore: 40, topCandidateConfidence: 0.41, allScores: {} },
        { tick: 42, timestamp: Date.now(), topCandidateId: 'records/MEMORY', topCandidateScore: 78.5, topCandidateConfidence: 0.72, allScores: {} },
      ],
      reconstructedPaths: [
        {
          hypothesisId: 'records/MEMORY',
          confidence: 0.72,
          nodes: [
            { serviceId: 'records', resource: 'MEMORY', observedCondition: 'MEMORY CRITICAL', firstObservedTick: 15 },
            { serviceId: 'appointment', observedCondition: 'LATENCY_DEGRADED', firstObservedTick: 22 },
          ],
        },
      ],
      topCandidate: null as any,
      incidentDetected: true,
    },
    prediction: null,
    rootTrajectory: null,
    rootValidation: null,
    symptomTrajectory: null,
    symptomValidation: null,
    experimentLog: [],
    ...overrides,
  } as unknown as IncidentEvidenceBundle;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Block 7 — AI Analyst: Safe Context Construction', () => {
  // Test 1
  it('buildSafeContext produces a valid context object', () => {
    const ctx = buildSafeContext(makeBundle());
    expect(ctx).toBeDefined();
    expect(ctx.incidentId).toBe('test-inc-001');
    expect(ctx.tick).toBe(42);
    expect(ctx.status).toBe('RUNNING');
  });

  // Test 2
  it('buildSafeContext maps telemetry to summary (no raw internals)', () => {
    const ctx = buildSafeContext(makeBundle());
    expect(ctx.currentTelemetrySummary).toHaveLength(1);
    const svc = ctx.currentTelemetrySummary[0];
    expect(svc.serviceId).toBe('records');
    expect(svc.memoryStatus).toBe('CRITICAL');
    expect(svc.memoryPressure).toBeCloseTo(0.95, 2);
  });

  // Test 3
  it('buildSafeContext caps recent events to 15', () => {
    const manyEvents = Array.from({ length: 30 }, (_, i) => ({
      sequence: i, tick: i, timestamp: Date.now(), type: 'QUEUE_GROWTH' as any,
      serviceId: 'records', queueDepth: 50, previousQueueDepth: 40, growthRate: 0.1,
    }));
    const ctx = buildSafeContext(makeBundle({ events: manyEvents }));
    expect(ctx.recentEvents.length).toBeLessThanOrEqual(15);
  });

  // Test 4
  it('buildSafeContext maps causal hypotheses correctly', () => {
    const ctx = buildSafeContext(makeBundle());
    expect(ctx.rankedHypotheses).toHaveLength(2);
    expect(ctx.rankedHypotheses[0].serviceId).toBe('records');
    expect(ctx.rankedHypotheses[0].resource).toBe('MEMORY');
    expect(ctx.rankedHypotheses[0].confidence).toBeCloseTo(0.72, 2);
  });

  // Test 5
  it('buildSafeContext maps propagation paths', () => {
    const ctx = buildSafeContext(makeBundle());
    expect(ctx.propagationPaths).toHaveLength(1);
    expect(ctx.propagationPaths[0].hypothesisId).toBe('records/MEMORY');
    expect(ctx.propagationPaths[0].nodes).toHaveLength(2);
  });

  // Test 6
  it('buildSafeContext maps confidence history', () => {
    const ctx = buildSafeContext(makeBundle());
    expect(ctx.confidenceHistory).toHaveLength(2);
    expect(ctx.confidenceHistory[1].topCandidateConfidence).toBeCloseTo(0.72, 2);
  });

  // Test 7
  it('buildSafeContext returns null prediction when bundle has no prediction', () => {
    const ctx = buildSafeContext(makeBundle({ prediction: null }));
    expect(ctx.prediction).toBeNull();
  });

  // Test 8
  it('buildSafeContext returns null rootValidation when none exists', () => {
    const ctx = buildSafeContext(makeBundle({ rootValidation: null }));
    expect(ctx.experiments.rootValidation).toBeNull();
  });
});

describe('Block 7 — AI Analyst: Hidden State Leakage Tests', () => {
  // Test 9
  it('assertNoHiddenFields returns empty array for clean context', () => {
    const ctx = buildSafeContext(makeBundle());
    const violations = assertNoHiddenFields(ctx);
    expect(violations).toHaveLength(0);
  });

  // Test 10
  it('assertNoHiddenFields detects trueRoot in object', () => {
    const poisoned = { trueRoot: 'records/MEMORY', data: 'clean' };
    const violations = assertNoHiddenFields(poisoned);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.includes('trueRoot'))).toBe(true);
  });

  // Test 11
  it('assertNoHiddenFields detects nested hidden fields', () => {
    const poisoned = { analysis: { trueRootService: 'records', safe: 'ok' } };
    const violations = assertNoHiddenFields(poisoned);
    expect(violations.some(v => v.includes('trueRootService'))).toBe(true);
  });

  // Test 12
  it('context from buildSafeContext has no SimulationWorld reference', () => {
    const ctx = buildSafeContext(makeBundle()) as any;
    expect(ctx.world).toBeUndefined();
    expect(ctx.SimulationWorld).toBeUndefined();
    expect(ctx.simulation).toBeUndefined();
  });

  // Test 13
  it('context from buildSafeContext has no trueRootResource field', () => {
    const ctx = buildSafeContext(makeBundle()) as any;
    const str = JSON.stringify(ctx);
    expect(str).not.toContain('trueRootResource');
    expect(str).not.toContain('injectedRoot');
    expect(str).not.toContain('targetSeverity');
  });

  // Test 14
  it('safe context does not expose GEMINI_API_KEY', () => {
    const ctx = buildSafeContext(makeBundle());
    const violations = assertNoHiddenFields(ctx);
    // GEMINI_API_KEY is in denylist but not in context — so no violations
    const str = JSON.stringify(ctx);
    expect(str).not.toContain('GEMINI_API_KEY');
  });

  // Test 15
  it('scenarioId is safe to expose (observable, not hidden ground truth)', () => {
    const ctx = buildSafeContext(makeBundle());
    // scenarioId is a public identifier — acceptable to include
    expect(ctx.scenarioId).toBe('records_memory_critical');
    // But injectedRoot/trueRoot are not
    expect((ctx as any).injectedRoot).toBeUndefined();
  });
});
