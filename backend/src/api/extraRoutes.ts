import { Router, Request, Response, NextFunction } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';
import { ConfidenceHistoryStore } from '../tracking/ConfidenceHistoryStore';
import { ConcurrentIncidentStore } from '../tracking/ConcurrentIncidentStore';
import { ResourceType } from '@exhausttrace/shared';

export function createExtraApiRouter(orchestrator: IncidentOrchestrator): Router {
  const router = Router();

  const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  // Feature 2: Confidence History endpoint
  router.get('/incident/confidence-history', asyncHandler(async (req: Request, res: Response) => {
    const bundle = orchestrator.getBundle();
    ConfidenceHistoryStore.updateFromBundle(bundle);
    const history = ConfidenceHistoryStore.getHistory();
    res.json({
      incidentId: bundle.incidentId,
      tick: bundle.playback.tick,
      confidenceHistory: history
    });
  }));

  // Feature 3: Benchmark endpoint
  router.post('/incident/benchmark', asyncHandler(async (req: Request, res: Response) => {
    const { scenarioId = 'default_exhaustion', runCount = 5 } = req.body ?? {};
    const count = Math.min(Math.max(Number(runCount) || 5, 1), 20);

    const runs: Array<{
      runNumber: number;
      seed: string;
      ticksToDiagnosis: number;
      topCandidateId: string;
      confidence: number;
      isCorrect: boolean;
      status: string;
    }> = [];

    let correctCount = 0;
    let totalTicks = 0;

    for (let i = 1; i <= count; i++) {
      const seed = `bench-seed-${Date.now()}-${i}`;
      const bench = new IncidentOrchestrator();
      bench.startScenario(scenarioId, seed);
      bench.pause();

      // Step simulation for 50 ticks to accumulate telemetry and run causal analysis
      for (let t = 0; t < 50; t++) {
        bench.step();
      }

      const bundle = bench.getBundle();
      const top = bundle.causalAnalysis?.topCandidate;
      const confidence = top ? top.confidence : 0;
      const candidateId = top ? `${top.serviceId}/${top.resource}` : 'NONE';
      const ticks = bundle.playback.tick || 50;

      // Ground truth for default_exhaustion is records/MEMORY
      const isCorrect = top?.serviceId === 'records' && top?.resource === 'MEMORY';
      if (isCorrect) correctCount++;
      totalTicks += ticks;

      runs.push({
        runNumber: i,
        seed,
        ticksToDiagnosis: ticks,
        topCandidateId: candidateId,
        confidence: Math.round(confidence * 100),
        isCorrect,
        status: 'COMPLETED'
      });
    }

    const accuracyPercent = Math.round((correctCount / count) * 100);
    const avgTicksToDiagnosis = Math.round(totalTicks / count);
    const fastestRunTicks = Math.min(...runs.map(r => r.ticksToDiagnosis));
    const slowestRunTicks = Math.max(...runs.map(r => r.ticksToDiagnosis));

    res.json({
      scenarioId,
      totalRuns: count,
      accuracyPercent,
      avgTicksToDiagnosis,
      fastestRunTicks,
      slowestRunTicks,
      runs
    });
  }));

  // Feature 4: Concurrent Incidents endpoints
  router.post('/incident/concurrent-start', asyncHandler(async (req: Request, res: Response) => {
    const { 
      serviceA = 'records', 
      resourceA = 'MEMORY', 
      severityA = 'CRITICAL',
      serviceB = 'portal', 
      resourceB = 'CPU', 
      severityB = 'CRITICAL' 
    } = req.body ?? {};

    ConcurrentIncidentStore.startConcurrent(
      serviceA as ResourceType,
      resourceA as ResourceType,
      severityA,
      serviceB as ResourceType,
      resourceB as ResourceType,
      severityB
    );

    res.json(ConcurrentIncidentStore.getState());
  }));

  router.get('/incident/concurrent-state', asyncHandler(async (req: Request, res: Response) => {
    res.json(ConcurrentIncidentStore.getState());
  }));

  return router;
}
