import { Router, Request, Response, NextFunction } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';

export function createApiRouter(orchestrator: IncidentOrchestrator): Router {
  const router = Router();

  const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  router.post('/incident/start', asyncHandler(async (req: Request, res: Response) => {
    const { scenarioId, seed } = req.body;
    if (!scenarioId) throw { errorCode: 'BAD_REQUEST', message: 'scenarioId is required' };
    orchestrator.startScenario(scenarioId, seed);
    res.json(orchestrator.getBundle());
  }));

  router.post('/incident/pause', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.pause();
    res.json({ status: 'PAUSED' });
  }));

  router.post('/incident/resume', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.resume();
    res.json({ status: 'RUNNING' });
  }));

  router.post('/incident/step', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.step();
    res.json(orchestrator.getBundle());
  }));

  router.post('/incident/speed', asyncHandler(async (req: Request, res: Response) => {
    const { speed } = req.body;
    if (!speed) throw { errorCode: 'BAD_REQUEST', message: 'speed is required' };
    orchestrator.setSpeed(speed);
    res.json({ speed });
  }));

  router.post('/incident/reset', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.reset();
    res.json(orchestrator.getBundle());
  }));

  router.get('/incident/state', asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(orchestrator.getBundle());
    } catch (e: any) {
      if (e.errorCode === 'SESSION_NOT_FOUND') {
        res.status(404).json(e);
      } else {
        throw e;
      }
    }
  }));

  router.post('/incident/prediction/lock', asyncHandler(async (req: Request, res: Response) => {
    const prediction = orchestrator.lockPrediction();
    res.json(prediction);
  }));

  router.post('/incident/experiment/root', asyncHandler(async (req: Request, res: Response) => {
    const validation = orchestrator.runRootExperiment();
    res.json(validation);
  }));

  router.post('/incident/experiment/symptom', asyncHandler(async (req: Request, res: Response) => {
    const { serviceId, resource } = req.body;
    if (!serviceId || !resource) throw { errorCode: 'BAD_REQUEST', message: 'serviceId and resource are required' };
    const validation = orchestrator.runSymptomExperiment(serviceId, resource);
    res.json(validation);
  }));

  router.post('/incident/complete', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.completeIncident();
    res.json({ status: 'COMPLETED' });
  }));

  router.post('/incident/reveal', asyncHandler(async (req: Request, res: Response) => {
    const truth = orchestrator.revealGroundTruth();
    res.json(truth);
  }));

  // Error handler middleware
  router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const errorCode = err.errorCode || 'INTERNAL_ERROR';
    const conflictErrors = [
      'INVALID_STATE_TRANSITION',
      'PREDICTION_ALREADY_LOCKED',
      'PREDICTION_NOT_READY',
      'EXPERIMENT_ALREADY_RUNNING',
      'NO_GROUND_TRUTH'
    ];
    
    const statusCode = errorCode === 'BAD_REQUEST' ? 400 : 
                       conflictErrors.includes(errorCode) ? 409 : 
                       errorCode === 'SESSION_NOT_FOUND' ? 404 : 500;
    res.status(statusCode).json({
      errorCode,
      message: err.message || 'An unexpected error occurred',
      details: err.details
    });
  });

  return router;
}
