/**
 * ExhaustTrace — Block 3: Causal Analysis Engine
 *
 * ARCHITECTURE RULE:
 *   This package imports ONLY from @exhausttrace/shared.
 *   It MUST NOT import from @exhausttrace/simulation or @exhausttrace/observation.
 *   It receives only ObservableIncidentData and derives all conclusions from
 *   observable telemetry and events.
 *
 * DEPENDENCY → CAUSAL GRAPH SEMANTICS:
 *   Dependency graph: A→B means A calls/depends on B.
 *   Causal graph:     A→B means observable condition A contributes to condition B.
 */

import {
  ObservableIncidentData,
  CausalAnalysisResult,
  CausalHypothesis,
  EvidenceItem,
  CausalNode,
  CausalEdge,
  ReconstructedCausalGraph,
  PropagationPath,
  PropagationPathNode,
  ConfidenceSnapshot,
  TelemetryTick,
  ServiceTelemetry,
  ObservableSystemEvent,
  DependencyGraph,
  ResourceType,
  ResourceStatus,
  RESOURCE_TYPES
} from '@exhausttrace/shared';

// ==========================================================================
// ANALYZER CONFIGURATION
// All thresholds and weights are centralized here, no magic numbers scattered.
// ==========================================================================

interface AnalyzerConfig {
  // Pressure thresholds matching the observation layer's mapResourceStatus
  pressureThresholds: { ELEVATED: number; HIGH: number; CRITICAL: number };

  // Temporal reasoning: how many ticks is "precedence" window
  temporalPrecedenceWindow: number;    // ticks; a candidate must precede downstream by at most this many ticks

  // Scoring weights (must sum to ~1 for interpretability, but not required)
  weights: {
    resourcePressure: number;          // raw resource pressure magnitude
    temporalPrecedence: number;        // precedes downstream symptoms
    downstreamPropagation: number;     // downstream services degrade after this
    queueGrowth: number;               // queue grows on this service
    latencyCorrelation: number;        // latency degrades after pressure
    timeoutCorrelation: number;        // callers time out after this degrades
    retryCorrelation: number;          // callers retry after this degrades
    recoveryCorrelation: number;       // this recovers when cascade clears
    dependencyConsistency: number;     // consistent with dep graph topology
    noisePenalty: number;              // penalize unconnected noise
    competingHypothesisPenalty: number;
  };

  // Confidence evolution: how many evenly-spaced snapshots to compute
  confidenceSnapshots: number;

  // Incident detection: minimum score to consider an incident "detected"
  incidentThreshold: number;

  // Latency: a service's latency is "degraded" if above this multiple of baseline
  latencyDegradationMultiplier: number;

  // Recovery: candidate gets recovery credit if it improves after peak
  recoveryImprovementThreshold: number;   // fraction of peak pressure that indicates recovery

  // Propagation confidence discount per hop
  propagationHopDiscount: number;
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  pressureThresholds: { ELEVATED: 0.35, HIGH: 0.80, CRITICAL: 0.95 },
  temporalPrecedenceWindow: 30,     // ticks
  weights: {
    resourcePressure: 0.20,
    temporalPrecedence: 0.18,
    downstreamPropagation: 0.16,
    queueGrowth: 0.08,
    latencyCorrelation: 0.08,
    timeoutCorrelation: 0.10,
    retryCorrelation: 0.07,
    recoveryCorrelation: 0.05,
    dependencyConsistency: 0.05,
    noisePenalty: -0.05,
    competingHypothesisPenalty: -0.02
  },
  confidenceSnapshots: 10,
  incidentThreshold: 20,
  latencyDegradationMultiplier: 1.5,
  recoveryImprovementThreshold: 0.5,
  propagationHopDiscount: 0.15
};

// ==========================================================================
// SCORE vs CONFIDENCE SEMANTICS
//
// score:
//   A weighted sum of evidence items for a candidate, scaled to [0, 100].
//   Represents ABSOLUTE evidential strength.
//   A score of 53 means the observable evidence contributes 53 evidence-points
//   in total for this candidate as the root cause.
//   Scores are NOT percentages. Two candidates can both score 53 in different
//   incidents with completely different evidence profiles.
//
// confidence:
//   A normalized belief in [0, 0.99] derived from the candidate’s score
//   relative to its own maximum possible score.
//   Represents RELATIVE belief in this candidate given the observed evidence.
//   Capped at 0.99 — the analyzer can never be fully certain without
//   ground-truth validation (which happens only in the validation stage).
//   score and confidence are NOT interchangeable; a score of 53 does NOT
//   imply 53% confidence.
//
// ==========================================================================

// ==========================================================================
// TIMEOUT/RETRY ATTRIBUTION SAFETY
//
// Block 2 emits TIMEOUT_SPIKE with a `dependencyService` field that names the
// first downstream dependency (service-level aggregation, not edge-level proof).
// This is a known Block 2 limitation documented in the Block 2 report.
//
// The analyzer uses this field ONLY as a weak corroborating signal, combined
// with: dependency topology, temporal ordering, resource pressure, latency,
// and queue evidence.
//
// A service-level timeout signal alone does NOT prove:
//   “Dependency X caused this timeout.”
//
// The analyzer checks:
//   “Callers of service S experienced timeouts AFTER S’s resource pressure
//    appeared — consistent with S being the root.”
//
// No edge-specific causal ground truth is fabricated from TIMEOUT_SPIKE alone.
// ==========================================================================

// ==========================================================================
// INTERNAL WORKING TYPES
// ==========================================================================

interface CandidateId {
  serviceId: string;
  resource: ResourceType;
  id: string;  // e.g. "records/MEMORY"
}

