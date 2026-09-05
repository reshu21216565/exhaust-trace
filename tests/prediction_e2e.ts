/**
 * Block 4 E2E Demo — Predict → Freeze → Intervene → Verify
 *
 * Demonstrates the full experiment pipeline:
 *   1. Incident: Records/MEMORY CRITICAL injection
 *   2. Observation: 80 ticks of cascade
 *   3. Analysis: Block 3 analyzer ranks Records/MEMORY #1
 *   4. Prediction: counterfactual fork generates frozen prediction
 *   5. Root intervention: relieve Records/MEMORY only
 *   6. Actual trajectory: 60 ticks post-intervention
 *   7. Root validation: compare FROZEN vs ACTUAL
 *   8. Symptom experiment: reset, relieve Appointment/WORKERS instead
 *   9. Symptom validation: compare cascade collapse scores
 */

import { SimulationWorld, DefaultConfig } from '../packages/simulation/src/index';
import { ObservationAdapter, ObservationHistory } from '../packages/observation/src/index';
import { CausalAnalyzer } from '../packages/analysis/src/index';
import { ExperimentOrchestrator } from '../packages/prediction/src/index';
import { CheckpointServiceMetrics, ResourceType } from '../packages/shared/src/index';

const SEED = 'e2e-demo-seed';
const INJECT_AT = 10;
const OBSERVE_TICKS = 80;

console.log('='.repeat(65));
console.log('EXHAUSTTRACE BLOCK 4 E2E DEMO');
console.log('='.repeat(65));

// ---- Build incident scenario ----
const world = new SimulationWorld(SEED, DefaultConfig);
const adapter = new ObservationAdapter();
const graph = adapter.extractDependencyGraph(world);
const history = new ObservationHistory(graph);

const baseLatencies: Record<string, number> = {};
const baseCapacities: Record<string, number> = {};
world.state.services.forEach((s, sid) => {
  baseLatencies[sid] = s.params.baseLatency;
  baseCapacities[sid] = s.params.baseCapacity;
});

const baselineMetrics: Record<string, CheckpointServiceMetrics> = {};

