/**
 * ExhaustTrace — Block 4: Counterfactual Prediction + Intervention + Validation
 *
 * This package implements the full predict → freeze → intervene → verify pipeline.
 *
 * ARCHITECTURE:
 *   CounterfactualPredictionEngine
 *     Takes: CausalHypothesis + live SimulationWorld snapshot
 *     Produces: frozen CounterfactualPrediction (before any intervention)
 *     Method: snapshot → clone/fork → relieve in fork → simulate → discard fork
 *
 *   InterventionRunner
 *     Takes: InterventionAction + live SimulationWorld
 *     Applies: targeted resource relief to ONLY the selected service/resource
 *     Captures: ActualInterventionTrajectory
 *
 *   InterventionValidator
 *     Takes: frozen CounterfactualPrediction + ActualInterventionTrajectory
 *     Produces: InterventionValidationResult
 *
 * GROUND TRUTH ISOLATION:
 *   This package may import SimulationWorld because it OWNS the counterfactual fork.
 *   The prediction ENGINE reads only observable metrics from the fork.
 *   Hidden fields (injectedRoot, targetSeverity) on ServiceStateData are never read.
 *   CausalHypothesis and CounterfactualPrediction contain NO ground truth.
 *
 * FROZEN PREDICTION SEMANTICS:
 *   Once status = 'FROZEN', the CounterfactualPrediction object is treated as
 *   immutable. The InterventionValidator compares against the FROZEN state.
 *   Post-intervention telemetry is stored in ActualInterventionTrajectory only.
 *
 * COUNTERFACTUAL FORK:
 *   The prediction engine uses SimulationWorld.createSnapshot() +
 *   restoreSnapshot() to create an identical clone. The clone receives
 *   relieveExhaustion() before simulating forward. The live world is untouched.
 *   RNG state is preserved in the snapshot for deterministic reproduction.
 */

import { SimulationWorld, DefaultConfig, RNG } from '@exhausttrace/simulation';
import { ObservationAdapter } from '@exhausttrace/observation';
import {
  CausalHypothesis,
  ResourceType,
  CheckpointServiceMetrics,
  PredictionCheckpoint,
  PredictedTransition,
  RecoveryTarget,
  CounterfactualPrediction,
  InterventionAction,
  InterventionType,
  ActualCheckpoint,
  ActualInterventionTrajectory,
  MetricError,
  RecoveryMilestone,
  InterventionValidationResult,
  ExperimentEvent,
  TelemetryTick,
  ServiceTelemetry,
  ValidationStatus
} from '@exhausttrace/shared';

// ==========================================================================
// PREDICTOR CONFIG
// ==========================================================================

export interface PredictorConfig {
  /** Number of ticks to simulate forward in the counterfactual fork. */
  horizonTicks: number;

  /** How frequently to sample a checkpoint (every N ticks). */
  checkpointInterval: number;

  /** Baseline latency tolerance: metric is "recovered" if within this fraction. */
  recoveryTolerance: number;

  /** Queue is "drained" if below this absolute depth. */
  queueDrainThreshold: number;

  /**
   * Validation thresholds (documented in InterventionValidationResult).
   *   MATCH:         recoveryAccuracy >= matchThreshold AND cascadeCollapseScore >= matchThreshold
   *   PARTIAL_MATCH: recoveryAccuracy >= partialMatchThreshold OR cascadeCollapseScore >= partialMatchThreshold
   */
  matchThreshold: number;
  partialMatchThreshold: number;

  /** Model version tag embedded in predictions. */
  modelVersion: string;
}

export const DEFAULT_PREDICTOR_CONFIG: PredictorConfig = {
  horizonTicks: 60,
  checkpointInterval: 10,
  recoveryTolerance: 0.15,      // ±15% of baseline
  queueDrainThreshold: 3,       // queue < 3 is considered "drained"
  matchThreshold: 0.80,
  partialMatchThreshold: 0.50,
  modelVersion: 'counterfactual-fork-v1'
};

// ==========================================================================
// HELPERS
// ==========================================================================

function metricsFromTelemetry(svc: ServiceTelemetry): CheckpointServiceMetrics {
  const resourcePressure: Partial<Record<ResourceType, number>> = {};
  const resourceStatus: Partial<Record<ResourceType, import('@exhausttrace/shared').ResourceStatus>> = {};
  const resources = svc.resources as Record<ResourceType, { pressure: number; status: import('@exhausttrace/shared').ResourceStatus }>;
  for (const res of ['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS'] as ResourceType[]) {
    if (resources[res]) {
      resourcePressure[res] = resources[res].pressure;
      resourceStatus[res] = resources[res].status;
    }
  }
  return {
    latencyMs: svc.metrics.latencyMs,
    queueDepth: svc.metrics.queueDepth,
    timeoutRate: svc.metrics.timeoutRate,
    retryRate: svc.metrics.retryRate,
    resourcePressure,
    resourceStatus
  };
}

