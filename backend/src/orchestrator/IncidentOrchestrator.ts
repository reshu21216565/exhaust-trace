import { SimulationWorld, DefaultConfig, SimulationConfig } from '@exhausttrace/simulation';
import { ObservationAdapter, ObservationHistory } from '@exhausttrace/observation';
import { CausalAnalyzer } from '@exhausttrace/analysis';
import { CounterfactualPredictionEngine, InterventionRunner, InterventionValidator, DEFAULT_PREDICTOR_CONFIG } from '@exhausttrace/prediction';
import {
  IncidentSessionStatus,
  PlaybackState,
  IncidentEvidenceBundle,
  GroundTruthReveal,
  IncidentWsEvent,
  CausalHypothesis,
  ResourceType,
  CheckpointServiceMetrics
} from '@exhausttrace/shared';

type EventPublisher = (event: IncidentWsEvent) => void;

export class IncidentOrchestrator {
  private status: IncidentSessionStatus = 'IDLE';
  private incidentId: string = '';
  private sessionId: string = '';
  private scenarioId: string = '';
  private createdAt: number = 0;
  private initialSeed: string = '';
  private playback: PlaybackState = { isRunning: false, speed: 1, tick: 0, timestamp: 0 };
  
  // Engines
  private world: SimulationWorld | null = null;
  private observer: ObservationAdapter | null = null;
  private history: ObservationHistory | null = null;
  private analyzer: CausalAnalyzer | null = null;

  // Cached state
  private baseCapacities: Record<string, number> = {};
  private baseLatencies: Record<string, number> = {};
  private baselineMetrics: Record<string, CheckpointServiceMetrics> = {};

  // Block 4 State
  private predictionEngine: CounterfactualPredictionEngine = new CounterfactualPredictionEngine();
  private interventionRunner: InterventionRunner = new InterventionRunner();
  private validator: InterventionValidator = new InterventionValidator();
  
  private bundle: Omit<IncidentEvidenceBundle, 'incidentId' | 'sessionId' | 'scenarioId' | 'status' | 'createdAt' | 'playback'> = this.emptyBundle();
  
  // Snapshots
  private preInterventionSnapshot: string | null = null;
  private trueInjectedRoot: { serviceId: string; resourceId: ResourceType; severity: number } | null = null;
  private pendingCustomInjection: { serviceId: string; resourceId: ResourceType; severity: string } | null = null;

  // Event sequence
  private sequence: number = 1;
  private publisher: EventPublisher | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  // Validation metrics mapping helper
  private tickToMetrics(tickData: any): Record<string, CheckpointServiceMetrics> {
    const m: Record<string, CheckpointServiceMetrics> = {};
    for (const svc of tickData.services) {
      const resources = svc.resources as any;
      m[svc.serviceId] = {
        latencyMs: svc.metrics.latencyMs,
        queueDepth: svc.metrics.queueDepth,
        timeoutRate: svc.metrics.timeoutRate,
        retryRate: svc.metrics.retryRate,
        resourcePressure: {
          CPU: resources.CPU.pressure,
          MEMORY: resources.MEMORY.pressure,
          CONNECTIONS: resources.CONNECTIONS.pressure,
          WORKERS: resources.WORKERS.pressure
        },
        resourceStatus: {
          CPU: resources.CPU.status,
          MEMORY: resources.MEMORY.status,
          CONNECTIONS: resources.CONNECTIONS.status,
          WORKERS: resources.WORKERS.status
        }
      };
    }
    return m;
  }

  constructor(publisher?: EventPublisher) {
    this.publisher = publisher || (() => {});
  }

  private emptyBundle() {
    return {
      dependencyGraph: null,
      currentTelemetry: null,
      telemetryHistory: [],
      events: [],
      causalAnalysis: null,
      prediction: null,
      rootTrajectory: null,
      rootValidation: null,
      symptomTrajectory: null,
      symptomValidation: null,
      experimentLog: []
    };
  }

  public setPublisher(publisher: EventPublisher) {
    this.publisher = publisher;
  }

