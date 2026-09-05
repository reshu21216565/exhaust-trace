import { SimulationWorld } from '../packages/simulation/src/index';

const world = new SimulationWorld('seed-e2e');
for(let i=0; i<300; i++) world.tick();
world.injectExhaustion('records', 'MEMORY', 'CRITICAL');
for(let i=0; i<560; i++) world.tick();
world.relieveExhaustion('records', 'MEMORY');
for(let i=0; i<400; i++) {
  world.tick();
  if (i % 100 === 0) {
    const r = world.nodes.get('records')!.state;
    console.log(`Tick ${i}: RecQ=${r.queueDepth.toFixed(2)}, RecIn=${r.incomingRate.toFixed(2)}, RecCap=${(r.params.baseCapacity * Math.min(...Object.values(r.resources).map(x=>x.capacity))).toFixed(2)}`);
  }
}