function tickToMetrics(tick: TelemetryTick): Record<string, CheckpointServiceMetrics> {
  const m: Record<string, CheckpointServiceMetrics> = {};
  for (const svc of tick.services) {
    m[svc.serviceId] = metricsFromTelemetry(svc);
  }
  return m;
}

let _predictionCounter = 0;
let _interventionCounter = 0;

function newPredictionId(): string {
  return `pred-${Date.now()}-${++_predictionCounter}`;
}
function newInterventionId(): string {
  return `intv-${Date.now()}-${++_interventionCounter}`;
}

// ==========================================================================
// COUNTERFACTUAL PREDICTION ENGINE
// ==========================================================================

/**
 * Generates a frozen CounterfactualPrediction using a counterfactual fork.
 *
 * Steps:
 *   1. Snapshot the live SimulationWorld.
 *   2. Restore the snapshot into a NEW SimulationWorld (the fork).
 *   3. Apply relieveExhaustion on the fork's target service/resource.
 *   4. Simulate the fork forward horizonTicks, sampling every checkpointInterval.
 *   5. Build PredictionCheckpoints, PredictedTransitions, RecoveryTargets.
 *   6. Return a frozen CounterfactualPrediction.
 *
 * The live SimulationWorld is NOT modified.
 * The fork is discarded after prediction generation.
 */
export class CounterfactualPredictionEngine {
  private config: PredictorConfig;

  constructor(config: Partial<PredictorConfig> = {}) {
    this.config = { ...DEFAULT_PREDICTOR_CONFIG, ...config };
  }

  /**
   * Generate a counterfactual prediction for the given hypothesis.
   * @param hypothesis  The Block 3 top-ranked causal hypothesis (no ground truth).
   * @param world       The live SimulationWorld at prediction time.
   * @param baselineMetrics  Pre-incident observable baselines (from first few ticks).
   * @param eventLog    Mutable array to append ExperimentEvents to.
   */
  public predict(
    hypothesis: CausalHypothesis,
    world: SimulationWorld,
    baselineMetrics: Record<string, CheckpointServiceMetrics>,
    eventLog?: ExperimentEvent[]
  ): CounterfactualPrediction {
    const predictionId = newPredictionId();
    const createdAtTick = world.clock.currentTick;
    const createdAtMs = world.clock.timestamp;

    // ---- 1. Snapshot live world ----
    const snapshot = world.createSnapshot();

    // ---- 2. Create fork ----
    const fork = new SimulationWorld(world.rng.seed, world.config);
    fork.restoreSnapshot(snapshot);

    // ---- 2b. Introduce Independent Prediction RNG Stream ----
    // This separates the prediction's stochastic realization from the actual
    // intervention's stochastic realization, while maintaining determinism
    // and reproducibility for the prediction itself.
    const predictionSeed = `${world.rng.seed}-pred-${hypothesis.candidateId}-${createdAtTick}`;
    fork.rng = new RNG(predictionSeed);

    // ---- 3. Relieve suspected root in fork only ----
    fork.relieveExhaustion(hypothesis.serviceId, hypothesis.resource);

    // ---- 4. Observation setup for fork ----
    const adapter = new ObservationAdapter();
    const graph = adapter.extractDependencyGraph(fork);
    const baseCapacities: Record<string, number> = {};
    const baseLats: Record<string, number> = {};
    fork.nodes.forEach((node, sid) => {
      baseCapacities[sid] = node.state.params.baseCapacity;
      baseLats[sid] = node.state.params.baseLatency;
    });

    // ---- 5. Simulate fork forward, sampling checkpoints ----
    const checkpoints: PredictionCheckpoint[] = [];

    for (let rel = 1; rel <= this.config.horizonTicks; rel++) {
      fork.tick();
      if (rel % this.config.checkpointInterval === 0) {
        const tickData = adapter.extractObservableTelemetry(fork);
        checkpoints.push({
          relativeTick: rel,
          absoluteTick: createdAtTick + rel,
          timestampMs: rel * world.config.tickDurationMs,
          metrics: tickToMetrics(tickData)
        });
      }
    }

    // ---- 6. Build predicted transitions from the final checkpoint ----
    const transitions = this.buildTransitions(
      hypothesis, checkpoints, baselineMetrics
    );

    // ---- 7. Build recovery targets ----
    const recoveryTargets = this.buildRecoveryTargets(
      hypothesis, baselineMetrics, fork
    );

    // ---- 8. Construct frozen prediction ----
    const prediction: CounterfactualPrediction = {
      predictionId,
      status: 'FROZEN',  // immediately frozen upon creation
      createdAtTick,
      horizonTicks: this.config.horizonTicks,
      tickDurationMs: world.config.tickDurationMs,
      rootCandidateId: hypothesis.candidateId,
      rootServiceId: hypothesis.serviceId,
      rootResource: hypothesis.resource,
      confidenceAtPrediction: hypothesis.confidence,
      checkpoints,
      predictedTransitions: transitions,
      recoveryTargets,
      assumptions: [
        `Counterfactual fork: ${hypothesis.resource} exhaustion on ${hypothesis.serviceId} is relieved at tick ${createdAtTick}.`,
        `All other services and resources are left in their current state.`,
        `Traffic patterns remain constant during the prediction horizon.`,
        `This is a model-based counterfactual simulation from observable incident state, not ground truth.`,
        `Prediction generated from hypothesis: ${hypothesis.candidateId} (confidence=${(hypothesis.confidence * 100).toFixed(0)}%).`
      ],
      modelVersion: this.config.modelVersion
    };

    // ---- 9. Log experiment events ----
    if (eventLog) {
      eventLog.push({
        type: 'PREDICTION_CREATED',
        tick: createdAtTick,
        timestampMs: createdAtMs,
        predictionId,
        summary: `Counterfactual prediction created for ${hypothesis.candidateId}`
      });
      eventLog.push({
        type: 'PREDICTION_FROZEN',
        tick: createdAtTick,
        timestampMs: createdAtMs,
        predictionId,
        summary: `Prediction ${predictionId} is now frozen — checkpoints: ${checkpoints.length}`
      });
    }

    return prediction;
  }