interface ServiceProfile {
  serviceId: string;
  /** Tick when any resource first crossed ELEVATED threshold, or Infinity */
  firstAbnormalTick: number;
  /** Tick of maximum aggregate pressure across all resources */
  peakPressureTick: number;
  /** Maximum pressure observed for this service (any resource) */
  maxPressure: number;
  /** Whether the service has callers (is a dependency of someone) */
  hasDependents: boolean;
  /** Services this one depends on */
  dependencies: string[];
  /** Services that depend on this one */
  dependents: string[];
  /** Baseline latency (median of first 5 ticks) */
  baselineLatency: number;
  /** First tick latency crosses degradation threshold */
  firstLatencyDegradedTick: number;
  /** First tick queue depth > 0 */
  firstQueueGrowthTick: number;
}

interface ResourceProfile {
  candidateId: string;
  serviceId: string;
  resource: ResourceType;
  firstAbnormalTick: number;
  peakPressureTick: number;
  peakPressure: number;
  peakStatus: ResourceStatus;
  pressureAtTick: Map<number, number>;
  statusAtTick: Map<number, ResourceStatus>;
  recovered: boolean;
  recoveryTick: number | null;
}

// ==========================================================================
// CAUSAL ANALYZER
// ==========================================================================

export class CausalAnalyzer {
  private config: AnalyzerConfig;

