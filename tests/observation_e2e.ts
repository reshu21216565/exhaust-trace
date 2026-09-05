import { SimulationWorld, DefaultConfig } from '../packages/simulation/src/index';
import { ObservationAdapter, ObservationHistory } from '../packages/observation/src/index';

/**
 * Block 2 E2E Verification
 * Runs a full Records/MEMORY/CRITICAL cascade scenario through the observation layer.
 * Validates ground-truth isolation and prints a sample observable bundle.
 */

console.log('=== BLOCK 2 E2E OBSERVATION VERIFICATION ===\n');

const FORBIDDEN_KEYS = [
  'injectedRoot', 'injectedResource', 'trueRoot', 'trueRootService',
  'trueRootResource', 'AuthoritativeState', 'SimulationWorld', 'intervention'
];

function recursiveScan(obj: any, path: string = ''): string[] {
  const violations: string[] = [];
  if (!obj || typeof obj !== 'object') return violations;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.includes(k)) {
      violations.push(`Found forbidden key "${k}" at path: ${path}.${k}`);
    }
    violations.push(...recursiveScan(obj[k], `${path}.${k}`));
  }
  return violations;
}

const world = new SimulationWorld(DefaultConfig);
const adapter = new ObservationAdapter();
const graph = adapter.extractDependencyGraph(world);
const history = new ObservationHistory(graph);

// Collect base latencies before injection
const baseLatencies: Record<string, number> = {};
const baseCapacities: Record<string, number> = {};
world.state.services.forEach((s, sid) => {
  baseLatencies[sid] = s.params.baseLatency;
  baseCapacities[sid] = s.params.baseCapacity;
});

// Phase 1: Healthy baseline (10 ticks)
console.log('--- Phase 1: Healthy baseline ---');
for (let i = 0; i < 10; i++) {
  world.tick();
  const tick = adapter.extractObservableTelemetry(world);
  const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
  history.appendTelemetry(tick);
  history.appendEvents(events);
}

// Phase 2: Inject Records MEMORY exhaustion (30 ticks)
console.log('--- Phase 2: Injecting Records/MEMORY/CRITICAL ---');
world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
for (let i = 0; i < 50; i++) {
  world.tick();
  const tick = adapter.extractObservableTelemetry(world);
  const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
  history.appendTelemetry(tick);
  history.appendEvents(events);
}

// Phase 3: Relieve and recover (60 ticks)
console.log('--- Phase 3: Relieving exhaustion and recovering ---');
world.relieveExhaustion('records', 'MEMORY');
for (let i = 0; i < 60; i++) {
  world.tick();
  const tick = adapter.extractObservableTelemetry(world);
  const events = adapter.generateEvents(tick, graph, baseCapacities, baseLatencies);
  history.appendTelemetry(tick);
  history.appendEvents(events);
}

// Collect bundle
const bundle = history.getObservableBundle();

console.log('\n=== OBSERVABLE BUNDLE SUMMARY ===');
console.log(`Dependency Graph nodes: ${bundle.dependencyGraph.nodes.map(n => n.id).join(', ')}`);
console.log(`Dependency Graph edges: ${bundle.dependencyGraph.edges.map(e => `${e.from}->${e.to}`).join(', ')}`);
console.log(`Total telemetry ticks: ${bundle.telemetry.length}`);
console.log(`Total events: ${bundle.events.length}`);

// Event breakdown
const eventCounts: Record<string, number> = {};
for (const e of bundle.events) {
  eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
}
console.log('\nEvent type breakdown:');
for (const [type, count] of Object.entries(eventCounts)) {
  console.log(`  ${type}: ${count}`);
}

// Sample output (first tick, a few events)
console.log('\n=== SAMPLE: First telemetry tick ===');
const sampleTick = bundle.telemetry[10]; // After injection starts
const recordsSvc = sampleTick?.services.find(s => s.serviceId === 'records');
if (recordsSvc) {
  console.log(JSON.stringify({
    tick: sampleTick.tick,
    timestamp: sampleTick.timestamp,
    records: {
      resources: {
        MEMORY: recordsSvc.resources.MEMORY
      },
      metrics: {
        latencyMs: recordsSvc.metrics.latencyMs,
        queueDepth: recordsSvc.metrics.queueDepth,
        incomingRate: recordsSvc.metrics.incomingRate
      }
    }
  }, null, 2));
}

console.log('\n=== SAMPLE: First 5 events ===');
console.log(JSON.stringify(bundle.events.slice(0, 5), null, 2));

// Recursive ground-truth security scan
console.log('\n=== GROUND TRUTH SECURITY SCAN ===');
const violations = recursiveScan(bundle);
const serialized = JSON.stringify(bundle);
const stringViolations: string[] = [];
for (const key of FORBIDDEN_KEYS) {
  if (serialized.includes(`"${key}"`)) {
    stringViolations.push(`Serialized JSON contains forbidden key: "${key}"`);
  }
}

const allViolations = [...violations, ...stringViolations];
if (allViolations.length === 0) {
  console.log('forbidden fields scanned:', FORBIDDEN_KEYS.join(', '));
  console.log('matches found: 0');
  console.log('GROUND TRUTH ISOLATION: PASS');
} else {
  console.log('VIOLATIONS FOUND:');
  for (const v of allViolations) {
    console.log(' ', v);
  }
  console.log('GROUND TRUTH ISOLATION: FAIL');
}

console.log('\n=== BLOCK 2 E2E: COMPLETE ===');
