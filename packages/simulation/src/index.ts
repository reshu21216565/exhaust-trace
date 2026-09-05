export * from './config';
export * from './ServiceNode';
export * from './SimulationWorld';

// ==========================================
// 1. DETERMINISTIC RNG
// ==========================================

export interface DeterministicRNG {
  seed: string;
  random(): number; // Returns 0.0 - 1.0 deterministically
  randomInt(min: number, max: number): number;
}

export class RNG implements DeterministicRNG {
  public seed: string;
  public state: number;

  constructor(seed: string) {
    this.seed = seed;
    // Simple hash for seed
    this.state = 0;
    for (let i = 0; i < seed.length; i++) {
      this.state = Math.imul(31, this.state) + seed.charCodeAt(i) | 0;
    }
  }

  random(): number {
    // Simple LCG for deterministic math
    this.state = (this.state * 1664525 + 1013904223) | 0;
    const res = (this.state >>> 0) / 4294967296;
    return res;
  }

  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
}

// ==========================================
// 2. SIMULATION CLOCK
// ==========================================

export interface SimulationClock {
  currentTick: number;
  timestamp: number;
  tickDurationMs: number;
  advance(): void;
  reset(): void;
}

export class Clock implements SimulationClock {
  public currentTick: number = 0;
  public timestamp: number = 0;
  
  constructor(public tickDurationMs: number = 100) {}

  advance(): void {
    this.currentTick++;
    this.timestamp += this.tickDurationMs;
  }

  reset(): void {
    this.currentTick = 0;
    this.timestamp = 0;
  }
}

// ==========================================
// 3. INJECTED EXHAUSTION
// ==========================================

export interface InjectedExhaustion {
  serviceId: string;
  resourceId: string;
  severity: number;
}
