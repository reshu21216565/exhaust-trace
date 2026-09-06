/**
 * ExhaustTrace Shared Contracts
 * This package contains authoritative types shared across the monorepo.
 */

// ==========================================
// 1. SERVICES & RESOURCES
// ==========================================

export type ResourceType = 'CPU' | 'MEMORY' | 'CONNECTIONS' | 'WORKERS';

export interface ResourceDefinition {
  id: string;
  type: ResourceType;
  capacity: number;
}

export interface ServiceDefinition {
  serviceId: string;
  name: string;
  dependencies: string[]; // List of serviceIds this service depends on
  resources: ResourceDefinition[];
}

// ==========================================
// 2. GRAPHS (CRITICAL SEMANTICS)
// ==========================================

export interface GraphEdge {
  from: string;
  to: string;
}

/**
 * Dependency Graph
 * SEMANTICS: A -> B means A is the caller/dependent, and A depends on B.
 * Example: Portal -> Appointment -> Records
 * If Records fails, propagation travels: Records -> Appointment -> Portal.
 */
export interface DependencyGraph {
  nodes: { id: string; label?: string }[];
  edges: GraphEdge[];
}

/**
 * Causal Graph
 * SEMANTICS: A -> B means observed condition/event A causally contributes to observed condition/event B.
 * Example: Records.memory_pressure -> Records.latency_increase -> Appointment.timeout
 */
export interface CausalGraph {
  nodes: { id: string; label?: string }[];
  edges: GraphEdge[];
}

// ==========================================
// 3. TELEMETRY
// ==========================================

export type ResourceStatus = 'HEALTHY' | 'ELEVATED' | 'HIGH' | 'CRITICAL';

export interface ResourceTelemetry {
  utilization: number;
  pressure: number;
  status: ResourceStatus;
}

export interface ServiceTelemetry {
  serviceId: string;
  resources: {
    CPU: ResourceTelemetry;
    MEMORY: ResourceTelemetry;
    CONNECTIONS: ResourceTelemetry;
    WORKERS: ResourceTelemetry;
  };
  metrics: {
    incomingRate: number;
    retryIncomingRate: number;
    processedRate: number;
    queueDepth: number;
    maxQueueDepth: number;
    latencyMs: number;
    timeoutRate: number;
    failureRate: number;
    successRate: number;
    retryRate: number;
  };
}

export interface TelemetryTick {
  timestamp: number;
  tick: number;
  services: ServiceTelemetry[];
}

// ==========================================
// 4. EVENT SCHEMA (DISCRIMINATED UNION)
// ==========================================

export type SystemEventType = 
  | 'RESOURCE_PRESSURE_CHANGED'
  | 'QUEUE_GROWTH'
  | 'LATENCY_DEGRADED'
  | 'TIMEOUT_SPIKE'
  | 'RETRY_SURGE'
  | 'CAPACITY_DEGRADED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_COMPLETED';

export interface BaseObservableEvent {
  sequence: number;
  tick: number;
  timestamp: number;
  type: SystemEventType;
}

export interface ResourcePressureChangedEvent extends BaseObservableEvent {
  type: 'RESOURCE_PRESSURE_CHANGED';
  serviceId: string;
  resource: string;
  previousStatus: ResourceStatus;
  status: ResourceStatus;
  utilization: number;
  pressure: number;
}

export interface QueueGrowthEvent extends BaseObservableEvent {
  type: 'QUEUE_GROWTH';
  serviceId: string;
  queueDepth: number;
  previousQueueDepth: number;
  growthRate: number;
}

export interface LatencyDegradedEvent extends BaseObservableEvent {
  type: 'LATENCY_DEGRADED';
  serviceId: string;
  latencyMs: number;
  previousLatencyMs: number;
  threshold: number;
}

export interface TimeoutSpikeEvent extends BaseObservableEvent {
  type: 'TIMEOUT_SPIKE';
  callerService: string;
  dependencyService: string;
  timeoutRate: number;
}

