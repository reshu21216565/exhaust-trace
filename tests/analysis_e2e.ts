/**
 * Block 3 E2E Demo — Causal Analysis of Records/MEMORY Cascade
 * Runs 100 ticks, injects exhaustion at tick 10, then runs causal analysis.
 */

import { SimulationWorld, DefaultConfig } from '../packages/simulation/src/index';
import { ObservationAdapter, ObservationHistory } from '../packages/observation/src/index';
import { CausalAnalyzer } from '../packages/analysis/src/index';

const world = new SimulationWorld('demo-seed', DefaultConfig);
const adapter = new ObservationAdapter();
const graph = adapter.extractDependencyGraph(world);
const history = new ObservationHistory(graph);

const baseLatencies: Record<string, number> = {};
const baseCapacities: Record<string, number> = {};
world.state.services.forEach((s, sid) => {
  baseLatencies[sid] = s.params.baseLatency;
  baseCapacities[sid] = s.params.baseCapacity;
});

const TOTAL_TICKS = 100;
const INJECT_AT = 10;
const RELIEVE_AT = 70;

for (let i = 0; i < TOTAL_TICKS; i++) {
  if (i === INJECT_AT) {
    console.log(`\n[TICK ${i}] Injecting Records/MEMORY/CRITICAL (hidden from analyzer)`);
    world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
  }
  if (i === RELIEVE_AT) {
    console.log(`[TICK ${i}] Relieving exhaustion (hidden from analyzer)`);
    world.relieveExhaustion('records', 'MEMORY');
  }
  world.tick();
  const tick = adapter.extractObservableTelemetry(world);
  const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
  history.appendTelemetry(tick);
  history.appendEvents(events);
}

const bundle = history.getObservableBundle();

console.log('\n=== OBSERVABLE BUNDLE ===');
console.log(`Ticks: ${bundle.telemetry.length}, Events: ${bundle.events.length}`);
const evTypes: Record<string, number> = {};
for (const e of bundle.events) evTypes[e.type] = (evTypes[e.type] || 0) + 1;
console.log('Event types:', evTypes);

console.log('\n=== RUNNING CAUSAL ANALYSIS (ground-truth free) ===');
const analyzer = new CausalAnalyzer();
const result = analyzer.analyze(bundle);

console.log('\n--- TOP 5 HYPOTHESES ---');
for (const h of result.hypotheses.slice(0, 5)) {
  console.log(`  #${h.rank}: ${h.candidateId.padEnd(25)} score=${h.score.toFixed(1).padStart(5)} confidence=${(h.confidence*100).toFixed(0)}%  firstAbnormal=${h.firstAbnormalTick ?? 'never'}`);
}

console.log('\n--- EVIDENCE FOR TOP CANDIDATE ---');
const top = result.topCandidate!;
console.log(`Candidate: ${top.candidateId}`);
console.log('Supporting:');
for (const e of top.evidence.filter(e => e.isSupporting)) {
  console.log(`  [+${e.scoreImpact.toFixed(1)}] [${e.category}] ${e.description}`);
}
console.log('Contradicting:');
for (const e of top.evidence.filter(e => !e.isSupporting)) {
  console.log(`  [${e.scoreImpact.toFixed(1)}] [${e.category}] ${e.description}`);
}

console.log('\n--- CAUSAL GRAPH ---');
console.log(`Nodes: ${result.causalGraph.nodes.map(n => n.id).join(', ')}`);
for (const e of result.causalGraph.edges) {
  console.log(`  ${e.from} → ${e.to}  [tick ${e.firstObservedTick}] conf=${(e.confidence*100).toFixed(0)}%`);
}

console.log('\n--- PROPAGATION PATH (Top Candidate) ---');
const path = result.reconstructedPaths[0];
if (path) {
  for (const n of path.nodes) {
    console.log(`  [tick ${n.firstObservedTick}] ${n.serviceId}: ${n.observedCondition}`);
  }
}

console.log('\n--- CONFIDENCE HISTORY ---');
for (const snap of result.confidenceHistory) {
  const topId = snap.topCandidateId;
  const topScore = snap.topCandidateScore.toFixed(1);
  console.log(`  tick=${snap.tick.toString().padStart(4)}: top=${topId} (${topScore})`);
}

console.log(`\nIncident detected: ${result.incidentDetected}`);
console.log(`Analyzed through tick: ${result.analyzedThroughTick}`);
console.log('\n=== BLOCK 3 E2E COMPLETE ===');