for (let t = 0; t < OBSERVE_TICKS; t++) {
  if (t === INJECT_AT) {
    console.log(`\n[TICK ${t}] INJECTING: records/MEMORY/CRITICAL (hidden from analyzer)`);
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
  }
  world.tick();
  const tick = adapter.extractObservableTelemetry(world);
  const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
  history.appendTelemetry(tick);
  history.appendEvents(events);

  if (t < 5) {
    for (const svc of tick.services) {
      const resources = svc.resources as any;
      baselineMetrics[svc.serviceId] = {
        latencyMs: svc.metrics.latencyMs,
        queueDepth: 0, timeoutRate: 0, retryRate: 0,
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
  }
}

console.log(`\n[TICK ${world.clock.currentTick}] Incident observed. Running Block 3 analysis...`);

// ---- Block 3 analysis ----
const data = history.getObservableBundle();
const analyzer = new CausalAnalyzer();
const analysis = analyzer.analyze(data);
const top = analysis.topCandidate!;

console.log('\n=== BLOCK 3 ANALYSIS ===');
console.log(`  Incident detected: ${analysis.incidentDetected}`);
console.log(`  Top hypothesis: ${top.candidateId}  rank=${top.rank}  score=${top.score.toFixed(1)}  confidence=${(top.confidence*100).toFixed(0)}%`);
console.log('  Top 3:');
for (const h of analysis.hypotheses.slice(0, 3)) {
  console.log(`    #${h.rank} ${h.candidateId.padEnd(25)} score=${h.score.toFixed(1).padStart(5)}`);
}

// ---- Block 4 experiment (orchestrated) ----
console.log('\n=== BLOCK 4: PREDICT → FREEZE → INTERVENE → VERIFY ===');

const orchestrator = new ExperimentOrchestrator({ horizonTicks: 60, checkpointInterval: 10 });

(async () => {
const result = await orchestrator.runExperiment(
  top,
  world,
  baselineMetrics,
  'appointment',
  'WORKERS' as ResourceType
);

// ---- Print prediction ----
const pred = result.prediction;
console.log(`\n--- COUNTERFACTUAL PREDICTION (${pred.predictionId}) ---`);
console.log(`  Status: ${pred.status}`);
console.log(`  Root: ${pred.rootCandidateId}  confidence at prediction: ${(pred.confidenceAtPrediction*100).toFixed(0)}%`);
console.log(`  Horizon: ${pred.horizonTicks} ticks × ${pred.tickDurationMs}ms = ${pred.horizonTicks * pred.tickDurationMs / 1000}s`);
console.log(`  Checkpoints: ${pred.checkpoints.length}`);
console.log(`  Predicted transitions: ${pred.predictedTransitions.length}`);
console.log(`  Recovery targets: ${pred.recoveryTargets.length}`);

console.log('\n  Checkpoint summary (records, appointment):');
for (const cp of pred.checkpoints) {
  const r = cp.metrics['records'];
  const a = cp.metrics['appointment'];
  console.log(`    +${cp.relativeTick.toString().padStart(3)}t | records lat=${r?.latencyMs.toFixed(0).padStart(5)}ms queue=${r?.queueDepth.toFixed(0).padStart(2)} MEMORY=${r?.resourceStatus?.MEMORY} | appt lat=${a?.latencyMs.toFixed(0).padStart(5)}ms`);
}

// ---- Print predicted transitions ----
console.log('\n  Predicted recovery cascade:');
for (const tr of pred.predictedTransitions) {
  console.log(`    ${tr.serviceId}/${tr.resource ?? ''}: "${tr.fromCondition}" → "${tr.toCondition}" by tick +${tr.expectedRelativeTick} (conf=${(tr.confidence*100).toFixed(0)}%)`);
}

// ---- Root intervention result ----
console.log('\n--- ROOT INTERVENTION RESULT ---');
const rv = result.rootValidation;
console.log(`  Intervention: ${result.rootAction.interventionType} on ${result.rootAction.targetServiceId}/${result.rootAction.targetResource}`);
console.log(`  Actual checkpoints: ${result.rootTrajectory.checkpoints.length}`);
console.log(`  Recovery accuracy: ${(rv.recoveryAccuracy * 100).toFixed(1)}%`);
console.log(`  Cascade collapse score: ${(rv.cascadeCollapseScore * 100).toFixed(1)}%`);
console.log(`  Validation status: ${rv.validationStatus}`);
console.log('  Milestones:');
for (const m of rv.milestones) {
  const tick = m.achievedAtRelativeTick !== null ? `+${m.achievedAtRelativeTick}t` : 'NOT ACHIEVED';
  console.log(`    [${m.achieved ? '✓' : '✗'}] ${m.description} (${tick})`);
}

// Print predicted vs actual for records/MEMORY
console.log('\n  Predicted vs Actual (records):');
for (const cp of result.prediction.checkpoints) {
  const pred = cp.metrics['records'];
  const act = result.rootTrajectory.checkpoints.find(c => c.relativeTick === cp.relativeTick)?.metrics['records'];
  if (!pred || !act) continue;
  const latErr = Math.abs(act.latencyMs - pred.latencyMs).toFixed(0);
  console.log(`    +${cp.relativeTick.toString().padStart(3)}t | pred_lat=${pred.latencyMs.toFixed(0).padStart(5)}ms  act_lat=${act.latencyMs.toFixed(0).padStart(5)}ms  err=${latErr}ms  MEMORY=${act?.resourceStatus?.MEMORY}`);
}

// ---- Symptom intervention result ----
if (result.symptomValidation) {
  const sv = result.symptomValidation;
  console.log('\n--- SYMPTOM INTERVENTION RESULT (appointment/WORKERS) ---');
  console.log(`  Recovery accuracy: ${(sv.recoveryAccuracy * 100).toFixed(1)}%`);
  console.log(`  Cascade collapse score: ${(sv.cascadeCollapseScore * 100).toFixed(1)}%`);
  console.log(`  Validation status: ${sv.validationStatus}`);

  const lastActualCp = result.symptomTrajectory!.checkpoints[result.symptomTrajectory!.checkpoints.length - 1];
  const recordsMemStatus = lastActualCp?.metrics['records']?.resourceStatus?.MEMORY;
  const recordsMemPressure = lastActualCp?.metrics['records']?.resourcePressure?.MEMORY;
  console.log(`  Records/MEMORY status at end: ${recordsMemStatus} (pressure=${(recordsMemPressure! * 100).toFixed(1)}%)`);
  console.log(`  → Root remained abnormal: ${recordsMemStatus !== 'HEALTHY' && recordsMemStatus !== 'ELEVATED'}`);

  // Compare cascade collapse
  console.log(`\n  COMPARISON:`);
  console.log(`    Root intervention cascade collapse:    ${(rv.cascadeCollapseScore * 100).toFixed(1)}%`);
  console.log(`    Symptom intervention cascade collapse: ${(sv.cascadeCollapseScore * 100).toFixed(1)}%`);
  console.log(`    Discriminative gap: ${((rv.cascadeCollapseScore - sv.cascadeCollapseScore) * 100).toFixed(1)}pp`);
}

// ---- Event log ----
console.log('\n--- EXPERIMENT EVENT LOG ---');
for (const evt of result.eventLog) {
  console.log(`  [${evt.type.padEnd(25)}] tick=${evt.tick.toString().padStart(3)} — ${evt.summary}`);
}

console.log('\n=== BLOCK 4 E2E COMPLETE ===');
})();