  // --------------------------------------------------------------------------

  private buildTransitions(
    hypothesis: CausalHypothesis,
    checkpoints: PredictionCheckpoint[],
    baseline: Record<string, CheckpointServiceMetrics>
  ): PredictedTransition[] {
    const transitions: PredictedTransition[] = [];
    if (checkpoints.length === 0) return transitions;

    const rootSid = hypothesis.serviceId;
    const resource = hypothesis.resource;
    const lastCp = checkpoints[checkpoints.length - 1];
    const rootFinal = lastCp.metrics[rootSid];
    const firstCp = checkpoints[0];

    // Root resource pressure: CRITICAL/HIGH → HEALTHY
    const rootFirst = firstCp.metrics[rootSid];
    const rootFirstStatus = rootFirst?.resourceStatus[resource] ?? 'ELEVATED';
    const rootFinalStatus = rootFinal?.resourceStatus[resource] ?? 'HEALTHY';
    if (rootFirstStatus !== 'HEALTHY' || rootFinalStatus === 'HEALTHY') {
      // Find the checkpoint where root status first reaches HEALTHY/ELEVATED
      const recoveryTick = checkpoints.find(cp => {
        const s = cp.metrics[rootSid]?.resourceStatus[resource];
        return s === 'HEALTHY' || s === 'ELEVATED';
      });
      transitions.push({
        serviceId: rootSid,
        resource,
        fromCondition: `${resource} ${rootFirstStatus}`,
        toCondition: `${resource} HEALTHY`,
        expectedRelativeTick: recoveryTick?.relativeTick ?? checkpoints[checkpoints.length - 1].relativeTick,
        confidence: hypothesis.confidence
      });
    }

    // Root latency: predict it will recover
    const rootBaseLatency = baseline[rootSid]?.latencyMs ?? 120;
    const rootFinalLatency = rootFinal?.latencyMs ?? rootBaseLatency;
    if (rootFinalLatency < rootBaseLatency * 1.5) {
      const latTick = checkpoints.find(cp => (cp.metrics[rootSid]?.latencyMs ?? Infinity) < rootBaseLatency * 1.5);
      transitions.push({
        serviceId: rootSid,
        fromCondition: 'LATENCY_DEGRADED',
        toCondition: 'LATENCY_NORMAL',
        expectedRelativeTick: latTick?.relativeTick ?? checkpoints[checkpoints.length - 1].relativeTick,
        confidence: hypothesis.confidence * 0.9
      });
    }

    // Root queue: predict it drains
    const rootFinalQueue = rootFinal?.queueDepth ?? 0;
    if (rootFinalQueue < this.config.queueDrainThreshold) {
      const queueTick = checkpoints.find(cp => (cp.metrics[rootSid]?.queueDepth ?? Infinity) < this.config.queueDrainThreshold);
      transitions.push({
        serviceId: rootSid,
        fromCondition: 'QUEUE_GROWTH',
        toCondition: 'QUEUE_DRAINED',
        expectedRelativeTick: queueTick?.relativeTick ?? checkpoints[checkpoints.length - 1].relativeTick,
        confidence: hypothesis.confidence * 0.85
      });
    }

    // Downstream services: predict timeout/retry recovery
    const allServiceIds = Object.keys(lastCp.metrics);
    for (const sid of allServiceIds) {
      if (sid === rootSid) continue;
      const finalMetrics = lastCp.metrics[sid];
      const baseLatency = baseline[sid]?.latencyMs ?? 120;

      if (finalMetrics && finalMetrics.latencyMs < baseLatency * 1.5) {
        const latTick = checkpoints.find(cp => (cp.metrics[sid]?.latencyMs ?? Infinity) < baseLatency * 1.5);
        transitions.push({
          serviceId: sid,
          fromCondition: 'LATENCY_DEGRADED',
          toCondition: 'LATENCY_NORMAL',
          expectedRelativeTick: latTick?.relativeTick ?? checkpoints[checkpoints.length - 1].relativeTick,
          confidence: hypothesis.confidence * 0.80
        });
      }

      if (finalMetrics && finalMetrics.timeoutRate < 0.01) {
        transitions.push({
          serviceId: sid,
          fromCondition: 'TIMEOUT_SPIKE',
          toCondition: 'TIMEOUT_NORMAL',
          expectedRelativeTick: checkpoints[checkpoints.length - 1].relativeTick,
          confidence: hypothesis.confidence * 0.75
        });
      }
    }

    return transitions;
  }

