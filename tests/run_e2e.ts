import { SimulationWorld } from '../packages/simulation/src/index';

const world = new SimulationWorld('seed-e2e');

function logState(stage: string) {
  const records = world.nodes.get('records')!.state;
  const appt = world.nodes.get('appointment')!.state;
  const portal = world.nodes.get('portal')!.state;

  console.log(`| ${stage} | ${(records.resources['MEMORY'].utilization * 100).toFixed(1)}% | ${records.latency.toFixed(0)} ms | ${records.queueDepth.toFixed(0)} | ${appt.timeoutRate.toFixed(1)} | ${appt.retryRate.toFixed(1)} | ${appt.latency.toFixed(0)} ms | ${portal.latency.toFixed(0)} ms |`);
}

console.log('| Stage | Root Resource (Records Mem) | Root Latency | Root Queue | Appt Timeout | Appt Retry | Appointment Latency | Portal Latency |');
console.log('|---|---|---|---|---|---|---|---|');

// Healthy
for(let i=0; i<300; i++) world.tick();
logState('Healthy');

// Inject
world.injectExhaustion('records', 'MEMORY', 'CRITICAL');

// Root pressure
for(let i=0; i<10; i++) world.tick();
logState('Root Pressure');

// Root degradation
for(let i=0; i<50; i++) world.tick();
logState('Root Degradation');

// Cascade
for(let i=0; i<100; i++) world.tick();
logState('Cascade');

// Peak Incident
for(let i=0; i<400; i++) world.tick();
logState('Peak Incident');

// Root intervention
world.relieveExhaustion('records', 'MEMORY');
logState('Root Intervention');

// Recovery
for(let i=0; i<100; i++) world.tick();
logState('Recovery (10s)');

// Recovered
for(let i=0; i<300; i++) world.tick();
logState('Recovered (40s)');