export interface RetrySurgeEvent extends BaseObservableEvent {
  type: 'RETRY_SURGE';
  callerService: string;
  dependencyService: string;
  retryRate: number;
}

export interface CapacityDegradedEvent extends BaseObservableEvent {
  type: 'CAPACITY_DEGRADED';
  serviceId: string;
  capacity: number;
  baselineCapacity: number;
}

export interface RecoveryEvent extends BaseObservableEvent {
  type: 'RECOVERY_STARTED' | 'RECOVERY_COMPLETED';
  serviceId?: string; // Optional if it's a systemic recovery vs localized
}

export type ObservableSystemEvent = 
  | ResourcePressureChangedEvent
  | QueueGrowthEvent
  | LatencyDegradedEvent
  | TimeoutSpikeEvent
  | RetrySurgeEvent
  | CapacityDegradedEvent
  | RecoveryEvent;


// ==========================================
// 5. CAUSAL ANALYSIS RESULT (Block 3)
// ==========================================

export const RESOURCE_TYPES: ResourceType[] = ['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS'];

/**
 * A single piece of structured evidence for or against a hypothesis.
 * category: which scoring dimension this evidence belongs to.
 * description: human-readable description of the observation.
 * isSupporting: true if this evidence supports the candidate as root.
 * scoreImpact: positive = supporting, negative = contradicting.
 */
export interface EvidenceItem {
  category:
    | 'resourcePressure'
    | 'temporalPrecedence'
    | 'downstreamPropagation'
    | 'queueGrowth'
    | 'latencyCorrelation'
    | 'timeoutCorrelation'
    | 'retryCorrelation'
    | 'recoveryCorrelation'
    | 'dependencyConsistency'
    | 'noisePenalty'
    | 'competingHypothesisPenalty';
  description: string;
  isSupporting: boolean;
  scoreImpact: number;
}

/**
 * Per-candidate causal hypothesis.
 */
export interface CausalHypothesis {
  candidateId: string;          // e.g. "records/MEMORY"
  serviceId: string;
  resource: ResourceType;
  score: number;                // final weighted score [0, 100]
  rank: number;                 // 1 = most likely root
  confidence: number;           // [0, 1]
  evidence: EvidenceItem[];
  supportingSignals: string[];  // high-level human-readable signals
  contradictingSignals: string[];
  firstAbnormalTick: number | null;   // tick when this candidate first became non-HEALTHY
  peakPressureTick: number | null;    // tick of maximum pressure
}

/**
 * A node in the reconstructed causal graph.
 * SEMANTICS: A → B means observed condition/event A causally contributes to B.
 */
export interface CausalNode {
  id: string;           // e.g. "records/MEMORY/pressure"
  label: string;
  serviceId: string;
  resource?: ResourceType;
  eventType?: string;
}

/**
 * An edge in the causal graph.
 */
export interface CausalEdge {
  from: string;          // CausalNode.id
  to: string;
  evidence: string;      // brief human-readable description of the causal link
  confidence: number;    // [0, 1]
  firstObservedTick: number;
  supportingEventTypes: string[];
}

export interface ReconstructedCausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
}

/**
 * Propagation path from the hypothesized root to downstream effects.
 */
export interface PropagationPathNode {
  serviceId: string;
  resource?: ResourceType;
  observedCondition: string;  // e.g. "MEMORY CRITICAL", "LATENCY_DEGRADED", "TIMEOUT_SPIKE"
  firstObservedTick: number;
}

export interface PropagationPath {
  hypothesisId: string;    // candidateId of the root
  nodes: PropagationPathNode[];
  confidence: number;
}

/**
 * Confidence at a specific point in time.
 */
export interface ConfidenceSnapshot {
  tick: number;
  timestamp: number;
  topCandidateId: string;
  topCandidateScore: number;
  topCandidateConfidence: number;
  allScores: Record<string, number>;  // candidateId → score at this tick
}

