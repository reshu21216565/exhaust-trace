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
import { SimulationWorld } from '@exhausttrace/simulation';
import { CausalHypothesis, ResourceType, CheckpointServiceMetrics, CounterfactualPrediction, InterventionAction, ActualInterventionTrajectory, InterventionValidationResult, ExperimentEvent } from '@exhausttrace/shared';
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
export declare const DEFAULT_PREDICTOR_CONFIG: PredictorConfig;
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
export declare class CounterfactualPredictionEngine {
    private config;
    constructor(config?: Partial<PredictorConfig>);
    /**
     * Generate a counterfactual prediction for the given hypothesis.
     * @param hypothesis  The Block 3 top-ranked causal hypothesis (no ground truth).
     * @param world       The live SimulationWorld at prediction time.
     * @param baselineMetrics  Pre-incident observable baselines (from first few ticks).
     * @param eventLog    Mutable array to append ExperimentEvents to.
     */
    predict(hypothesis: CausalHypothesis, world: SimulationWorld, baselineMetrics: Record<string, CheckpointServiceMetrics>, eventLog?: ExperimentEvent[]): CounterfactualPrediction;
    private buildTransitions;
    private buildRecoveryTargets;
}
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
export declare class InterventionRunner {
    /**
     * Apply the intervention and capture actual trajectory.
     * @param action         The structured InterventionAction.
     * @param world          The live SimulationWorld to intervene on.
     * @param horizonTicks   How many ticks to observe post-intervention.
     * @param checkpointInterval  How frequently to sample (every N ticks).
     * @param eventLog       Mutable event log.
     */
    run(action: InterventionAction, world: SimulationWorld, horizonTicks: number, checkpointInterval: number, eventLog?: ExperimentEvent[]): ActualInterventionTrajectory;
    /**
     * Build an InterventionAction for the top hypothesis (ROOT_RELIEF).
     */
    static buildRootAction(prediction: CounterfactualPrediction, world: SimulationWorld): InterventionAction;
    /**
     * Build an InterventionAction for a symptom hypothesis (SYMPTOM_RELIEF).
     * This targets a downstream/non-root service to test discriminative power.
     */
    static buildSymptomAction(prediction: CounterfactualPrediction, symptomServiceId: string, symptomResource: ResourceType, world: SimulationWorld): InterventionAction;
}
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
export declare class InterventionValidator {
    private config;
    constructor(config?: Partial<PredictorConfig>);
    validate(prediction: CounterfactualPrediction, actual: ActualInterventionTrajectory, baselineMetrics: Record<string, CheckpointServiceMetrics>, action: InterventionAction, eventLog?: ExperimentEvent[]): InterventionValidationResult;
    private computeMetricErrors;
    private computeRecoveryAccuracy;
    private computeCascadeCollapseScore;
    private computeMilestones;
    private computeValidationStatus;
    private buildExplanation;
    private invalidResult;
}
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
export declare class ExperimentOrchestrator {
    private engine;
    private runner;
    private validator;
    private config;
    constructor(config?: Partial<PredictorConfig>);
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
    runExperiment(hypothesis: CausalHypothesis, world: SimulationWorld, baselineMetrics: Record<string, CheckpointServiceMetrics>, symptomServiceId?: string, symptomResource?: ResourceType): Promise<ExperimentResult>;
}