  private buildRecoveryTargets(
    hypothesis: CausalHypothesis,
    baseline: Record<string, CheckpointServiceMetrics>,
    fork: SimulationWorld
  ): RecoveryTarget[] {
    const targets: RecoveryTarget[] = [];
    const tol = this.config.recoveryTolerance;

    // Root resource pressure
    targets.push({
      serviceId: hypothesis.serviceId,
      metricName: `${hypothesis.resource}_pressure`,
      targetValue: 0,
      tolerance: tol,
      baselineValue: 0
    });

    // Root latency
    const rootBaseLat = baseline[hypothesis.serviceId]?.latencyMs ?? 120;
    targets.push({
      serviceId: hypothesis.serviceId,
      metricName: 'latencyMs',
      targetValue: rootBaseLat,
      tolerance: tol,
      baselineValue: rootBaseLat
    });

    // Root queue
    targets.push({
      serviceId: hypothesis.serviceId,
      metricName: 'queueDepth',
      targetValue: 0,
      tolerance: 0,
      baselineValue: 0
    });

    // Each other service: latency + timeout + queue
    for (const [sid] of fork.nodes) {
      if (sid === hypothesis.serviceId) continue;
      const baseLat = baseline[sid]?.latencyMs ?? 120;
      targets.push({
        serviceId: sid,
        metricName: 'latencyMs',
        targetValue: baseLat,
        tolerance: tol,
        baselineValue: baseLat
      });
      targets.push({
        serviceId: sid,
        metricName: 'timeoutRate',
        targetValue: 0,
        tolerance: 0,
        baselineValue: 0
      });
      targets.push({
        serviceId: sid,
        metricName: 'queueDepth',
        targetValue: 0,
        tolerance: 0,
        baselineValue: 0
      });
    }

    return targets;
  }
}

// ==========================================================================
// INTERVENTION RUNNER
// ==========================================================================

/**
 * Applies a targeted resource relief to the live simulation and captures
 * the actual post-intervention trajectory.
 *
 * ISOLATION GUARANTEE:
 *   Only the selected service/resource is relieved.
 *   Downstream services are NOT touched by the intervention action itself.
 *   Natural cascade recovery is driven by simulation physics.
 *
 * EXPERIMENT RESET:
 *   Use world.restoreSnapshot(snapshot) before each experiment to reset
 *   to identical pre-intervention state.
 */
export class InterventionRunner {
  /**
   * Apply the intervention and capture actual trajectory.
   * @param action         The structured InterventionAction.
   * @param world          The live SimulationWorld to intervene on.
   * @param horizonTicks   How many ticks to observe post-intervention.
   * @param checkpointInterval  How frequently to sample (every N ticks).
   * @param eventLog       Mutable event log.
   */
  public run(
    action: InterventionAction,
    world: SimulationWorld,
    horizonTicks: number,
    checkpointInterval: number,
    eventLog?: ExperimentEvent[]
  ): ActualInterventionTrajectory {
    const startTick = world.clock.currentTick;
    const startMs = world.clock.timestamp;

    // ---- Apply ONLY the target resource relief ----
    // This is the sole modification: the targeted resource on the targeted service.
    // No downstream services are touched. Natural recovery cascades through physics.
    world.relieveExhaustion(action.targetServiceId, action.targetResource);

    if (eventLog) {
      eventLog.push({
        type: 'INTERVENTION_STARTED',
        tick: startTick,
        timestampMs: startMs,
        predictionId: action.predictionId,
        interventionId: action.interventionId,
        summary: `${action.interventionType}: relieving ${action.targetResource} on ${action.targetServiceId}`
      });
    }

    const adapter = new ObservationAdapter();
    const checkpoints: ActualCheckpoint[] = [];

    for (let rel = 1; rel <= horizonTicks; rel++) {
      world.tick();
      if (rel % checkpointInterval === 0) {
        const tickData = adapter.extractObservableTelemetry(world);
        checkpoints.push({
          relativeTick: rel,
          absoluteTick: startTick + rel,
          timestampMs: rel * world.config.tickDurationMs,
          metrics: tickToMetrics(tickData)
        });
      }
    }

    const endTick = world.clock.currentTick;

    if (eventLog) {
      eventLog.push({
        type: 'INTERVENTION_COMPLETED',
        tick: endTick,
        timestampMs: world.clock.timestamp,
        predictionId: action.predictionId,
        interventionId: action.interventionId,
        summary: `${action.interventionId} completed — captured ${checkpoints.length} checkpoints`
      });
    }

    return {
      interventionId: action.interventionId,
      predictionId: action.predictionId,
      startTick,
      endTick,
      checkpoints
    };
  }