/**
 * Canonical output of the CausalAnalyzer.
 * Contains ONLY observable evidence and derived inferences.
 * No hidden ground truth, no SimulationWorld references.
 */
export interface CausalAnalysisResult {
  analysisTimestamp: number;          // simulation tick at analysis time
  analyzedThroughTick: number;        // last tick of telemetry consumed
  hypotheses: CausalHypothesis[];     // sorted by rank (rank 1 first)
  causalGraph: ReconstructedCausalGraph;
  evidenceMatrix: Record<string, EvidenceItem[]>;  // candidateId → evidence[]
  confidenceHistory: ConfidenceSnapshot[];
  reconstructedPaths: PropagationPath[];
  topCandidate: CausalHypothesis | null;
  incidentDetected: boolean;  // false for healthy baseline
}

// ==========================================
// 6. OBSERVATION CONFIGURATION
// ==========================================

export interface ObservationConfig {
  queueGrowthBands: number[]; // e.g. [0.1, 0.25, 0.5, 0.75, 0.9]
  latencyDegradationMultiplier: number; // e.g. 2.0
  timeoutSpikeThreshold: number; // e.g. 0.05
  retrySurgeThreshold: number; // e.g. 5 req/s
  capacityDegradationThreshold: number; // e.g. 0.8 (80% of baseline)
  recoveryStabilityTicks: number; // e.g. 50 ticks
}

export const DefaultObservationConfig: ObservationConfig = {
  queueGrowthBands: [0.1, 0.25, 0.5, 0.75, 0.9],
  latencyDegradationMultiplier: 2.0,
  timeoutSpikeThreshold: 0.05,
  retrySurgeThreshold: 5,
  capacityDegradationThreshold: 0.8,
  recoveryStabilityTicks: 50
};

// ==========================================
// 7. LEGACY / BLOCK 3-FUTURE BUNDLE
// ==========================================

export interface TelemetrySummary {
  serviceId: string;
  averageLatency: number;
  peakErrorRate: number;
  peakResourceUtilization: number;
}

export interface ConfidenceTick {
  timestamp: number;
  tickId: number;
  topCandidateId: string;
  confidenceScore: number;
}

// ==========================================
// 8. BLOCK 4 — EXPERIMENT LAYER CONTRACTS
// ==========================================

/**
 * Status lifecycle of a frozen prediction.
 * PENDING → FROZEN (immutable after this point) → VALIDATED | INVALIDATED
 */
export type PredictionStatus = 'PENDING' | 'FROZEN' | 'VALIDATED' | 'INVALIDATED';

/** Type of intervention experiment. */
export type InterventionType = 'ROOT_RELIEF' | 'SYMPTOM_RELIEF';

/**
 * Validation outcome.
 * MATCH:         recoveryAccuracy >= 0.80 AND cascadeCollapseScore >= 0.80
 * PARTIAL_MATCH: recoveryAccuracy >= 0.50 OR  cascadeCollapseScore >= 0.50
 * MISMATCH:      below those thresholds
 * INVALID:       structural issue (no checkpoints, length mismatch, etc.)
 */
export type ValidationStatus = 'MATCH' | 'PARTIAL_MATCH' | 'MISMATCH' | 'INVALID';

/**
 * Observable metrics for one service at one checkpoint.
 * Derived entirely from telemetry — no hidden simulation state.
 */
export interface CheckpointServiceMetrics {
  latencyMs: number;
  queueDepth: number;
  timeoutRate: number;
  retryRate: number;
  resourcePressure: Partial<Record<ResourceType, number>>;
  resourceStatus: Partial<Record<ResourceType, ResourceStatus>>;
}

/**
 * One future checkpoint in the counterfactual prediction.
 * metrics maps serviceId → CheckpointServiceMetrics.
 */
export interface PredictionCheckpoint {
  relativeTick: number;           // ticks from intervention point
  absoluteTick: number;           // absolute simulation tick
  timestampMs: number;            // milliseconds from intervention
  metrics: Record<string, CheckpointServiceMetrics>;
}

