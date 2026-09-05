import { SimulationWorld } from '../packages/simulation/src/index';

function formatState(world: SimulationWorld, stage: string) {
  const records = world.nodes.get('records')!.state;
  const appt = world.nodes.get('appointment')!.state;
  const portal = world.nodes.get('portal')!.state;
  
  return `| ${stage} | ${(records.resources['MEMORY'].utilization * 100).toFixed(1)}% | ${records.latency.toFixed(0)} | ${records.queueDepth.toFixed(0)} | ${appt.timeoutRate.toFixed(1)} | ${appt.retryRate.toFixed(1)} | ${appt.latency.toFixed(0)} | ${appt.queueDepth.toFixed(0)} | ${portal.latency.toFixed(0)} | ${portal.queueDepth.toFixed(0)} |`;
}

console.log("=== SECTION 12: RECOVERY CONVERGENCE ===");
const w1 = new SimulationWorld('seed-conv');
for(let i=0; i<300; i++) w1.tick();
w1.injectExhaustion('records', 'MEMORY', 'CRITICAL');
for(let i=0; i<600; i++) w1.tick();
w1.relieveExhaustion('records', 'MEMORY');

console.log("| Stage | RecMem | RecLat | RecQ | ApptTO | ApptRet | ApptLat | ApptQ | PortLat | PortQ |");
for(let i=10; i<=200; i+=10) {
  for(let j=0; j<100; j++) w1.tick();
  console.log(formatState(w1, `${i}s`));
  if (i === 120) {
    // Print steady state
  }
}

console.log("\n=== SECTION 13: MULTIPLE ROOT RESOURCES ===");
const resources = ['MEMORY', 'CPU', 'CONNECTIONS', 'WORKERS'] as const;
for (const res of resources) {
  const w = new SimulationWorld(`seed-${res}`);
  for(let i=0; i<300; i++) w.tick();
  w.injectExhaustion('records', res, 'CRITICAL');
  for(let i=0; i<600; i++) w.tick();
  
  const rec = w.nodes.get('records')!.state;
  const appt = w.nodes.get('appointment')!.state;
  const port = w.nodes.get('portal')!.state;
  
  console.log(`Resource: ${res}`);
  console.log(`  Max Root Util: ${(rec.resources[res].utilization * 100).toFixed(1)}%`);
  console.log(`  Max Root Queue: ${rec.queueDepth.toFixed(0)}`);
  console.log(`  Max Appt Latency: ${appt.latency.toFixed(0)} ms`);
  console.log(`  Max Portal Latency: ${port.latency.toFixed(0)} ms`);
  
  w.relieveExhaustion('records', res);
  for(let i=0; i<600; i++) w.tick();
  console.log(`  Recovered Root Util: ${(w.nodes.get('records')!.state.resources[res].utilization * 100).toFixed(1)}%`);
}

console.log("\n=== SECTION 14: NOISY SIGNAL TEST ===");
const w2 = new SimulationWorld('seed-noise');
let notifCpuMax = 0;
for(let i=0; i<1000; i++) {
  w2.tick();
  const notifCpu = w2.nodes.get('notification')!.state.resources['CPU'].utilization;
  if (notifCpu > notifCpuMax) notifCpuMax = notifCpu;
}
console.log(`Notification Max CPU Noise: ${(notifCpuMax * 100).toFixed(1)}%`);
console.log(`Notification Latency: ${w2.nodes.get('notification')!.state.latency.toFixed(0)} ms`);

console.log("\n=== SECTION 15: SYMPTOM INTERVENTION ===");
const w3 = new SimulationWorld('seed-symptom');
for(let i=0; i<300; i++) w3.tick();
w3.injectExhaustion('records', 'MEMORY', 'CRITICAL');
for(let i=0; i<600; i++) w3.tick();

// Experiment B: Relieve Appointment Workers instead of Records Memory
console.log("Before Symptom Intervention:");
console.log(formatState(w3, 'Peak'));

// To simulate symptom intervention, we force Appointment workers down
w3.injectExhaustion('appointment', 'WORKERS', 'NONE'); // Force to NONE severity target

for(let i=0; i<200; i++) w3.tick();
console.log("After Symptom Intervention (20s):");
console.log(formatState(w3, 'Symptom Relief'));

const w4 = new SimulationWorld('seed-symptom-root');
for(let i=0; i<300; i++) w4.tick();
w4.injectExhaustion('records', 'MEMORY', 'CRITICAL');
for(let i=0; i<600; i++) w4.tick();
w4.relieveExhaustion('records', 'MEMORY');
for(let i=0; i<200; i++) w4.tick();
console.log("After True Root Intervention (20s):");
console.log(formatState(w4, 'Root Relief'));