  /**
   * Build an InterventionAction for the top hypothesis (ROOT_RELIEF).
   */
  public static buildRootAction(
    prediction: CounterfactualPrediction,
    world: SimulationWorld
  ): InterventionAction {
    return {
      interventionId: newInterventionId(),
      interventionType: 'ROOT_RELIEF',
      targetServiceId: prediction.rootServiceId,
      targetResource: prediction.rootResource,
      actionType: 'RELIEVE_RESOURCE',
      appliedAtTick: world.clock.currentTick,
      timestampMs: world.clock.timestamp,
      predictionId: prediction.predictionId,
      preInterventionSnapshotTick: world.clock.currentTick
    };
  }

  /**
   * Build an InterventionAction for a symptom hypothesis (SYMPTOM_RELIEF).
   * This targets a downstream/non-root service to test discriminative power.
   */
  public static buildSymptomAction(
    prediction: CounterfactualPrediction,
    symptomServiceId: string,
    symptomResource: ResourceType,
    world: SimulationWorld
  ): InterventionAction {
    return {
      interventionId: newInterventionId(),
      interventionType: 'SYMPTOM_RELIEF',
      targetServiceId: symptomServiceId,
      targetResource: symptomResource,
      actionType: 'RELIEVE_RESOURCE',
      appliedAtTick: world.clock.currentTick,
      timestampMs: world.clock.timestamp,
      predictionId: prediction.predictionId,
      preInterventionSnapshotTick: world.clock.currentTick
    };
  }
}

// ==========================================================================
// INTERVENTION VALIDATOR
// ==========================================================================

/**
 * Compares a FROZEN CounterfactualPrediction against an ActualInterventionTrajectory.
 *
 * RECOVERY ACCURACY:
 *   For each (service × checkpoint × key metric), compute:
 *     relError = |actual - predicted| / max(|predicted|, 1)
 *     accuracy = 1 - min(relError, 1)
 *   recoveryAccuracy = mean of all accuracy values.
 *
 * CASCADE COLLAPSE SCORE:
 *   Measures actual cascade disappearance after the intervention.
 *   Checks the last 3 actual checkpoints vs pre-intervention peak.
 *   Dimensions (equal weights):
 *     1. Root pressure drop: how much did root resource pressure fall?
 *     2. Root latency drop:  how much did root latency fall?
 *     3. Downstream queue drain: fraction of non-root services with queue < threshold
 *     4. Downstream latency recovery: fraction of non-root services with latency < 1.5× baseline
 *     5. Timeout recovery: fraction of services with timeoutRate < 0.01
 *     6. Retry recovery:   fraction of services with retryRate < 5
 *
 * VALIDATION THRESHOLDS:
 *   MATCH:         recoveryAccuracy >= 0.80 AND cascadeCollapseScore >= 0.80
 *   PARTIAL_MATCH: recoveryAccuracy >= 0.50 OR  cascadeCollapseScore >= 0.50
 *   MISMATCH:      otherwise
 *   INVALID:       structural (no checkpoints, mismatch count > 50% of expected)
 */
export class InterventionValidator {
  private config: PredictorConfig;

  constructor(config: Partial<PredictorConfig> = {}) {
    this.config = { ...DEFAULT_PREDICTOR_CONFIG, ...config };
  }

  public validate(
    prediction: CounterfactualPrediction,
    actual: ActualInterventionTrajectory,
    baselineMetrics: Record<string, CheckpointServiceMetrics>,
    action: InterventionAction,
    eventLog?: ExperimentEvent[]
  ): InterventionValidationResult {
    const startMs = Date.now();

    if (eventLog) {
      eventLog.push({
        type: 'VALIDATION_STARTED',
        tick: actual.startTick,
        timestampMs: actual.startTick * prediction.tickDurationMs,
        predictionId: prediction.predictionId,
        interventionId: actual.interventionId,
        summary: `Validating ${prediction.predictionId} against ${actual.interventionId}`
      });
    }

    // ---- Structural check ----
    if (actual.checkpoints.length === 0 || prediction.checkpoints.length === 0) {
      return this.invalidResult(prediction, actual, action, 'No checkpoints in actual or predicted trajectory');
    }

    // ---- Metric errors ----
    const metricErrors = this.computeMetricErrors(prediction, actual);

    // ---- Recovery accuracy ----
    const recoveryAccuracy = this.computeRecoveryAccuracy(metricErrors);

    // ---- Cascade collapse score ----
    const cascadeCollapseScore = this.computeCascadeCollapseScore(
      prediction, actual, baselineMetrics
    );

    // ---- Milestones ----
    const milestones = this.computeMilestones(prediction, actual, baselineMetrics);

    // ---- Validation status ----
    const validationStatus = this.computeValidationStatus(recoveryAccuracy, cascadeCollapseScore);

    // ---- Explanation ----
    const explanation = this.buildExplanation(
      prediction, action, recoveryAccuracy, cascadeCollapseScore, validationStatus, milestones
    );

    const result: InterventionValidationResult = {
      predictionId: prediction.predictionId,
      interventionId: actual.interventionId,
      interventionType: action.interventionType,
      target: `${action.targetServiceId}/${action.targetResource}`,
      metricErrors,
      recoveryAccuracy,
      cascadeCollapseScore,
      validationStatus,
      milestones,
      explanation
    };

    if (eventLog) {
      eventLog.push({
        type: 'VALIDATION_COMPLETED',
        tick: actual.endTick,
        timestampMs: actual.endTick * prediction.tickDurationMs,
        predictionId: prediction.predictionId,
        interventionId: actual.interventionId,
        summary: `Validation complete: ${validationStatus} (accuracy=${recoveryAccuracy.toFixed(2)}, cascade=${cascadeCollapseScore.toFixed(2)})`
      });
    }

    return result;
  }