/**
 * An expected state transition during predicted recovery.
 * SEMANTICS: fromCondition → toCondition expected within expectedRelativeTick.
 */
export interface PredictedTransition {
  serviceId: string;
  resource?: ResourceType;
  fromCondition: string;          // e.g. "MEMORY CRITICAL"
  toCondition: string;            // e.g. "MEMORY HEALTHY"
  expectedRelativeTick: number;   // ticks from intervention
  confidence: number;             // [0, 1]
}

/**
 * A measurable recovery target for a specific metric.
 * tolerance = ±fraction of target (e.g. 0.15 = ±15% of baselineValue).
 */
export interface RecoveryTarget {
  serviceId: string;
  metricName: string;
  targetValue: number;
  tolerance: number;
  baselineValue: number;
}

/**
 * A frozen counterfactual prediction.
 *
 * IMPORTANT:
 *   - Generated BEFORE intervention.
 *   - status becomes FROZEN immediately after creation.
 *   - After FROZEN, checkpoints/transitions/targets are immutable.
 *   - Contains NO hidden ground truth (no trueRoot, injectedRoot, targetSeverity).
 *   - Produced by: model-based counterfactual simulation from observable state.
 */
export interface CounterfactualPrediction {
  predictionId: string;
  status: PredictionStatus;
  createdAtTick: number;
  horizonTicks: number;
  tickDurationMs: number;
  rootCandidateId: string;        // from CausalHypothesis.candidateId
  rootServiceId: string;
  rootResource: ResourceType;
  confidenceAtPrediction: number; // from CausalHypothesis.confidence at prediction time
  checkpoints: PredictionCheckpoint[];
  predictedTransitions: PredictedTransition[];
  recoveryTargets: RecoveryTarget[];
  assumptions: string[];          // human-readable; no ground truth
  modelVersion: string;           // e.g. "counterfactual-fork-v1"
}

/**
 * A structured intervention action.
 * Targets ONLY the selected service/resource; leaves all others unchanged.
 * Contains no hidden ground truth.
 */
export interface InterventionAction {
  interventionId: string;
  interventionType: InterventionType;
  targetServiceId: string;
  targetResource: ResourceType;
  actionType: 'RELIEVE_RESOURCE';
  appliedAtTick: number;
  timestampMs: number;
  predictionId: string;
  preInterventionSnapshotTick: number;
}

/**
 * Observed metrics at one checkpoint in the actual post-intervention trajectory.
 */
export interface ActualCheckpoint {
  relativeTick: number;
  absoluteTick: number;
  timestampMs: number;
  metrics: Record<string, CheckpointServiceMetrics>;
}

/**
 * The captured actual trajectory after an intervention.
 * Derived from live simulation telemetry — not generated from the prediction.
 */
export interface ActualInterventionTrajectory {
  interventionId: string;
  predictionId: string;
  startTick: number;
  endTick: number;
  checkpoints: ActualCheckpoint[];
}

/**
 * Error between predicted and actual for a single metric at one checkpoint.
 * absoluteError = |actual - predicted|
 * relativeError = |actual - predicted| / max(|predicted|, 1)
 */
export interface MetricError {
  serviceId: string;
  metricName: string;
  relativeTick: number;
  predictedValue: number;
  actualValue: number;
  absoluteError: number;
  relativeError: number;
}

/**
 * A measurable milestone in the actual recovery.
 * achieved = true if the metric crossed its target within the horizon.
 */
export interface RecoveryMilestone {
  description: string;
  achievedAtRelativeTick: number | null;  // null if not achieved within horizon
  targetRelativeTick: number;
  achieved: boolean;
}