  private emit<T>(type: string, payload: T) {
    if (!this.publisher) return;
    this.publisher({
      type,
      incidentId: this.incidentId,
      sequence: this.sequence++,
      tick: this.playback.tick,
      timestamp: this.playback.timestamp,
      payload
    });
  }

  private setStatus(newStatus: IncidentSessionStatus) {
    this.status = newStatus;
    this.emit('incident:state', this.getBundle());
  }

  public startScenario(scenarioId: string, seed: string = `seed-${Date.now()}`) {
    this.stopLoop();
    this.incidentId = `inc-${Date.now()}`;
    this.sessionId = `ses-${Date.now()}`;
    this.scenarioId = scenarioId;
    this.initialSeed = seed;
    this.createdAt = Date.now();
    this.sequence = 1;
    this.bundle = this.emptyBundle();
    this.trueInjectedRoot = null;
    
    this.world = new SimulationWorld(seed, DefaultConfig);
    this.observer = new ObservationAdapter();
    this.history = new ObservationHistory(this.observer.extractDependencyGraph(this.world));
    this.analyzer = new CausalAnalyzer();
    this.bundle.dependencyGraph = this.observer.extractDependencyGraph(this.world);
    
    this.baseCapacities = {};
    this.baseLatencies = {};
    this.world.nodes.forEach((node, sid) => {
      this.baseCapacities[sid] = node.state.params.baseCapacity;
      this.baseLatencies[sid] = node.state.params.baseLatency;
    });
    this.baselineMetrics = {};

    this.playback = { isRunning: false, speed: 1, tick: 0, timestamp: 0 };
    this.setStatus('RUNNING');
    
    // Incident injection is now deferred to tick 15 in tickSimulation to show healthy state first
    
    this.emit('incident:state', this.getBundle());
    this.resume();
  }

  public startCustomScenario(serviceId: string, resourceId: ResourceType, severity: string, seed: string = `seed-${Date.now()}`) {
    this.pendingCustomInjection = { serviceId, resourceId, severity };
    this.startScenario('custom_exhaustion', seed);
  }