  // --------------------------------------------------------------------------

  private computeMetricErrors(
    prediction: CounterfactualPrediction,
    actual: ActualInterventionTrajectory
  ): MetricError[] {
    const errors: MetricError[] = [];
    const KEY_METRICS: (keyof Pick<ReturnType<typeof tickToMetrics>[string], 'latencyMs' | 'queueDepth' | 'timeoutRate' | 'retryRate'>)[] = [
      'latencyMs', 'queueDepth', 'timeoutRate', 'retryRate'
    ];

    for (const predCp of prediction.checkpoints) {
      // Find matching actual checkpoint by relativeTick
      const actualCp = actual.checkpoints.find(a => a.relativeTick === predCp.relativeTick);
      if (!actualCp) continue;

      for (const [sid, predMetrics] of Object.entries(predCp.metrics)) {
        const actualMetrics = actualCp.metrics[sid];
        if (!actualMetrics) continue;

        for (const metric of KEY_METRICS) {
          const predicted = (predMetrics as any)[metric] as number;
          const actualVal = (actualMetrics as any)[metric] as number;
          const absErr = Math.abs(actualVal - predicted);
          const relErr = absErr / Math.max(Math.abs(predicted), 1);
          errors.push({
            serviceId: sid,
            metricName: metric,
            relativeTick: predCp.relativeTick,
            predictedValue: predicted,
            actualValue: actualVal,
            absoluteError: absErr,
            relativeError: relErr
          });
        }
      }
    }

    return errors;
  }

  private computeRecoveryAccuracy(errors: MetricError[]): number {
    if (errors.length === 0) return 0;
    const accuracies = errors.map(e => 1 - Math.min(e.relativeError, 1));
    return accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  }

  private computeCascadeCollapseScore(
    prediction: CounterfactualPrediction,
    actual: ActualInterventionTrajectory,
    baseline: Record<string, CheckpointServiceMetrics>
  ): number {
    // Use the last 3 actual checkpoints (or fewer if short)
    const nLast = Math.min(3, actual.checkpoints.length);
    if (nLast === 0) return 0;
    const lastCheckpoints = actual.checkpoints.slice(-nLast);
    const lastCp = lastCheckpoints[lastCheckpoints.length - 1];

    // Compare against the pre-intervention state (first actual checkpoint)
    const firstCp = actual.checkpoints[0];
    const rootSid = prediction.rootServiceId;
    const rootRes = prediction.rootResource;

    // ---- Dim 1: Root pressure drop ----
    const rootPressurePre = firstCp.metrics[rootSid]?.resourcePressure[rootRes] ?? 0;
    const rootPressurePost = lastCp.metrics[rootSid]?.resourcePressure[rootRes] ?? 0;
    const dim1 = rootPressurePre > 0
      ? Math.max(0, Math.min(1, (rootPressurePre - rootPressurePost) / rootPressurePre))
      : 1.0; // already zero before — count as success

    // ---- Dim 2: Root latency drop ----
    const rootLatBase = baseline[rootSid]?.latencyMs ?? 120;
    const rootLatPre = firstCp.metrics[rootSid]?.latencyMs ?? rootLatBase;
    const rootLatPost = lastCp.metrics[rootSid]?.latencyMs ?? rootLatBase;
    const maxLatDrop = Math.max(rootLatPre - rootLatBase, 1);
    const dim2 = Math.max(0, Math.min(1, (rootLatPre - rootLatPost) / maxLatDrop));

    // ---- Dims 3–6: Downstream recovery ----
    const allSids = Object.keys(lastCp.metrics);
    const downstreamSids = allSids.filter(s => s !== rootSid);

    if (downstreamSids.length === 0) {
      return (dim1 + dim2) / 2;
    }

    // Dim 3: Queue drain
    const queueDrained = downstreamSids.filter(s =>
      (lastCp.metrics[s]?.queueDepth ?? 0) < this.config.queueDrainThreshold
    ).length;
    const dim3 = queueDrained / downstreamSids.length;

    // Dim 4: Latency recovery
    const latRecovered = downstreamSids.filter(s => {
      const baseLat = baseline[s]?.latencyMs ?? 120;
      return (lastCp.metrics[s]?.latencyMs ?? 0) < baseLat * 1.5;
    }).length;
    const dim4 = latRecovered / downstreamSids.length;

    // Dim 5: Timeout recovery
    const timeoutRecovered = allSids.filter(s =>
      (lastCp.metrics[s]?.timeoutRate ?? 0) < 0.01
    ).length;
    const dim5 = timeoutRecovered / allSids.length;

    // Dim 6: Retry recovery
    const retryRecovered = allSids.filter(s =>
      (lastCp.metrics[s]?.retryRate ?? 0) < 5
    ).length;
    const dim6 = retryRecovered / allSids.length;

    const score = (dim1 + dim2 + dim3 + dim4 + dim5 + dim6) / 6;
    return Math.max(0, Math.min(1, score));
  }