/**
 * Full validation result comparing FROZEN PREDICTION against ACTUAL TRAJECTORY.
 *
 * Recovery Accuracy:
 *   Mean of (1 - min(relError, 1)) for each key metric × checkpoint pair.
 *   Range: [0, 1].
 *
 * Cascade Collapse Score:
 *   Weighted mean of:
 *     - root pressure drop fraction
 *     - root latency drop fraction
 *     - downstream queue drain fraction (fraction of downstream services near-zero queue)
 *     - downstream latency recovery fraction (below 1.5× baseline)
 *     - timeout recovery fraction
 *     - retry recovery fraction
 *   Range: [0, 1].
 *
 * Validation Thresholds (see PredictorConfig):
 *   MATCH:         recoveryAccuracy >= 0.80 AND cascadeCollapseScore >= 0.80
 *   PARTIAL_MATCH: recoveryAccuracy >= 0.50 OR  cascadeCollapseScore >= 0.50
 *   MISMATCH:      otherwise
 *   INVALID:       structural error
 */
export interface InterventionValidationResult {
  predictionId: string;
  interventionId: string;
  interventionType: InterventionType;
  target: string;                       // candidateId, e.g. "records/MEMORY"
  metricErrors: MetricError[];
  recoveryAccuracy: number;
  cascadeCollapseScore: number;
  validationStatus: ValidationStatus;
  milestones: RecoveryMilestone[];
  explanation: string;
}

// ==========================================
// 8. BLOCK 5 ORCHESTRATION CONTRACTS
// ==========================================

export type IncidentSessionStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'ANALYZING'
  | 'PREDICTION_LOCKED'
  | 'EXPERIMENT_RUNNING'
  | 'VALIDATED'
  | 'COMPLETED'
  | 'ERROR';

export interface PlaybackState {
  isRunning: boolean;
  speed: number;
  tick: number;
  timestamp: number;
}

/**
 * The canonical state object sent to the frontend.
 * GUARANTEE: This object must NEVER contain hidden ground truth.
 */
export interface IncidentEvidenceBundle {
  incidentId: string;
  sessionId: string;
  scenarioId: string;
  status: IncidentSessionStatus;
  createdAt: number;
  playback: PlaybackState;

  // Block 2: Observation
  dependencyGraph: DependencyGraph | null;
  currentTelemetry: TelemetryTick | null;
  telemetryHistory: TelemetryTick[];
  events: ObservableSystemEvent[];

  // Block 3: Analysis
  causalAnalysis: CausalAnalysisResult | null;

  // Block 4: Prediction & Validation
  prediction: CounterfactualPrediction | null;
  rootTrajectory: ActualInterventionTrajectory | null;
  rootValidation: InterventionValidationResult | null;
  symptomTrajectory: ActualInterventionTrajectory | null;
  symptomValidation: InterventionValidationResult | null;
  experimentLog: ExperimentEvent[];

  // Block 8: Remedy Lab
  remedyProposals?: RemedyProposal[];
  remedySimulations?: Record<string, RemedySimulationResult>;
  selectedRemedyId?: string | null;
}

// ==========================================
// 9. BLOCK 8 — REMEDY LAB CONTRACTS
// ==========================================

export type RemedyCategory = 'MITIGATE' | 'FIX' | 'PREVENT';

export type RemedyAction =
  | 'RELIEVE_RESOURCE'
  | 'ADJUST_CAPACITY'
  | 'REDUCE_RETRY_PRESSURE'
  | 'RATE_LIMIT'
  | 'SHED_LOAD'
  | 'ADVISORY';

export interface RemedyProposal {
  id: string;
  category: RemedyCategory;
  title: string;
  description: string;
  targetService?: string;
  targetResource?: ResourceType;
  action: RemedyAction;
  parameters: Record<string, any>;
  rationale: string;
  evidenceReferences: string[];
  expectedBenefit?: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  simulatable: boolean;
}