  public reset() {
    if (this.status === 'EXPERIMENT_RUNNING') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Cannot reset during an active experiment' };
    }
    this.stopLoop();
    this.startScenario(this.scenarioId, this.initialSeed); // Deterministic replay with original seed
  }

  public pause() {
    this.stopLoop();
    this.playback.isRunning = false;
    this.setStatus('PAUSED');
  }

  public resume() {
    if (!this.world) throw { errorCode: 'SESSION_NOT_FOUND', message: 'Session not initialized' };
    if (this.status === 'EXPERIMENT_RUNNING' || this.status === 'VALIDATED') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Cannot resume simulation in current state' };
    }
    if (this.playback.isRunning) return;
    this.playback.isRunning = true;
    if (this.status === 'PAUSED') this.setStatus('RUNNING');
    this.startLoop();
  }

  public step() {
    if (!this.world) throw { errorCode: 'SESSION_NOT_FOUND', message: 'Session not initialized' };
    if (this.playback.isRunning) throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Cannot step while running' };
    this.tickSimulation();
  }

  public setSpeed(speed: number) {
    if (![0.25, 0.5, 1, 2, 4, 8].includes(speed)) throw { errorCode: 'INVALID_SPEED', message: 'Unsupported speed' };
    this.playback.speed = speed;
    if (this.playback.isRunning) {
      this.stopLoop();
      this.startLoop();
    }
    this.emit('incident:state', this.getBundle());
  }

  private startLoop() {
    const msPerTick = DefaultConfig.tickDurationMs / this.playback.speed;
    this.intervalId = setInterval(() => {
      this.tickSimulation();
    }, msPerTick);
  }

  private stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private maybeRefreshPrediction() {
    if (this.status === 'PREDICTION_LOCKED' || this.status === 'EXPERIMENT_RUNNING' || this.status === 'VALIDATED' || this.status === 'COMPLETED') {
      return;
    }

    const topCandidate = this.bundle.causalAnalysis?.topCandidate;
    if (!topCandidate) return;

    // Avoid freezing a low-confidence, early hypothesis. Keep the draft prediction
    // aligned with the latest analysis result instead of creating exactly one stale
    // prediction from the first weak signal.
    const minConfidence = 0.10;
    const shouldRefresh =
      !this.bundle.prediction ||
      this.bundle.prediction.rootCandidateId !== topCandidate.candidateId ||
      this.bundle.prediction.confidenceAtPrediction <= minConfidence && topCandidate.confidence > minConfidence ||
      Math.abs(this.bundle.prediction.confidenceAtPrediction - topCandidate.confidence) > 0.05;

    if (!shouldRefresh || topCandidate.confidence <= minConfidence) return;

    this.bundle.prediction = this.predictionEngine.predict(
      topCandidate,
      this.world!,
      this.baselineMetrics,
      this.bundle.experimentLog
    );
    this.emit('prediction:available', this.bundle.prediction);
  }

  private tickSimulation() {
    if (!this.world || !this.observer || !this.history || !this.analyzer) return;
    this.world.tick();
    this.playback.tick = this.world.clock.currentTick;
    this.playback.timestamp = this.world.clock.timestamp;

    if (this.playback.tick === 15 && this.scenarioId === 'default_exhaustion') {
      this.world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
      this.trueInjectedRoot = { serviceId: 'records', resourceId: 'MEMORY', severity: 1 };
    }

    if (this.playback.tick === 15 && this.pendingCustomInjection) {
      const custom = this.pendingCustomInjection;
      this.world.injectExhaustion(custom.serviceId, custom.resourceId, custom.severity);
      this.trueInjectedRoot = { serviceId: custom.serviceId, resourceId: custom.resourceId, severity: 1 };
      this.pendingCustomInjection = null;
    }
    
    const tickData = this.observer.extractObservableTelemetry(this.world);
    const events = this.observer.generateEvents(tickData, this.bundle.dependencyGraph!, this.baseCapacities, this.baseLatencies);
    
    this.history.appendTelemetry(tickData);
    this.history.appendEvents(events);
    
    // Capture baseline in early ticks
    if (this.playback.tick <= 5) {
      this.baselineMetrics = this.tickToMetrics(tickData);
    }

    this.bundle.currentTelemetry = tickData;
    // Bounded history to 100 ticks
    this.bundle.telemetryHistory.push(tickData);
    if (this.bundle.telemetryHistory.length > 100) this.bundle.telemetryHistory.shift();
    
    this.bundle.events.push(...events);
    // Bounded events to 500
    if (this.bundle.events.length > 500) this.bundle.events.splice(0, this.bundle.events.length - 500);

    this.emit('telemetry:tick', tickData);
    if (events.length > 0) {
      for (const e of events) {
        this.emit('incident:event', e);
      }
    }

    // Analysis is updated every 10 ticks or so to not overload
    if (this.playback.tick > 10 && this.playback.tick % 5 === 0 && this.status !== 'PREDICTION_LOCKED' && this.status !== 'EXPERIMENT_RUNNING') {
      const bundle = this.history.getObservableBundle();
      this.bundle.causalAnalysis = this.analyzer.analyze(bundle);
      this.emit('analysis:updated', this.bundle.causalAnalysis);
      this.maybeRefreshPrediction();
    }
  }

  public lockPrediction() {
    if (!this.bundle.prediction) throw { errorCode: 'PREDICTION_NOT_READY', message: 'No prediction exists' };
    if (this.status === 'PREDICTION_LOCKED' || this.status === 'EXPERIMENT_RUNNING' || this.status === 'VALIDATED') {
      throw { errorCode: 'PREDICTION_ALREADY_LOCKED', message: 'Prediction is already locked' };
    }
    
    this.pause(); // Automatically pause simulation when locking prediction
    this.setStatus('PREDICTION_LOCKED');
    
    // Capture the pre-intervention snapshot so experiments are isolated
    this.preInterventionSnapshot = this.world!.createSnapshot();
    
    this.emit('prediction:locked', this.bundle.prediction);
    return this.bundle.prediction;
  }

  public runRootExperiment() {
    if (this.status !== 'PREDICTION_LOCKED') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Must lock prediction before running experiments' };
    }
    if (this.bundle.rootTrajectory) {
       throw { errorCode: 'EXPERIMENT_ALREADY_RUNNING', message: 'Root experiment already executed' };
    }
    
    this.setStatus('EXPERIMENT_RUNNING');
    const action = InterventionRunner.buildRootAction(this.bundle.prediction!, this.world!);
    
    this.emit('experiment:started', { type: 'ROOT', action });
    
    this.bundle.rootTrajectory = this.interventionRunner.run(
      action,
      this.world!,
      DEFAULT_PREDICTOR_CONFIG.horizonTicks,
      DEFAULT_PREDICTOR_CONFIG.checkpointInterval,
      this.bundle.experimentLog
    );
    
    this.emit('experiment:completed', { type: 'ROOT', trajectory: this.bundle.rootTrajectory });
    
    this.bundle.rootValidation = this.validator.validate(
      this.bundle.prediction!,
      this.bundle.rootTrajectory,
      this.baselineMetrics,
      action,
      this.bundle.experimentLog
    );
    
    this.emit('validation:updated', { type: 'ROOT', validation: this.bundle.rootValidation });
    this.setStatus('VALIDATED');
    return this.bundle.rootValidation;
  }

  public runSymptomExperiment(symptomServiceId: string, symptomResource: ResourceType) {
    if (this.status !== 'VALIDATED' && this.status !== 'PREDICTION_LOCKED') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Invalid state for symptom experiment' };
    }
    if (!this.preInterventionSnapshot) {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Missing pre-intervention snapshot' };
    }
    
    this.setStatus('EXPERIMENT_RUNNING');
    
    // Restore to EXACT pre-intervention snapshot
    this.world!.restoreSnapshot(this.preInterventionSnapshot);
    
    const action = InterventionRunner.buildSymptomAction(
      this.bundle.prediction!,
      symptomServiceId,
      symptomResource,
      this.world!
    );
    
    this.emit('experiment:started', { type: 'SYMPTOM', action });
    
    this.bundle.symptomTrajectory = this.interventionRunner.run(
      action,
      this.world!,
      DEFAULT_PREDICTOR_CONFIG.horizonTicks,
      DEFAULT_PREDICTOR_CONFIG.checkpointInterval,
      this.bundle.experimentLog
    );
    
    this.emit('experiment:completed', { type: 'SYMPTOM', trajectory: this.bundle.symptomTrajectory });
    
    this.bundle.symptomValidation = this.validator.validate(
      this.bundle.prediction!,
      this.bundle.symptomTrajectory,
      this.baselineMetrics,
      action,
      this.bundle.experimentLog
    );
    
    this.emit('validation:updated', { type: 'SYMPTOM', validation: this.bundle.symptomValidation });
    this.setStatus('VALIDATED');
    return this.bundle.symptomValidation;
  }

  public revealGroundTruth(): GroundTruthReveal {
    if (this.status !== 'VALIDATED') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Cannot reveal ground truth before experiments are validated' };
    }
    const root = this.trueInjectedRoot ?? this.world?.injectedRoot;
    if (!this.world || !root) {
      throw { errorCode: 'NO_GROUND_TRUTH', message: 'No incident was injected' };
    }
    
    const reveal = {
      incidentId: this.incidentId,
      revealedAt: Date.now(),
      trueRootService: root.serviceId,
      trueRootResource: root.resourceId as ResourceType,
      injectedSeverity: root.severity,
      injectionTick: 0,
      cascadePath: []
    };
    return reveal;
  }

  public completeIncident() {
    if (this.status !== 'VALIDATED') {
      throw { errorCode: 'INVALID_STATE_TRANSITION', message: 'Cannot complete before experiments are validated' };
    }
    this.setStatus('COMPLETED');
    this.emit('incident:completed', { completedAt: Date.now() });
  }

  public getBundle(): IncidentEvidenceBundle {
    return {
      incidentId: this.incidentId,
      sessionId: this.sessionId,
      scenarioId: this.scenarioId,
      status: this.status,
      createdAt: this.createdAt,
      playback: this.playback,
      ...this.bundle
    };
  }
}
