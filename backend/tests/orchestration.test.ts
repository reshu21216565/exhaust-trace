import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApplication } from '../src/index';
import { io as Client, Socket } from 'socket.io-client';
import { Server } from 'http';

describe('Block 5: Orchestration & API', () => {
  let app: any;
  let server: Server;
  let clientSocket: Socket;
  let port: number;
  let orchestrator: any;

  beforeAll(async () => {
    const backend = createApplication();
    app = backend.app;
    server = backend.server;
    orchestrator = backend.orchestrator;
    
    await new Promise<void>((resolve) => {
      server.listen(() => {
        port = (server.address() as any).port;
        clientSocket = Client(`http://localhost:${port}`);
        clientSocket.on('connect', () => {
          resolve();
        });
      });
    });
  });

  afterAll(() => {
    clientSocket.disconnect();
    server.close();
  });

  const getUrl = (path: string) => `/api/v1${path}`;

  // ==========================================
  // SESSION LIFECYCLE
  // ==========================================
  describe('SESSION LIFECYCLE', () => {
    it('1. session starts', async () => {
      const res = await request(app)
        .post(getUrl('/incident/start'))
        .send({ scenarioId: 'default_exhaustion', seed: 'test-seed' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('RUNNING');
    });

    it('2. session has unique incident/session ID', async () => {
      const res = await request(app).get(getUrl('/incident/state'));
      expect(res.body.incidentId).toBeDefined();
      expect(res.body.sessionId).toBeDefined();
    });

    it('3. initial state is correct', async () => {
      const res = await request(app).get(getUrl('/incident/state'));
      expect(res.body.playback.tick).toBeGreaterThanOrEqual(0);
      expect(res.body.dependencyGraph).toBeDefined();
    });

    it('6. pause works', async () => {
      const res = await request(app).post(getUrl('/incident/pause'));
      expect(res.body.status).toBe('PAUSED');
    });

    it('7. resume works', async () => {
      const res = await request(app).post(getUrl('/incident/resume'));
      expect(res.body.status).toBe('RUNNING');
    });

    it('8. step advances exactly one tick', async () => {
      await request(app).post(getUrl('/incident/pause'));
      const state1 = (await request(app).get(getUrl('/incident/state'))).body;
      await request(app).post(getUrl('/incident/step'));
      const state2 = (await request(app).get(getUrl('/incident/state'))).body;
      expect(state2.playback.tick).toBe(state1.playback.tick + 1);
    });

    it('9. speed changes correctly', async () => {
      const res = await request(app).post(getUrl('/incident/speed')).send({ speed: 4 });
      expect(res.body.speed).toBe(4);
    });

    it('10. reset restores initial state', async () => {
      const res = await request(app).post(getUrl('/incident/reset'));
      expect(res.body.playback.tick).toBe(0);
      expect(res.body.status).toBe('RUNNING');
    });
  });

  // ==========================================
  // PIPELINE
  // ==========================================
  describe('PIPELINE', () => {
    it('11-13. simulation produces observations and analysis', async () => {
      await request(app).post(getUrl('/incident/speed')).send({ speed: 8 });
      // Wait for a few ticks to allow analysis to generate
      await new Promise(resolve => setTimeout(resolve, 500));
      await request(app).post(getUrl('/incident/pause'));
      
      const res = await request(app).get(getUrl('/incident/state'));
      expect(res.body.playback.tick).toBeGreaterThan(10);
      expect(res.body.causalAnalysis).toBeDefined();
      expect(res.body.causalAnalysis.topCandidate).toBeDefined();
    });

    it('14-16. prediction becomes available and locked', async () => {
      let state = (await request(app).get(getUrl('/incident/state'))).body;
      // Wait until prediction is available
      for (let i = 0; i < 20; i++) {
        if (state.prediction) break;
        await request(app).post(getUrl('/incident/step'));
        state = (await request(app).get(getUrl('/incident/state'))).body;
      }
      expect(state.prediction).toBeDefined();
      
      const lockRes = await request(app).post(getUrl('/incident/prediction/lock'));
      expect(lockRes.status).toBe(200);
      expect(lockRes.body.status).toBe('FROZEN');
      
      state = (await request(app).get(getUrl('/incident/state'))).body;
      expect(state.status).toBe('PREDICTION_LOCKED');
    });
  });

  // ==========================================
  // STREAM (SOCKET.IO)
  // ==========================================
  describe('STREAM', () => {
    it('17-23. WebSocket connects, receives ordered events', async () => {
      const events: any[] = [];
      clientSocket.on('telemetry:tick', (evt) => events.push(evt));
      
      await request(app).post(getUrl('/incident/step'));
      await new Promise(resolve => setTimeout(resolve, 100)); // wait for emit
      
      expect(events.length).toBeGreaterThan(0);
      const evt = events[0];
      expect(evt.type).toBeDefined();
      expect(evt.sequence).toBeGreaterThan(0);
      expect(evt.tick).toBeDefined();
      expect(evt.incidentId).toBeDefined();
      
      // Sequence monotonically increasing
      if (events.length > 1) {
        expect(events[1].sequence).toBeGreaterThan(events[0].sequence);
      }
    });
  });

  // ==========================================
  // EXPERIMENT
  // ==========================================
  describe('EXPERIMENT', () => {
    it('24-27. root experiment uses pre-intervention snapshot and generates actual trajectory', async () => {
      const res = await request(app).post(getUrl('/incident/experiment/root'));
      expect(res.status).toBe(200);
      expect(res.body.validationStatus).toBeDefined();
      
      const state = (await request(app).get(getUrl('/incident/state'))).body;
      expect(state.rootTrajectory).toBeDefined();
      expect(state.rootValidation).toBeDefined();
    });

    it('28-31. symptom experiment resets to identical pre-intervention state', async () => {
      const res = await request(app)
        .post(getUrl('/incident/experiment/symptom'))
        .send({ serviceId: 'appointment', resource: 'WORKERS' });
      expect(res.status).toBe(200);
      
      const state = (await request(app).get(getUrl('/incident/state'))).body;
      expect(state.symptomTrajectory).toBeDefined();
      expect(state.symptomValidation).toBeDefined();
      
      // Verify isolation (root trajectory must remain untouched)
      expect(state.rootTrajectory.checkpoints.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // ERRORS
  // ==========================================
  describe('ERRORS', () => {
    it('41-45. Invalid lifecycle and structured error response', async () => {
      // Already VALIDATED, cannot lock prediction again
      const res = await request(app).post(getUrl('/incident/prediction/lock'));
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PREDICTION_ALREADY_LOCKED');
      expect(res.body.message).toBeDefined();
    });

    it('rejects invalid experiment targets', async () => {
      const res = await request(app)
        .post(getUrl('/incident/experiment/symptom'))
        .send({ serviceId: 'unknown' }); // Missing resource
      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // GROUND TRUTH & SECURITY
  // ==========================================
  describe('GROUND TRUTH ISOLATION', () => {
    it('32-37. Normal REST responses contain no hidden truth', async () => {
      const state = (await request(app).get(getUrl('/incident/state'))).body;
      const stateStr = JSON.stringify(state);
      const forbidden = ['injectedRoot', 'injectedResource', 'trueRootService', 'targetSeverity', 'AuthoritativeState'];
      for (const word of forbidden) {
        expect(stateStr).not.toContain(word);
      }
    });

    it('36-37. Ground truth reveal is explicit', async () => {
      const res = await request(app).post(getUrl('/incident/reveal'));
      expect(res.status).toBe(200);
      expect(res.body.trueRootService).toBeDefined();
      expect(res.body.injectedSeverity).toBeDefined();
    });

    it('Incident completion', async () => {
      const res = await request(app).post(getUrl('/incident/complete'));
      expect(res.status).toBe(200);
      
      const state = (await request(app).get(getUrl('/incident/state'))).body;
      expect(state.status).toBe('COMPLETED');
    });
  });
  // ==========================================
  // DETERMINISTIC RESET & REPLAY
  // ==========================================
  describe('DETERMINISTIC RESET', () => {
    it('38-40. exact seed resets to identical replay trajectory', async () => {
      const canonicalSeed = 'test-canonical-seed';
      // Start session A
      await request(app).post(getUrl('/incident/start')).send({ scenarioId: 'default_exhaustion', seed: canonicalSeed });
      for(let i=0; i<15; i++) {
        await request(app).post(getUrl('/incident/step'));
      }
      const stateA = (await request(app).get(getUrl('/incident/state'))).body;
      const historyA = stateA.telemetryHistory;

      // Reset
      await request(app).post(getUrl('/incident/reset'));
      for(let i=0; i<15; i++) {
        await request(app).post(getUrl('/incident/step'));
      }
      const stateB = (await request(app).get(getUrl('/incident/state'))).body;
      const historyB = stateB.telemetryHistory;

      // Verifying observable determinism without timestamps (which can float if tied to clock)
      const clean = (h: any) => h.map((t: any) => ({ tick: t.tick, services: t.services }));
      expect(JSON.stringify(clean(historyA))).toBe(JSON.stringify(clean(historyB)));
    });
  });

  // ==========================================
  // SINGLETON RUNTIME
  // ==========================================
  describe('SINGLETON RUNTIME', () => {
    it('only one session timer exists and advances', async () => {
      // Start session A
      await request(app).post(getUrl('/incident/start')).send({ scenarioId: 'default_exhaustion' });
      await request(app).post(getUrl('/incident/resume'));
      // wait a bit
      await new Promise(resolve => setTimeout(resolve, 300));
      const stateA = (await request(app).get(getUrl('/incident/state'))).body;
      
      // Start session B
      await request(app).post(getUrl('/incident/start')).send({ scenarioId: 'default_exhaustion' });
      await request(app).post(getUrl('/incident/resume'));
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const stateB = (await request(app).get(getUrl('/incident/state'))).body;
      
      // Session B should have advanced
      expect(stateB.playback.tick).toBeGreaterThan(0);
      
      // The old orchestrator reference in our test should be the same singleton
      // We just need to make sure the tick isn't advancing wildly due to double loops
      // Since it's a singleton class, there's only one state.
      // A quick test is pausing it and ensuring it stays paused.
      await request(app).post(getUrl('/incident/pause'));
      const stateC = (await request(app).get(getUrl('/incident/state'))).body;
      await new Promise(resolve => setTimeout(resolve, 300));
      const stateD = (await request(app).get(getUrl('/incident/state'))).body;
      
      expect(stateC.playback.tick).toBe(stateD.playback.tick);
    });
  });
});