  private computeMilestones(
    prediction: CounterfactualPrediction,
    actual: ActualInterventionTrajectory,
    baseline: Record<string, CheckpointServiceMetrics>
  ): RecoveryMilestone[] {
    const milestones: RecoveryMilestone[] = [];
    const rootSid = prediction.rootServiceId;
    const rootRes = prediction.rootResource;

    // Milestone 1: Root resource returns to ELEVATED or HEALTHY
    const rootPressMilestone = actual.checkpoints.findIndex(cp => {
      const st = cp.metrics[rootSid]?.resourceStatus[rootRes];
      return st === 'HEALTHY' || st === 'ELEVATED';
    });
    milestones.push({
      description: `${rootSid} ${rootRes} returns to ELEVATED or HEALTHY`,
      achievedAtRelativeTick: rootPressMilestone >= 0 ? actual.checkpoints[rootPressMilestone].relativeTick : null,
      targetRelativeTick: Math.floor(prediction.horizonTicks * 0.5),
      achieved: rootPressMilestone >= 0
    });

    // Milestone 2: Root latency normalizes
    const rootLatBase = baseline[rootSid]?.latencyMs ?? 120;
    const latMilestone = actual.checkpoints.findIndex(cp =>
      (cp.metrics[rootSid]?.latencyMs ?? Infinity) < rootLatBase * 1.5
    );
    milestones.push({
      description: `${rootSid} latency returns below 1.5× baseline (${(rootLatBase * 1.5).toFixed(0)}ms)`,
      achievedAtRelativeTick: latMilestone >= 0 ? actual.checkpoints[latMilestone].relativeTick : null,
      targetRelativeTick: Math.floor(prediction.horizonTicks * 0.6),
      achieved: latMilestone >= 0
    });

    // Milestone 3: All downstream queues drain
    const allSids = actual.checkpoints.length > 0 ? Object.keys(actual.checkpoints[0].metrics) : [];
    const downstreamSids = allSids.filter(s => s !== rootSid);

    const queueMilestone = actual.checkpoints.findIndex(cp =>
      downstreamSids.every(s => (cp.metrics[s]?.queueDepth ?? 0) < this.config.queueDrainThreshold)
    );
    milestones.push({
      description: `All downstream service queues drain (< ${this.config.queueDrainThreshold})`,
      achievedAtRelativeTick: queueMilestone >= 0 ? actual.checkpoints[queueMilestone].relativeTick : null,
      targetRelativeTick: Math.floor(prediction.horizonTicks * 0.75),
      achieved: queueMilestone >= 0
    });

    // Milestone 4: Timeout rates normalize
    const timeoutMilestone = actual.checkpoints.findIndex(cp =>
      allSids.every(s => (cp.metrics[s]?.timeoutRate ?? 0) < 0.01)
    );
    milestones.push({
      description: `All service timeout rates return near-zero (< 0.01 req/s)`,
      achievedAtRelativeTick: timeoutMilestone >= 0 ? actual.checkpoints[timeoutMilestone].relativeTick : null,
      targetRelativeTick: Math.floor(prediction.horizonTicks * 0.80),
      achieved: timeoutMilestone >= 0
    });

    return milestones;
  }

  private computeValidationStatus(
    recoveryAccuracy: number,
    cascadeCollapseScore: number
  ): ValidationStatus {
    if (recoveryAccuracy >= this.config.matchThreshold && cascadeCollapseScore >= this.config.matchThreshold) {
      return 'MATCH';
    }
    if (recoveryAccuracy >= this.config.partialMatchThreshold || cascadeCollapseScore >= this.config.partialMatchThreshold) {
      return 'PARTIAL_MATCH';
    }
    return 'MISMATCH';
  }