  constructor(config: Partial<AnalyzerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      weights: { ...DEFAULT_CONFIG.weights, ...(config.weights || {}) },
      pressureThresholds: { ...DEFAULT_CONFIG.pressureThresholds, ...(config.pressureThresholds || {}) },
      ...config
    };
  }

  /**
   * Analyze an ObservableIncidentData bundle and produce a CausalAnalysisResult.
   * This method is deterministic: same input → same output.
   *
   * No hidden ground truth is accessed. All conclusions derive from telemetry and events.
   */
  public analyze(data: ObservableIncidentData): CausalAnalysisResult {
    const { dependencyGraph, telemetry, events } = data;

    if (telemetry.length === 0) {
      return this.emptyResult(0);
    }

    const lastTick = telemetry[telemetry.length - 1].tick;
    const lastTimestamp = telemetry[telemetry.length - 1].timestamp;

    // 1. Build service topology
    const topology = this.buildTopology(dependencyGraph);

    // 2. Build per-service and per-resource profiles from telemetry
    const { serviceProfiles, resourceProfiles } = this.buildProfiles(telemetry, topology, dependencyGraph);

    // 3. Enumerate ALL service × resource candidates
    const candidates = this.enumerateCandidates(serviceProfiles);

    // 4. Score each candidate
    const hypotheses = candidates.map(cid =>
      this.scoreCandidateFull(cid, data, serviceProfiles, resourceProfiles, topology)
    );

    // 5. Rank and normalize confidence
    hypotheses.sort((a, b) => b.score - a.score);
    hypotheses.forEach((h, i) => { h.rank = i + 1; });
    this.normalizeConfidence(hypotheses);

    // 6. Detect incident
    const incidentDetected = hypotheses.length > 0 && hypotheses[0].score >= this.config.incidentThreshold;

    // 7. Build evidence matrix
    const evidenceMatrix: Record<string, EvidenceItem[]> = {};
    for (const h of hypotheses) {
      evidenceMatrix[h.candidateId] = h.evidence;
    }

    // 8. Build confidence history over time
    const confidenceHistory = this.buildConfidenceHistory(
      data, serviceProfiles, resourceProfiles, topology, candidates, lastTick
    );

    // 9. Reconstruct causal graph for top hypothesis
    const topCandidate = hypotheses[0] ?? null;
    const causalGraph = topCandidate
      ? this.buildCausalGraph(topCandidate, data, serviceProfiles, topology)
      : { nodes: [], edges: [] };

    // 10. Reconstruct propagation paths for top 3 candidates
    const reconstructedPaths = hypotheses
      .slice(0, 3)
      .map(h => this.reconstructPropagationPath(h, data, serviceProfiles, topology));

    return {
      analysisTimestamp: lastTick,
      analyzedThroughTick: lastTick,
      hypotheses,
      causalGraph,
      evidenceMatrix,
      confidenceHistory,
      reconstructedPaths,
      topCandidate,
      incidentDetected
    };
  }

  // =========================================================================
  // TOPOLOGY
  // =========================================================================

  private buildTopology(graph: DependencyGraph): Map<string, { deps: string[]; dependents: string[] }> {
    const map = new Map<string, { deps: string[]; dependents: string[] }>();

    for (const n of graph.nodes) {
      map.set(n.id, { deps: [], dependents: [] });
    }
    for (const e of graph.edges) {
      // e.from depends on e.to (from → to means from calls to)
      const from = map.get(e.from);
      const to = map.get(e.to);
      if (from) from.deps.push(e.to);
      if (to) to.dependents.push(e.from);
    }
    return map;
  }

  /**
   * Returns true if serviceA can propagate failure to serviceB through the dependency graph.
   * Propagation direction: failure at a dependency propagates to dependents.
   * I.e., if Records fails, Appointment (which depends on Records) is affected.
   */
  private canPropagateTo(from: string, to: string, topology: Map<string, { deps: string[]; dependents: string[] }>): boolean {
    // BFS: from → its dependents (services that call from)
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === to) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const entry = topology.get(cur);
      if (entry) {
        for (const dep of entry.dependents) queue.push(dep);
      }
    }
    return false;
  }

  // =========================================================================
  // PROFILE BUILDING
  // =========================================================================

  private buildProfiles(
    telemetry: TelemetryTick[],
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    graph: DependencyGraph
  ): { serviceProfiles: Map<string, ServiceProfile>; resourceProfiles: Map<string, ResourceProfile> } {
    const serviceProfiles = new Map<string, ServiceProfile>();
    const resourceProfiles = new Map<string, ResourceProfile>();

    const serviceIds = new Set<string>(telemetry.flatMap(t => t.services.map(s => s.serviceId)));

    // Initialize
    for (const sid of serviceIds) {
      const topo = topology.get(sid) || { deps: [], dependents: [] };
      serviceProfiles.set(sid, {
        serviceId: sid,
        firstAbnormalTick: Infinity,
        peakPressureTick: 0,
        maxPressure: 0,
        hasDependents: topo.dependents.length > 0,
        dependencies: topo.deps,
        dependents: topo.dependents,
        baselineLatency: 0,
        firstLatencyDegradedTick: Infinity,
        firstQueueGrowthTick: Infinity
      });

      for (const res of RESOURCE_TYPES) {
        const cid = `${sid}/${res}`;
        resourceProfiles.set(cid, {
          candidateId: cid,
          serviceId: sid,
          resource: res,
          firstAbnormalTick: Infinity,
          peakPressureTick: 0,
          peakPressure: 0,
          peakStatus: 'HEALTHY',
          pressureAtTick: new Map(),
          statusAtTick: new Map(),
          recovered: false,
          recoveryTick: null
        });
      }
    }

    // Compute baseline latency from first 5 ticks
    const baselineLatencyAccum = new Map<string, number[]>();
    for (let i = 0; i < Math.min(5, telemetry.length); i++) {
      for (const svc of telemetry[i].services) {
        const arr = baselineLatencyAccum.get(svc.serviceId) || [];
        arr.push(svc.metrics.latencyMs);
        baselineLatencyAccum.set(svc.serviceId, arr);
      }
    }
    for (const [sid, lats] of baselineLatencyAccum) {
      const sp = serviceProfiles.get(sid);
      if (sp) sp.baselineLatency = lats.reduce((a, b) => a + b, 0) / lats.length;
    }

    // Scan all ticks
    for (const tick of telemetry) {
      for (const svc of tick.services) {
        const sid = svc.serviceId;
        const sp = serviceProfiles.get(sid)!;

        // Service-level latency degradation
        const latThresh = sp.baselineLatency * this.config.latencyDegradationMultiplier;
        if (svc.metrics.latencyMs > latThresh && sp.firstLatencyDegradedTick === Infinity) {
          sp.firstLatencyDegradedTick = tick.tick;
        }

        // Service-level queue growth
        if (svc.metrics.queueDepth > 0 && sp.firstQueueGrowthTick === Infinity) {
          sp.firstQueueGrowthTick = tick.tick;
        }

        // Resource profiles
        for (const res of RESOURCE_TYPES) {
          const cid = `${sid}/${res}`;
          const rp = resourceProfiles.get(cid)!;
          const rt = (svc.resources as any)[res] as { utilization: number; pressure: number; status: ResourceStatus };

          rp.pressureAtTick.set(tick.tick, rt.pressure);
          rp.statusAtTick.set(tick.tick, rt.status);

          // First abnormal (non-HEALTHY)
          if (rt.status !== 'HEALTHY' && rp.firstAbnormalTick === Infinity) {
            rp.firstAbnormalTick = tick.tick;
            if (sp.firstAbnormalTick === Infinity) sp.firstAbnormalTick = tick.tick;
          }

          // Peak pressure
          if (rt.pressure > rp.peakPressure) {
            rp.peakPressure = rt.pressure;
            rp.peakPressureTick = tick.tick;
            rp.peakStatus = rt.status;
            if (rt.pressure > sp.maxPressure) {
              sp.maxPressure = rt.pressure;
              sp.peakPressureTick = tick.tick;
            }
          }

          // Recovery: pressure dropped below ELEVATED after having been HIGH+
          if (
            !rp.recovered &&
            rp.peakPressure >= this.config.pressureThresholds.HIGH &&
            rt.pressure < this.config.pressureThresholds.ELEVATED &&
            tick.tick > rp.peakPressureTick
          ) {
            rp.recovered = true;
            rp.recoveryTick = tick.tick;
          }
        }
      }
    }

    return { serviceProfiles, resourceProfiles };
  }

  // =========================================================================
  // CANDIDATE ENUMERATION
  // =========================================================================

  private enumerateCandidates(serviceProfiles: Map<string, ServiceProfile>): CandidateId[] {
    const candidates: CandidateId[] = [];
    for (const sid of serviceProfiles.keys()) {
      for (const res of RESOURCE_TYPES) {
        candidates.push({ serviceId: sid, resource: res, id: `${sid}/${res}` });
      }
    }
    return candidates;
  }

  // =========================================================================
  // SCORING ENGINE
  // =========================================================================

  /**
   * Score a single candidate as a potential root cause.
   * All evidence comes from observable data only.
   *
   * Scoring dimensions and weights:
   *   resourcePressure (0.20): How severe/sustained was the pressure?
   *   temporalPrecedence (0.18): Did this precede downstream symptoms?
   *   downstreamPropagation (0.16): Do downstream services degrade after this?
   *   queueGrowth (0.08): Does the service's queue grow alongside pressure?
   *   latencyCorrelation (0.08): Does latency degrade alongside pressure?
   *   timeoutCorrelation (0.10): Do callers time out after this degrades?
   *   retryCorrelation (0.07): Do callers retry after this degrades?
   *   recoveryCorrelation (0.05): Does the cascade clear when this recovers?
   *   dependencyConsistency (0.05): Is this consistent with dep graph topology?
   *   noisePenalty (-0.05): Penalize if disconnected from the cascade.
   *   competingHypothesisPenalty (-0.02): Penalize if a stronger candidate exists.
   */
  private scoreCandidateFull(
    cid: CandidateId,
    data: ObservableIncidentData,
    serviceProfiles: Map<string, ServiceProfile>,
    resourceProfiles: Map<string, ResourceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>
  ): CausalHypothesis {
    const evidence: EvidenceItem[] = [];
    const w = this.config.weights;
    const rp = resourceProfiles.get(cid.id)!;
    const sp = serviceProfiles.get(cid.serviceId)!;

    let rawScore = 0;

    // ---- 1. Resource Pressure ----
    const pressureScore = this.scoreResourcePressure(cid, rp, evidence, w.resourcePressure);
    rawScore += pressureScore;

    // ---- 2. Temporal Precedence ----
    const temporalScore = this.scoreTemporalPrecedence(cid, rp, sp, serviceProfiles, resourceProfiles, topology, evidence, w.temporalPrecedence);
    rawScore += temporalScore;

    // ---- 3. Downstream Propagation ----
    const propScore = this.scoreDownstreamPropagation(cid, rp, sp, serviceProfiles, resourceProfiles, topology, data, evidence, w.downstreamPropagation);
    rawScore += propScore;

    // ---- 4. Queue Growth ----
    const queueScore = this.scoreQueueGrowth(cid, sp, rp, data.events, evidence, w.queueGrowth);
    rawScore += queueScore;

    // ---- 5. Latency Correlation ----
    const latScore = this.scoreLatencyCorrelation(cid, rp, sp, data.telemetry, evidence, w.latencyCorrelation);
    rawScore += latScore;

    // ---- 6. Timeout Correlation ----
    const toScore = this.scoreTimeoutCorrelation(cid, rp, data.events, topology, evidence, w.timeoutCorrelation);
    rawScore += toScore;

    // ---- 7. Retry Correlation ----
    const retScore = this.scoreRetryCorrelation(cid, rp, data.events, topology, evidence, w.retryCorrelation);
    rawScore += retScore;

    // ---- 8. Recovery Correlation ----
    const recScore = this.scoreRecoveryCorrelation(cid, rp, sp, serviceProfiles, resourceProfiles, topology, data, evidence, w.recoveryCorrelation);
    rawScore += recScore;

    // ---- 9. Dependency Consistency ----
    const depScore = this.scoreDependencyConsistency(cid, sp, topology, serviceProfiles, evidence, w.dependencyConsistency);
    rawScore += depScore;

    // ---- 10. Noise Penalty ----
    const noiseScore = this.scoreNoisePenalty(cid, rp, sp, serviceProfiles, topology, evidence, w.noisePenalty);
    rawScore += noiseScore;

    // Clamp to [0, 100]
    const score = Math.max(0, Math.min(100, rawScore * 100));

    const supportingSignals = evidence.filter(e => e.isSupporting).map(e => e.description);
    const contradictingSignals = evidence.filter(e => !e.isSupporting).map(e => e.description);

    return {
      candidateId: cid.id,
      serviceId: cid.serviceId,
      resource: cid.resource,
      score,
      rank: 0,  // assigned after sorting
      confidence: 0,  // assigned after normalization
      evidence,
      supportingSignals,
      contradictingSignals,
      firstAbnormalTick: rp.firstAbnormalTick === Infinity ? null : rp.firstAbnormalTick,
      peakPressureTick: rp.peakPressureTick > 0 ? rp.peakPressureTick : null
    };
  }

  // ---- Scoring sub-functions ----

  private scoreResourcePressure(
    cid: CandidateId,
    rp: ResourceProfile,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) {
      evidence.push({
        category: 'resourcePressure',
        description: `${cid.id}: No meaningful resource pressure observed (peak pressure ${(rp.peakPressure * 100).toFixed(1)}%)`,
        isSupporting: false,
        scoreImpact: 0
      });
      return 0;
    }

    // Score proportional to peak pressure above ELEVATED threshold
    const normalized = Math.min(1.0,
      (rp.peakPressure - this.config.pressureThresholds.ELEVATED) /
      (1.0 - this.config.pressureThresholds.ELEVATED)
    );
    const scoreContrib = normalized * weight;

    evidence.push({
      category: 'resourcePressure',
      description: `${cid.id}: Peak ${rp.resource} pressure ${(rp.peakPressure * 100).toFixed(1)}% (status: ${rp.peakStatus}) at tick ${rp.peakPressureTick}`,
      isSupporting: true,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreTemporalPrecedence(
    cid: CandidateId,
    rp: ResourceProfile,
    sp: ServiceProfile,
    serviceProfiles: Map<string, ServiceProfile>,
    resourceProfiles: Map<string, ResourceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.firstAbnormalTick === Infinity) return 0;

    // Find the earliest downstream symptom (latency, queue, timeout) across all dependents
    const topo = topology.get(cid.serviceId);
    if (!topo || topo.dependents.length === 0) {
      // No dependents — could still be root if the cascade is internal
      // Check if this service's own latency/queue followed pressure
      if (sp.firstLatencyDegradedTick > rp.firstAbnormalTick) {
        const lag = sp.firstLatencyDegradedTick - rp.firstAbnormalTick;
        evidence.push({
          category: 'temporalPrecedence',
          description: `${cid.id}: ${cid.resource} pressure preceded own latency degradation by ${lag} ticks`,
          isSupporting: lag <= this.config.temporalPrecedenceWindow,
          scoreImpact: lag <= this.config.temporalPrecedenceWindow ? weight * 50 : 0
        });
        return lag <= this.config.temporalPrecedenceWindow ? weight * 0.5 : 0;
      }
      return 0;
    }

    // Find earliest downstream anomaly tick
    let earliestDownstreamTick = Infinity;
    for (const dep of topo.dependents) {
      const depSp = serviceProfiles.get(dep);
      if (depSp) {
        earliestDownstreamTick = Math.min(earliestDownstreamTick,
          depSp.firstLatencyDegradedTick,
          depSp.firstQueueGrowthTick,
          depSp.firstAbnormalTick
        );
      }
    }

    if (earliestDownstreamTick === Infinity) {
      // No downstream degradation; candidate can't explain cascade
      evidence.push({
        category: 'temporalPrecedence',
        description: `${cid.id}: No downstream service degradation observed`,
        isSupporting: false,
        scoreImpact: -weight * 30
      });
      return -weight * 0.3;
    }

    const lead = earliestDownstreamTick - rp.firstAbnormalTick;
    if (lead > 0 && lead <= this.config.temporalPrecedenceWindow) {
      evidence.push({
        category: 'temporalPrecedence',
        description: `${cid.id}: ${cid.resource} pressure (tick ${rp.firstAbnormalTick}) preceded downstream degradation by ${lead} ticks — strong temporal lead`,
        isSupporting: true,
        scoreImpact: weight * 100
      });
      return weight;
    } else if (lead <= 0) {
      evidence.push({
        category: 'temporalPrecedence',
        description: `${cid.id}: ${cid.resource} pressure (tick ${rp.firstAbnormalTick}) appeared ${-lead} ticks AFTER downstream degradation — temporal penalty`,
        isSupporting: false,
        scoreImpact: -weight * 60
      });
      return -weight * 0.6;
    } else {
      // Large lead; pressure exists but very slowly propagated
      evidence.push({
        category: 'temporalPrecedence',
        description: `${cid.id}: ${cid.resource} pressure preceded downstream by ${lead} ticks (outside window ${this.config.temporalPrecedenceWindow})`,
        isSupporting: false,
        scoreImpact: 0
      });
      return 0;
    }
  }

  private scoreDownstreamPropagation(
    cid: CandidateId,
    rp: ResourceProfile,
    sp: ServiceProfile,
    serviceProfiles: Map<string, ServiceProfile>,
    resourceProfiles: Map<string, ResourceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    data: ObservableIncidentData,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;

    // How many downstream services (reachable via propagation) show degradation?
    const allServices = Array.from(serviceProfiles.keys());
    const reachableDownstream = allServices.filter(s =>
      s !== cid.serviceId && this.canPropagateTo(cid.serviceId, s, topology)
    );

    if (reachableDownstream.length === 0) {
      // Leaf node or no dependents in graph: can't explain cascade propagation
      const totalDegraded = allServices.filter(s => {
        const sp2 = serviceProfiles.get(s)!;
        return sp2.maxPressure > this.config.pressureThresholds.ELEVATED;
      }).length;
      if (totalDegraded > 1) {
        evidence.push({
          category: 'downstreamPropagation',
          description: `${cid.id}: No dependents in graph; cannot explain multi-service cascade (${totalDegraded} services degraded)`,
          isSupporting: false,
          scoreImpact: -weight * 50
        });
        return -weight * 0.5;
      }
      return 0;
    }

    let degradedDownstream = 0;
    for (const downstream of reachableDownstream) {
      const dsp = serviceProfiles.get(downstream)!;
      if (dsp.maxPressure > this.config.pressureThresholds.ELEVATED ||
          dsp.firstQueueGrowthTick !== Infinity ||
          dsp.firstLatencyDegradedTick !== Infinity) {
        degradedDownstream++;
      }
    }

    const coverage = degradedDownstream / reachableDownstream.length;
    const scoreContrib = coverage * weight;

    evidence.push({
      category: 'downstreamPropagation',
      description: `${cid.id}: ${degradedDownstream}/${reachableDownstream.length} reachable downstream services show degradation`,
      isSupporting: coverage > 0.3,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreQueueGrowth(
    cid: CandidateId,
    sp: ServiceProfile,
    rp: ResourceProfile,
    events: ObservableSystemEvent[],
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;

    const queueEvents = events.filter(e =>
      e.type === 'QUEUE_GROWTH' && (e as any).serviceId === cid.serviceId
    );

    if (queueEvents.length === 0) {
      evidence.push({
        category: 'queueGrowth',
        description: `${cid.id}: No queue growth events observed on this service`,
        isSupporting: false,
        scoreImpact: 0
      });
      return 0;
    }

    // Check that queue growth followed pressure
    const firstQueueTick = Math.min(...queueEvents.map(e => e.tick));
    const preceded = firstQueueTick >= rp.firstAbnormalTick;
    const scoreContrib = preceded ? weight : weight * 0.3;

    evidence.push({
      category: 'queueGrowth',
      description: `${cid.id}: Queue growth observed at tick ${firstQueueTick} (${preceded ? 'after' : 'before'} pressure at tick ${rp.firstAbnormalTick})`,
      isSupporting: preceded,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreLatencyCorrelation(
    cid: CandidateId,
    rp: ResourceProfile,
    sp: ServiceProfile,
    telemetry: TelemetryTick[],
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;
    if (sp.firstLatencyDegradedTick === Infinity) {
      evidence.push({
        category: 'latencyCorrelation',
        description: `${cid.id}: No latency degradation observed on this service`,
        isSupporting: false,
        scoreImpact: 0
      });
      return 0;
    }

    const latPrecedes = sp.firstLatencyDegradedTick >= rp.firstAbnormalTick;
    const scoreContrib = latPrecedes ? weight : weight * 0.3;

    evidence.push({
      category: 'latencyCorrelation',
      description: `${cid.id}: Latency degraded at tick ${sp.firstLatencyDegradedTick} (${latPrecedes ? 'after' : 'before'} pressure at tick ${rp.firstAbnormalTick})`,
      isSupporting: latPrecedes,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreTimeoutCorrelation(
    cid: CandidateId,
    rp: ResourceProfile,
    events: ObservableSystemEvent[],
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;

    // Find TIMEOUT_SPIKE events where the dependency service is a direct dependent of us
    // OR where the caller service is a dependent and this service is the dependency
    const topo = topology.get(cid.serviceId) || { deps: [], dependents: [] };

    const timeoutEvents = events.filter(e => {
      if (e.type !== 'TIMEOUT_SPIKE') return false;
      const te = e as any;
      // Callers of this service timing out (this service is the dependency)
      return topo.dependents.includes(te.callerService);
    });

    if (timeoutEvents.length === 0) {
      // No callers timing out after us — mild negative
      const hasAnyTimeout = events.some(e => e.type === 'TIMEOUT_SPIKE');
      if (hasAnyTimeout) {
        evidence.push({
          category: 'timeoutCorrelation',
          description: `${cid.id}: Timeout spikes exist in the system but not attributable to callers of this service`,
          isSupporting: false,
          scoreImpact: -weight * 20
        });
        return -weight * 0.2;
      }
      return 0;
    }

    const firstTimeoutTick = Math.min(...timeoutEvents.map(e => e.tick));
    const preceded = firstTimeoutTick >= rp.firstAbnormalTick;
    const scoreContrib = preceded ? weight : weight * 0.4;

    evidence.push({
      category: 'timeoutCorrelation',
      description: `${cid.id}: ${timeoutEvents.length} timeout spike(s) observed in callers of this service (first at tick ${firstTimeoutTick}, ${preceded ? 'after' : 'before'} pressure)`,
      isSupporting: preceded,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreRetryCorrelation(
    cid: CandidateId,
    rp: ResourceProfile,
    events: ObservableSystemEvent[],
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;

    const topo = topology.get(cid.serviceId) || { deps: [], dependents: [] };
    const retryEvents = events.filter(e => {
      if (e.type !== 'RETRY_SURGE') return false;
      const re = e as any;
      return topo.dependents.includes(re.callerService);
    });

    if (retryEvents.length === 0) return 0;

    const firstRetryTick = Math.min(...retryEvents.map(e => e.tick));
    const preceded = firstRetryTick >= rp.firstAbnormalTick;
    const scoreContrib = preceded ? weight : weight * 0.4;

    evidence.push({
      category: 'retryCorrelation',
      description: `${cid.id}: Retry surges observed in callers (first at tick ${firstRetryTick})`,
      isSupporting: preceded,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreRecoveryCorrelation(
    cid: CandidateId,
    rp: ResourceProfile,
    sp: ServiceProfile,
    serviceProfiles: Map<string, ServiceProfile>,
    resourceProfiles: Map<string, ResourceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    data: ObservableIncidentData,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (!rp.recovered || rp.recoveryTick === null) return 0;

    // Check if downstream services also recovered around the same time
    const topo = topology.get(cid.serviceId) || { deps: [], dependents: [] };
    let downstreamRecoveries = 0;
    let downstreamTotal = 0;

    for (const dep of topo.dependents) {
      const depSp = serviceProfiles.get(dep);
      if (!depSp || depSp.maxPressure < this.config.pressureThresholds.ELEVATED) continue;
      downstreamTotal++;

      // Check if the dependent recovered after this candidate's recovery
      for (const res of RESOURCE_TYPES) {
        const depRp = resourceProfiles.get(`${dep}/${res}`);
        if (depRp?.recovered && depRp.recoveryTick !== null && depRp.recoveryTick >= rp.recoveryTick) {
          downstreamRecoveries++;
          break;
        }
      }
    }

    if (downstreamTotal === 0) return 0;

    const coverage = downstreamRecoveries / downstreamTotal;
    const scoreContrib = coverage * weight;

    evidence.push({
      category: 'recoveryCorrelation',
      description: `${cid.id}: Recovery at tick ${rp.recoveryTick} preceded/coincided with ${downstreamRecoveries}/${downstreamTotal} downstream recoveries`,
      isSupporting: coverage > 0.5,
      scoreImpact: scoreContrib * 100
    });
    return scoreContrib;
  }

  private scoreDependencyConsistency(
    cid: CandidateId,
    sp: ServiceProfile,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    serviceProfiles: Map<string, ServiceProfile>,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    // A service with dependents that show degradation is more consistent as root
    // A service with NO dependents that shows downstream cascade is inconsistent
    const topo = topology.get(cid.serviceId) || { deps: [], dependents: [] };

    // Is this service a "leaf" (nothing depends on it)?
    const isLeaf = topo.dependents.length === 0;

    // Count degraded dependents
    const degradedDependents = topo.dependents.filter(d => {
      const dsp = serviceProfiles.get(d);
      return dsp && (dsp.maxPressure > this.config.pressureThresholds.ELEVATED || dsp.firstQueueGrowthTick !== Infinity);
    });

    // Count degraded non-dependents (services that can't propagate from this one)
    const allDegraded = Array.from(serviceProfiles.values())
      .filter(s => s.serviceId !== cid.serviceId && s.maxPressure > this.config.pressureThresholds.ELEVATED);

    if (isLeaf && allDegraded.length > 0) {
      evidence.push({
        category: 'dependencyConsistency',
        description: `${cid.id}: This service has no dependents; cannot explain cascade in other services`,
        isSupporting: false,
        scoreImpact: -weight * 80
      });
      return -weight * 0.8;
    }

    if (degradedDependents.length > 0) {
      evidence.push({
        category: 'dependencyConsistency',
        description: `${cid.id}: ${degradedDependents.length} direct dependent(s) show degradation, consistent with dep-graph propagation`,
        isSupporting: true,
        scoreImpact: weight * 100
      });
      return weight;
    }

    return 0;
  }

  private scoreNoisePenalty(
    cid: CandidateId,
    rp: ResourceProfile,
    sp: ServiceProfile,
    serviceProfiles: Map<string, ServiceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    evidence: EvidenceItem[],
    weight: number
  ): number {
    if (rp.peakPressure < this.config.pressureThresholds.ELEVATED) return 0;

    // A "noisy" candidate is one that:
    // 1. Has elevated pressure
    // 2. But no downstream services degraded
    // 3. And no corresponding queue/latency degradation
    const topo = topology.get(cid.serviceId) || { deps: [], dependents: [] };
    const reachable = Array.from(serviceProfiles.keys()).filter(s =>
      s !== cid.serviceId && this.canPropagateTo(cid.serviceId, s, topology)
    );

    const anyDownstreamDegraded = reachable.some(s => {
      const dsp = serviceProfiles.get(s)!;
      return dsp.maxPressure > this.config.pressureThresholds.ELEVATED || dsp.firstQueueGrowthTick !== Infinity;
    });

    const hasOwnQueueOrLatency = sp.firstQueueGrowthTick !== Infinity || sp.firstLatencyDegradedTick !== Infinity;

    if (!anyDownstreamDegraded && !hasOwnQueueOrLatency && reachable.length === 0) {
      // Completely isolated
      evidence.push({
        category: 'noisePenalty',
        description: `${cid.id}: Elevated pressure but no cascade, no queue growth, no latency degradation — likely noise`,
        isSupporting: false,
        scoreImpact: weight * 100  // negative weight
      });
      return weight;  // weight is negative
    }
    return 0;
  }

  // =========================================================================
  // CONFIDENCE NORMALIZATION
  // =========================================================================

  private normalizeConfidence(hypotheses: CausalHypothesis[]): void {
    if (hypotheses.length === 0) return;
    const maxScore = hypotheses[0].score;
    const totalScore = hypotheses.reduce((s, h) => s + h.score, 0);

    for (const h of hypotheses) {
      if (totalScore > 0) {
        // Softmax-like: proportional to score, but top candidate gets more weight
        h.confidence = maxScore > 0 ? (h.score / maxScore) * (h.score / (totalScore + 1e-9)) : 0;
        h.confidence = Math.max(0, Math.min(1, h.confidence));
      } else {
        h.confidence = 0;
      }
    }

    // Normalize so top candidate confidence reflects its relative dominance
    const topScore = hypotheses[0].score;
    const secondScore = hypotheses[1]?.score ?? 0;
    if (topScore > 0) {
      hypotheses[0].confidence = Math.min(0.99, topScore / 100);
    }
    for (let i = 1; i < hypotheses.length; i++) {
      hypotheses[i].confidence = Math.min(0.99, hypotheses[i].score / 100 * 0.8);
    }
  }

  // =========================================================================
  // CONFIDENCE HISTORY
  // =========================================================================

  private buildConfidenceHistory(
    data: ObservableIncidentData,
    serviceProfiles: Map<string, ServiceProfile>,
    resourceProfiles: Map<string, ResourceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>,
    candidates: CandidateId[],
    lastTick: number
  ): ConfidenceSnapshot[] {
    const snapshots: ConfidenceSnapshot[] = [];
    const n = this.config.confidenceSnapshots;

    if (data.telemetry.length < 2) return snapshots;

    const firstTick = data.telemetry[0].tick;
    const step = Math.max(1, Math.floor((lastTick - firstTick) / n));

    for (let i = 1; i <= n; i++) {
      const upToTick = firstTick + step * i;
      if (upToTick > lastTick) break;

      // Build a subset of data up to this tick
      const subTelemetry = data.telemetry.filter(t => t.tick <= upToTick);
      const subEvents = data.events.filter(e => e.tick <= upToTick);
      const subData: ObservableIncidentData = {
        dependencyGraph: data.dependencyGraph,
        telemetry: subTelemetry,
        events: subEvents
      };

      // Re-build profiles for subset (efficient: we only need up to upToTick)
      const { resourceProfiles: subRp, serviceProfiles: subSp } = this.buildProfiles(subTelemetry, topology, data.dependencyGraph);

      const allScores: Record<string, number> = {};
      let topId = '';
      let topScore = -1;

      for (const cid of candidates) {
        const h = this.scoreCandidateFull(cid, subData, subSp, subRp, topology);
        allScores[cid.id] = h.score;
        if (h.score > topScore) {
          topScore = h.score;
          topId = cid.id;
        }
      }

      const ts = subTelemetry[subTelemetry.length - 1];
      snapshots.push({
        tick: upToTick,
        timestamp: ts.timestamp,
        topCandidateId: topId,
        topCandidateScore: topScore,
        topCandidateConfidence: Math.min(0.99, topScore / 100),
        allScores
      });
    }

    return snapshots;
  }

  // =========================================================================
  // CAUSAL GRAPH RECONSTRUCTION
  // =========================================================================

  private buildCausalGraph(
    topHypothesis: CausalHypothesis,
    data: ObservableIncidentData,
    serviceProfiles: Map<string, ServiceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>
  ): ReconstructedCausalGraph {
    const nodes: CausalNode[] = [];
    const edges: CausalEdge[] = [];
    const nodeIds = new Set<string>();

    const addNode = (id: string, label: string, serviceId: string, resource?: ResourceType, eventType?: string) => {
      if (!nodeIds.has(id)) {
        nodes.push({ id, label, serviceId, resource, eventType });
        nodeIds.add(id);
      }
    };

    const addEdge = (from: string, to: string, evidence: string, confidence: number, tick: number, eventTypes: string[]) => {
      edges.push({ from, to, evidence, confidence, firstObservedTick: tick, supportingEventTypes: eventTypes });
    };

    // Build graph starting from top hypothesis
    const rootNodeId = `${topHypothesis.serviceId}/${topHypothesis.resource}/pressure`;
    addNode(rootNodeId, `${topHypothesis.serviceId} ${topHypothesis.resource} pressure`, topHypothesis.serviceId, topHypothesis.resource);

    // Add latency node if applicable
    const sp = serviceProfiles.get(topHypothesis.serviceId);
    if (sp && sp.firstLatencyDegradedTick !== Infinity) {
      const latNodeId = `${topHypothesis.serviceId}/latency`;
      addNode(latNodeId, `${topHypothesis.serviceId} latency degradation`, topHypothesis.serviceId, undefined, 'LATENCY_DEGRADED');
      addEdge(rootNodeId, latNodeId, 'Resource pressure degrades service capacity and increases latency', 0.85, sp.firstLatencyDegradedTick, ['LATENCY_DEGRADED', 'CAPACITY_DEGRADED']);
    }

    // Add capacity/queue node if applicable
    if (sp && sp.firstQueueGrowthTick !== Infinity) {
      const qNodeId = `${topHypothesis.serviceId}/queue`;
      addNode(qNodeId, `${topHypothesis.serviceId} queue growth`, topHypothesis.serviceId, undefined, 'QUEUE_GROWTH');
      const srcId = sp.firstLatencyDegradedTick !== Infinity ? `${topHypothesis.serviceId}/latency` : rootNodeId;
      addEdge(srcId, qNodeId, 'Increased latency causes work to queue faster than it drains', 0.80, sp.firstQueueGrowthTick, ['QUEUE_GROWTH']);
    }

    // Add downstream service degradation nodes
    const topo = topology.get(topHypothesis.serviceId) || { deps: [], dependents: [] };
    let prevNodeId = sp?.firstQueueGrowthTick !== Infinity
      ? `${topHypothesis.serviceId}/queue`
      : sp?.firstLatencyDegradedTick !== Infinity
        ? `${topHypothesis.serviceId}/latency`
        : rootNodeId;

    // BFS through dependents (propagation path)
    const visited = new Set<string>([topHypothesis.serviceId]);
    const queue: string[] = [topHypothesis.serviceId];
    let hopConfidence = 0.80;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curTopo = topology.get(cur) || { deps: [], dependents: [] };

      for (const dep of curTopo.dependents) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        queue.push(dep);

        const depSp = serviceProfiles.get(dep);
        if (!depSp) continue;
        hopConfidence = Math.max(0.1, hopConfidence - this.config.propagationHopDiscount);

        // Timeout/retry from this dependent toward cur
        const toEvents = data.events.filter(e =>
          e.type === 'TIMEOUT_SPIKE' && (e as any).callerService === dep
        );
        const retEvents = data.events.filter(e =>
          e.type === 'RETRY_SURGE' && (e as any).callerService === dep
        );

        if (toEvents.length > 0 || retEvents.length > 0) {
          const depToNodeId = `${dep}/timeout_retry`;
          addNode(depToNodeId, `${dep} timeout/retry pressure`, dep, undefined, 'TIMEOUT_SPIKE');
          const firstTick = Math.min(...[...toEvents, ...retEvents].map(e => e.tick));
          addEdge(prevNodeId, depToNodeId, `${cur} degradation causes ${dep} callers to timeout/retry`, hopConfidence, firstTick, ['TIMEOUT_SPIKE', 'RETRY_SURGE']);

          if (depSp.firstQueueGrowthTick !== Infinity || depSp.firstLatencyDegradedTick !== Infinity) {
            const depDegNodeId = `${dep}/degradation`;
            addNode(depDegNodeId, `${dep} degradation`, dep, undefined, 'QUEUE_GROWTH');
            const degTick = Math.min(
              depSp.firstQueueGrowthTick !== Infinity ? depSp.firstQueueGrowthTick : Infinity,
              depSp.firstLatencyDegradedTick !== Infinity ? depSp.firstLatencyDegradedTick : Infinity
            );
            addEdge(depToNodeId, depDegNodeId, 'Retry amplification increases load and degrades the dependent service', hopConfidence * 0.9, degTick, ['QUEUE_GROWTH', 'LATENCY_DEGRADED']);
            prevNodeId = depDegNodeId;
          } else {
            prevNodeId = depToNodeId;
          }
        }
      }
    }

    return { nodes, edges };
  }

  // =========================================================================
  // PROPAGATION PATH RECONSTRUCTION
  // =========================================================================

  private reconstructPropagationPath(
    hypothesis: CausalHypothesis,
    data: ObservableIncidentData,
    serviceProfiles: Map<string, ServiceProfile>,
    topology: Map<string, { deps: string[]; dependents: string[] }>
  ): PropagationPath {
    const pathNodes: PropagationPathNode[] = [];
    let confidence = hypothesis.confidence;

    // Start at root
    const rp_firstTick = hypothesis.firstAbnormalTick ?? 0;
    pathNodes.push({
      serviceId: hypothesis.serviceId,
      resource: hypothesis.resource,
      observedCondition: `${hypothesis.resource} ${hypothesis.evidence.find(e => e.category === 'resourcePressure')?.description.includes('CRITICAL') ? 'CRITICAL' : 'elevated pressure'}`,
      firstObservedTick: rp_firstTick
    });

    // Add own latency/queue if present
    const sp = serviceProfiles.get(hypothesis.serviceId);
    if (sp && sp.firstLatencyDegradedTick !== Infinity) {
      pathNodes.push({
        serviceId: hypothesis.serviceId,
        observedCondition: 'LATENCY_DEGRADED',
        firstObservedTick: sp.firstLatencyDegradedTick
      });
    }
    if (sp && sp.firstQueueGrowthTick !== Infinity) {
      pathNodes.push({
        serviceId: hypothesis.serviceId,
        observedCondition: 'QUEUE_GROWTH',
        firstObservedTick: sp.firstQueueGrowthTick
      });
    }

    // BFS downstream
    const visited = new Set<string>([hypothesis.serviceId]);
    const bfsQueue = [hypothesis.serviceId];
    confidence = Math.max(0.1, confidence - this.config.propagationHopDiscount);

    while (bfsQueue.length > 0) {
      const cur = bfsQueue.shift()!;
      const curTopo = topology.get(cur) || { deps: [], dependents: [] };

      for (const dep of curTopo.dependents) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        bfsQueue.push(dep);

        const depSp = serviceProfiles.get(dep);
        if (!depSp) continue;

        // Add timeout/retry events for this dependent
        const depToEvents = data.events.filter(e =>
          e.type === 'TIMEOUT_SPIKE' && (e as any).callerService === dep
        );
        if (depToEvents.length > 0) {
          pathNodes.push({
            serviceId: dep,
            observedCondition: `TIMEOUT_SPIKE (caller: ${dep})`,
            firstObservedTick: Math.min(...depToEvents.map(e => e.tick))
          });
        }

        if (depSp.firstQueueGrowthTick !== Infinity) {
          pathNodes.push({
            serviceId: dep,
            observedCondition: 'QUEUE_GROWTH',
            firstObservedTick: depSp.firstQueueGrowthTick
          });
        }
        if (depSp.firstLatencyDegradedTick !== Infinity) {
          pathNodes.push({
            serviceId: dep,
            observedCondition: 'LATENCY_DEGRADED',
            firstObservedTick: depSp.firstLatencyDegradedTick
          });
        }

        confidence = Math.max(0.1, confidence - this.config.propagationHopDiscount);
      }
    }

    // Sort path by tick order
    pathNodes.sort((a, b) => a.firstObservedTick - b.firstObservedTick);

    return {
      hypothesisId: hypothesis.candidateId,
      nodes: pathNodes,
      confidence: hypothesis.confidence
    };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private emptyResult(tick: number): CausalAnalysisResult {
    return {
      analysisTimestamp: tick,
      analyzedThroughTick: tick,
      hypotheses: [],
      causalGraph: { nodes: [], edges: [] },
      evidenceMatrix: {},
      confidenceHistory: [],
      reconstructedPaths: [],
      topCandidate: null,
      incidentDetected: false
    };
  }
}
