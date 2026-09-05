import { Router, Request, Response, NextFunction } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';

const ANALYST_DENYLIST = new Set([
  'injectedRoot',
  'trueInjectedRoot',
  'world',
  'hiddenGroundTruth',
  'simulation',
  'groundTruth'
]);

const pruneHiddenFields = (value: any): any => {
  if (Array.isArray(value)) return value.map(pruneHiddenFields);
  if (value && typeof value === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (ANALYST_DENYLIST.has(key)) continue;
      cleaned[key] = pruneHiddenFields(entry);
    }
    return cleaned;
  }
  return value;
};

const getAnalystPrompt = (bundle: any, question: string) => {
  const topCandidate = bundle?.causalAnalysis?.topCandidate ?? null;
  const prediction = bundle?.prediction ?? null;
  const recentEvents = (bundle?.events ?? []).slice(-12);
  const telemetry = bundle?.currentTelemetry;
  const topServicePressure = telemetry?.services?.slice(0, 4).map((svc: any) => ({
    serviceId: svc.serviceId,
    maxPressure: Math.max(...Object.values(svc.resources ?? {}).map((r: any) => Number(r?.pressure ?? 0)))
  })) ?? [];

  return `You are the ExhaustTrace analyst. Answer using only the observable incident evidence below.
Do not use hidden simulation state, ground truth, or internal variables.
Answer in a concise, confident analyst tone in a few sentences.
If the current evidence is insufficient for a confident answer, say so plainly.

Question: ${question}

Live observable bundle:
- status: ${bundle?.status ?? 'UNKNOWN'}
- top hypothesis: ${topCandidate ? `${topCandidate.serviceId}/${topCandidate.resource} (confidence ${topCandidate.confidence})` : 'none yet'}
- hypotheses: ${JSON.stringify((bundle?.causalAnalysis?.hypotheses ?? []).slice(0, 5), null, 2)}
- prediction: ${prediction ? JSON.stringify({
    rootCandidateId: prediction.rootCandidateId,
    rootServiceId: prediction.rootServiceId,
    rootResource: prediction.rootResource,
    confidenceAtPrediction: prediction.confidenceAtPrediction,
    predictedTransitions: prediction.predictedTransitions?.slice(0, 3) ?? []
  }, null, 2) : 'no locked prediction'}
- validation: ${JSON.stringify({
    rootValidation: bundle?.rootValidation ?? null,
    symptomValidation: bundle?.symptomValidation ?? null
  }, null, 2)}
- recent events: ${JSON.stringify(recentEvents.slice(-8), null, 2)}
- current telemetry summary: ${JSON.stringify({
    tick: telemetry?.tick ?? null,
    services: topServicePressure
  }, null, 2)}

Respond with plain text only and keep it brief.`;
};

const callGeminiAnalyst = async (bundle: any, question: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw { errorCode: 'ANALYST_UNAVAILABLE', message: 'Gemini API key is not configured' };
  }

  const safeBundle = pruneHiddenFields(bundle);
  const prompt = getAnalystPrompt(safeBundle, question);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500
      }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw { errorCode: 'ANALYST_UNAVAILABLE', message: 'Gemini request failed', details };
  }

  const json = await response.json();
  const answer = json?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? '')
    .join('\n')
    .trim();

  if (!answer) {
    throw { errorCode: 'ANALYST_UNAVAILABLE', message: 'Gemini returned no usable answer' };
  }

  return answer;
};

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

  router.post('/incident/start-custom', asyncHandler(async (req: Request, res: Response) => {
    const { serviceId, resource, severity, seed } = req.body;
    if (!serviceId || !resource || !severity) {
      throw { errorCode: 'BAD_REQUEST', message: 'serviceId, resource, and severity are required' };
    }
    orchestrator.startCustomScenario(serviceId, resource, severity, seed);
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

  router.post('/incident/analyst-query', asyncHandler(async (req: Request, res: Response) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) {
      throw { errorCode: 'BAD_REQUEST', message: 'question is required' };
    }

    const bundle = orchestrator.getBundle();
    const answer = await callGeminiAnalyst(bundle, question);
    res.type('text/plain').send(answer);
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
                       errorCode === 'SESSION_NOT_FOUND' ? 404 : 
                       errorCode === 'ANALYST_UNAVAILABLE' ? 503 : 500;
    res.status(statusCode).json({
      errorCode,
      message: err.message || 'An unexpected error occurred',
      details: err.details
    });
  });

  return router;
}