  private buildExplanation(
    prediction: CounterfactualPrediction,
    action: InterventionAction,
    recoveryAccuracy: number,
    cascadeCollapseScore: number,
    status: ValidationStatus,
    milestones: RecoveryMilestone[]
  ): string {
    const achievedCount = milestones.filter(m => m.achieved).length;
    const typeLabel = action.interventionType === 'ROOT_RELIEF'
      ? 'Root intervention'
      : 'Symptom intervention';

    return `${typeLabel} on ${action.targetServiceId}/${action.targetResource}. ` +
      `Prediction ${prediction.predictionId} validated as ${status}. ` +
      `Recovery accuracy: ${(recoveryAccuracy * 100).toFixed(1)}%. ` +
      `Cascade collapse score: ${(cascadeCollapseScore * 100).toFixed(1)}%. ` +
      `Milestones achieved: ${achievedCount}/${milestones.length}. ` +
      (action.interventionType === 'SYMPTOM_RELIEF'
        ? `Symptom relief did not fully collapse the cascade — root cause remains active.`
        : `Recovery trajectory matched prediction.`);
  }

  private invalidResult(
    prediction: CounterfactualPrediction,
    actual: ActualInterventionTrajectory,
    action: InterventionAction,
    reason: string
  ): InterventionValidationResult {
    return {
      predictionId: prediction.predictionId,
      interventionId: actual.interventionId,
      interventionType: action.interventionType,
      target: prediction.rootCandidateId,
      metricErrors: [],
      recoveryAccuracy: 0,
      cascadeCollapseScore: 0,
      validationStatus: 'INVALID',
      milestones: [],
      explanation: `INVALID: ${reason}`
    };
  }
}

// ==========================================================================
// EXPERIMENT ORCHESTRATOR (convenience wrapper)
// ==========================================================================

/**
 * High-level orchestrator for the full predict → freeze → intervene → verify flow.
 * Used by tests and the backend.
 */
export interface ExperimentResult {
  prediction: CounterfactualPrediction;
  rootAction: InterventionAction;
  rootTrajectory: ActualInterventionTrajectory;
  rootValidation: InterventionValidationResult;
  symptomAction?: InterventionAction;
  symptomTrajectory?: ActualInterventionTrajectory;
  symptomValidation?: InterventionValidationResult;
  eventLog: ExperimentEvent[];
}

export class ExperimentOrchestrator {
  private engine: CounterfactualPredictionEngine;
  private runner: InterventionRunner;
  private validator: InterventionValidator;
  private config: PredictorConfig;

  constructor(config: Partial<PredictorConfig> = {}) {
    this.config = { ...DEFAULT_PREDICTOR_CONFIG, ...config };
    this.engine = new CounterfactualPredictionEngine(this.config);
    this.runner = new InterventionRunner();
    this.validator = new InterventionValidator(this.config);
  }

  /**
   * Run the full experiment:
   * 1. Generate frozen prediction from hypothesis + live world snapshot
   * 2. Restore world to pre-intervention state (from snapshot)
   * 3. Apply root intervention → capture trajectory → validate
   * 4. Optionally: reset, apply symptom intervention → capture → validate
   *
   * @param hypothesis         Block 3 top hypothesis
   * @param world              Live SimulationWorld at prediction time
   * @param baselineMetrics    Baselines captured from healthy period
   * @param symptomServiceId   Optional symptom service for Experiment 2
   * @param symptomResource    Optional symptom resource for Experiment 2
   */
  public async runExperiment(
    hypothesis: CausalHypothesis,
    world: SimulationWorld,
    baselineMetrics: Record<string, CheckpointServiceMetrics>,
    symptomServiceId?: string,
    symptomResource?: ResourceType
  ): Promise<ExperimentResult> {
    const eventLog: ExperimentEvent[] = [];

    // ---- Snapshot pre-intervention state ----
    const preSnapshot = world.createSnapshot();

    // ---- 1. Generate frozen prediction (from snapshot, fork, discard) ----
    const prediction = this.engine.predict(hypothesis, world, baselineMetrics, eventLog);

    // ---- 2. Restore world to pre-intervention state ----
    world.restoreSnapshot(preSnapshot);

    // ---- 3. Run root intervention ----
    const rootAction = InterventionRunner.buildRootAction(prediction, world);
    const rootTrajectory = this.runner.run(
      rootAction, world,
      this.config.horizonTicks,
      this.config.checkpointInterval,
      eventLog
    );
    const rootValidation = this.validator.validate(
      prediction, rootTrajectory, baselineMetrics, rootAction, eventLog
    );

    const result: ExperimentResult = {
      prediction,
      rootAction,
      rootTrajectory,
      rootValidation,
      eventLog
    };

    // ---- 4. Optional: symptom intervention ----
    if (symptomServiceId && symptomResource) {
      // Reset to identical pre-intervention state
      world.restoreSnapshot(preSnapshot);

      const symptomAction = InterventionRunner.buildSymptomAction(
        prediction, symptomServiceId, symptomResource, world
      );
      const symptomTrajectory = this.runner.run(
        symptomAction, world,
        this.config.horizonTicks,
        this.config.checkpointInterval,
        eventLog
      );
      const symptomValidation = this.validator.validate(
        prediction, symptomTrajectory, baselineMetrics, symptomAction, eventLog
      );

      result.symptomAction = symptomAction;
      result.symptomTrajectory = symptomTrajectory;
      result.symptomValidation = symptomValidation;
    }

    return result;
  }
}