export interface RemedySimulationPoint {
  tick: number;
  relativeTick: number;
  rootPressure: number;
  rootLatency: number;
  downstreamLatency: number;
  queueDepth: number;
  timeoutRate: number;
  retryRate: number;
  baselineRootPressure?: number;
  baselineRootLatency?: number;
  baselineQueueDepth?: number;
  baselineTimeoutRate?: number;
}

export interface RemedySimulationResult {
  remedyId: string;
  simulatedAtTick: number;
  horizonTicks: number;
  effectivenessScore: number; // [0, 100] calculated deterministically
  pressureReduction: number;   // [0, 1]
  latencyReduction: number;    // [0, 1]
  timeoutReduction: number;    // [0, 1]
  queueDrainScore: number;     // [0, 1]
  trajectory: RemedySimulationPoint[];
  summary: string;
}

export interface RemedyComparison {
  incidentId: string;
  baselineTrajectory: RemedySimulationPoint[];
  remedySimulations: RemedySimulationResult[];
  recommendedRemedyId?: string;
}

export interface GroundTruthReveal {
  incidentId: string;
  revealedAt: number;
  trueRootService: string;
  trueRootResource: ResourceType;
  injectedSeverity: number;
  injectionTick: number;
  cascadePath: string[]; // List of service IDs in propagation order
}

export interface ApiErrorResponse {
  errorCode: string;
  message: string;
  details?: any;
}

// WebSocket Envelope
export interface IncidentWsEvent<T = any> {
  type: string;
  incidentId: string;
  sequence: number;
  tick: number;
  timestamp: number;
  payload: T;
}


/**
 * Experiment lifecycle events. No hidden ground truth is exposed.
 */
export type ExperimentEventType =
  | 'PREDICTION_CREATED'
  | 'PREDICTION_FROZEN'
  | 'INTERVENTION_STARTED'
  | 'INTERVENTION_COMPLETED'
  | 'VALIDATION_STARTED'
  | 'VALIDATION_COMPLETED';

export interface ExperimentEvent {
  type: ExperimentEventType;
  tick: number;
  timestampMs: number;
  predictionId?: string;
  interventionId?: string;
  summary: string;
}

// ==========================================
// LEGACY ALIASES (backward compat)
// ==========================================

export interface EvidenceRow {
  description: string;
  isSupporting: boolean;
  scoreImpact: number;
}

export interface RankedCandidate {
  serviceId: string;
  resourceId: string;
  score: number;
  evidenceMatrix: EvidenceRow[];
}

// ==========================================
// FIX STATION CONTRACTS
// ==========================================

export type FixType = 
  | 'CODE'
  | 'CONFIGURATION'
  | 'INFRASTRUCTURE'
  | 'DATABASE'
  | 'OPERATIONAL'
  | 'ARCHITECTURE'
  | 'COMBINATION';

export interface FixSolution {
  id: string;
  fixType: FixType;
  title: string;
  summary: string;
  targetService: string;
  targetResource?: ResourceType;
  explanation: string;
  isCodeFix: boolean;
  codeDiff?: string;
  codeSnippet?: string;
  filePath?: string;
  configuration?: string;
  configFormat?: 'yaml' | 'json' | 'env' | 'toml';
  infrastructure?: string;
  commands?: string[];
  architectureNotes?: string;
  operationalSteps?: string[];
  verificationSteps: string[];
  whyThisFix: string;
  iterationIndex: number;
}

export interface FixAttempt {
  attemptNumber: number;
  timestamp: number;
  solution: FixSolution;
  status: 'READY' | 'APPLIED' | 'FAILED' | 'VERIFIED';
  userFeedback?: string;
  failureAnalysis?: string;
}

export interface FixStationState {
  incidentId: string;
  recommendedRemedy?: RemedyProposal;
  currentSolution?: FixSolution;
  history: FixAttempt[];
  verificationResult?: {
    status: 'VERIFIED' | 'FAILED';
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>;
  };
}

export interface ObservableIncidentData {
  dependencyGraph: DependencyGraph;
  telemetry: TelemetryTick[];
  events: ObservableSystemEvent[];
}




