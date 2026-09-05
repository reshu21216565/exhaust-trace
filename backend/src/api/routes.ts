import { Router, Request, Response, NextFunction } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';
import { interpretFault, analyzeIncident } from '../ai/GeminiClient';
import { FaultValidator } from '../ai/FaultValidator';

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

const generateEvidenceBackedAnswer = (bundle: any, question: string): string => {
  const q = question.toLowerCase();
  const topCandidate = bundle?.causalAnalysis?.topCandidate ?? null;
  const hypotheses = bundle?.causalAnalysis?.hypotheses ?? [];
  const reconstructedPaths = bundle?.causalAnalysis?.reconstructedPaths ?? [];
  const prediction = bundle?.prediction ?? null;
  const rootValidation = bundle?.rootValidation;
  const symptomValidation = bundle?.symptomValidation;

  // Question Intent 1: Why is top hypothesis / why is X the top hypothesis
  if (q.includes('top hypothesis') || (q.includes('why is') && (q.includes('records') || q.includes('appointment') || q.includes('memory') || q.includes('cpu')))) {
    if (!topCandidate) {
      return 'Insufficient evidence collected so far. The system is still accumulating telemetry ticks before generating causal hypotheses.';
    }
    const path = reconstructedPaths.find((p: any) => p.hypothesisId === topCandidate.candidateId || p.hypothesisId === `${topCandidate.serviceId}/${topCandidate.resource}`);
    const pathNodes = path ? path.nodes.map((n: any) => `${n.serviceId} (${n.resource})`).join(' -> ') : '';
    return `${topCandidate.serviceId.toUpperCase()} ${topCandidate.resource} is identified as the top root cause hypothesis with ${(topCandidate.confidence * 100).toFixed(0)}% confidence. Telemetry evidence indicates early capacity degradation on ${topCandidate.serviceId} ${topCandidate.resource} at tick ${topCandidate.earliestAnomalyTick ?? 15}, which initiated cascading pressure downstream across microservices${pathNodes ? `: ${pathNodes}` : '.'}`;
  }

  // Question Intent 2: Why not X / comparison with alternate hypothesis
  if (q.includes('why not') || q.includes('alternate') || q.includes('second candidate')) {
    if (hypotheses.length <= 1) {
      return topCandidate 
        ? `No strong alternative candidate exists. ${topCandidate.serviceId.toUpperCase()} ${topCandidate.resource} accounts for all early anomaly signals in the current telemetry window.`
        : 'Telemetry data is still accumulating; no alternate hypotheses have been scored yet.';
    }
    const alt = hypotheses[1];
    return `${alt.serviceId.toUpperCase()} ${alt.resource} was evaluated as an alternate candidate with ${(alt.confidence * 100).toFixed(0)}% confidence. However, its pressure surge occurred at a later tick compared to ${topCandidate.serviceId.toUpperCase()} ${topCandidate.resource}, confirming that ${alt.serviceId.toUpperCase()} is a downstream symptom rather than the originating root cause.`;
  }

  // Question Intent 3: Propagation chain / path / cascade
  if (q.includes('propagation') || q.includes('chain') || q.includes('path') || q.includes('cascade')) {
    if (reconstructedPaths.length > 0) {
      const topPath = reconstructedPaths[0];
      const chainStr = topPath.nodes.map((n: any) => `${n.serviceId} [${n.resource}]`).join(' → ');
      return `Reconstructed causal propagation path: ${chainStr}. Resource exhaustion initiated at ${topPath.nodes[0]?.serviceId} and cascaded downstream due to queue saturation and latency degradation.`;
    }
    if (topCandidate) {
      return `Exhaustion originated at ${topCandidate.serviceId} (${topCandidate.resource}) and propagated downstream through direct dependency calls, elevating queue depths and latency across dependent microservices.`;
    }
    return 'Propagation chain cannot be constructed yet because insufficient anomaly events have occurred.';
  }

  // Question Intent 4: Prediction / counterfactual / expected outcome
  if (q.includes('prediction') || q.includes('expect') || q.includes('forecast')) {
    if (!prediction) {
      return 'No locked counterfactual prediction exists yet. Once top candidate confidence stabilizes, lock the prediction to inspect forecasted recovery trajectories.';
    }
    return `Counterfactual prediction expects that intervening on root candidate ${prediction.rootServiceId.toUpperCase()} (${prediction.rootResource}) will stabilize system telemetry within ${prediction.predictedTransitions?.length ?? 30} ticks with ${(prediction.confidenceAtPrediction * 100).toFixed(0)}% confidence.`;
  }

  // Question Intent 5: Validation / intervention / experiment
  if (q.includes('validation') || q.includes('intervention') || q.includes('experiment') || q.includes('validate')) {
    if (!rootValidation && !symptomValidation) {
      return 'No intervention experiments have been executed yet. Run a root or symptom intervention experiment to validate the causal hypothesis.';
    }
    let res = '';
    if (rootValidation) {
      res += `Root intervention on ${rootValidation.action?.targetService} (${rootValidation.action?.targetResource}) resulted in ${(rootValidation.recoveryPercentage * 100).toFixed(0)}% recovery (Score: ${rootValidation.validationScore.toFixed(2)}). `;
    }
    if (symptomValidation) {
      res += `Symptom intervention on ${symptomValidation.action?.targetService} (${symptomValidation.action?.targetResource}) yielded ${(symptomValidation.recoveryPercentage * 100).toFixed(0)}% recovery.`;
    }
    return res.trim();
  }

  // Fallback synthesis based on current status & telemetry
  if (!topCandidate) {
    return `Incident session is currently ${bundle?.status ?? 'IDLE'}. Microservice telemetry baseline is stable. Select a scenario and click START INCIDENT to observe live telemetry evidence.`;
  }

  return `Current Analyst Summary: Incident session state is ${bundle?.status}. Top hypothesis is ${topCandidate.serviceId.toUpperCase()} ${topCandidate.resource} (confidence ${(topCandidate.confidence * 100).toFixed(0)}%). Telemetry shows active resource pressure on ${topCandidate.serviceId}. ${prediction ? `Counterfactual prediction is available for ${prediction.rootServiceId}.` : 'Prediction updates with incoming telemetry ticks.'}`;
};

const callGeminiAnalyst = async (bundle: any, question: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  const safeBundle = pruneHiddenFields(bundle);

  if (apiKey) {
    try {
      const prompt = getAnalystPrompt(safeBundle, question);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
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

      if (response.ok) {
        const json = await response.json();
        const answer = json?.candidates?.[0]?.content?.parts
          ?.map((part: any) => part?.text ?? '')
          .join('\n')
          .trim();

        if (answer) return answer;
      }
    } catch (e) {
      console.warn('[Analyst] Gemini API request failed, falling back to evidence engine:', e);
    }
  }

  return generateEvidenceBackedAnswer(safeBundle, question);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Confidence History — real-time Bayesian curve data
  // ─────────────────────────────────────────────────────────────────────────
  router.get('/incident/confidence-history', asyncHandler(async (_req: Request, res: Response) => {
    const history = orchestrator.getConfidenceHistory();
    res.json({ confidenceHistory: history });
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Benchmark — Monte-Carlo batch runner (isolated, non-blocking)
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/incident/benchmark', asyncHandler(async (req: Request, res: Response) => {
    const { scenarioId, runCount } = req.body;
    if (!scenarioId) throw { errorCode: 'BAD_REQUEST', message: 'scenarioId is required' };
    const count = Math.min(Math.max(Number(runCount) || 5, 1), 25); // cap at 25 runs
    const result = IncidentOrchestrator.runBenchmarkScenario(scenarioId, count);
    res.json(result);
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // Concurrent — dual isolated incident orchestrators
  // ─────────────────────────────────────────────────────────────────────────
  router.post('/incident/concurrent-start', asyncHandler(async (req: Request, res: Response) => {
    const { serviceA, resourceA, severityA, serviceB, resourceB, severityB } = req.body;
    if (!serviceA || !resourceA || !serviceB || !resourceB) {
      throw { errorCode: 'BAD_REQUEST', message: 'serviceA, resourceA, serviceB, resourceB are required' };
    }
    const result = IncidentOrchestrator.runConcurrentScenarios(
      { serviceId: serviceA, resource: resourceA, severity: severityA || 'CRITICAL' },
      { serviceId: serviceB, resource: resourceB, severity: severityB || 'CRITICAL' }
    );
    res.json(result);
  }));

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK 7: AI ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /ai/interpret-fault
   * Gemini interprets natural language → structured FaultCommand candidate.
   * Does NOT execute anything. Returns candidate + server-side validation.
   * Double-validation happens again in /ai/inject-fault before execution.
   */
  router.post('/ai/interpret-fault', asyncHandler(async (req: Request, res: Response) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw { errorCode: 'BAD_REQUEST', message: 'text is required' };
    if (text.length > 500) throw { errorCode: 'BAD_REQUEST', message: 'text too long (max 500 chars)' };

    console.log(`[AI] Interpreting fault request: "${text}"`);
    const interpretation = await interpretFault(text);

    // Server-side validation of the candidate (first validation pass)
    let validation = null;
    if (interpretation.intent === 'FAULT_INJECTION' && interpretation.serviceId && interpretation.resource && interpretation.severity) {
      validation = FaultValidator.validate({
        serviceId: interpretation.serviceId,
        resource: interpretation.resource,
        severity: interpretation.severity,
      });
    }

    console.log(`[AI] Interpretation result: intent=${interpretation.intent}, service=${interpretation.serviceId}, resource=${interpretation.resource}, severity=${interpretation.severity}, geminiAvailable=${interpretation.geminiAvailable}`);

    res.json({
      interpretation,
      validation,
      auditEvent: {
        type: 'AI_FAULT_REQUESTED',
        tick: orchestrator.getBundle().playback.tick,
        timestamp: Date.now(),
        summary: `AI interpreted: "${text.slice(0, 80)}" → ${interpretation.intent}`,
      },
    });
  }));

  /**
   * POST /ai/inject-fault
   * Executes a validated FaultCommand through the existing orchestrator.
   * DOUBLE-VALIDATES on the server side — never trusts client-provided validation.
   * Requires explicit user confirmation before this endpoint is called.
   */
  router.post('/ai/inject-fault', asyncHandler(async (req: Request, res: Response) => {
    const { serviceId, resource, severity } = req.body ?? {};

    // Second validation pass — authoritative
    const validation = FaultValidator.validate({ serviceId, resource, severity });
    if (!validation.valid) {
      console.warn(`[AI] Fault injection REJECTED:`, validation.errors);
      res.status(400).json({
        errorCode: 'AI_FAULT_REJECTED',
        message: 'Fault command validation failed',
        errors: validation.errors,
        auditEvent: {
          type: 'AI_FAULT_REJECTED',
          tick: orchestrator.getBundle().playback.tick,
          timestamp: Date.now(),
          summary: `Rejected: ${serviceId}/${resource}/${severity} — ${validation.errors.join('; ')}`,
        },
      });
      return;
    }

    const cmd = validation.command!;
    console.log(`[AI] Injecting validated fault: ${cmd.serviceId}/${cmd.resource}/${cmd.severity}`);

    // Execute through the standard orchestrator path — identical to startCustomScenario
    const seed = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    orchestrator.startCustomScenario(cmd.serviceId, cmd.resource as any, cmd.severity, seed);

    const bundle = orchestrator.getBundle();
    console.log(`[AI] Fault injected successfully. Incident ID: ${bundle.incidentId}`);

    res.json({
      injected: true,
      command: cmd,
      incidentId: bundle.incidentId,
      status: bundle.status,
      auditEvent: {
        type: 'AI_FAULT_INJECTED',
        tick: bundle.playback.tick,
        timestamp: Date.now(),
        summary: `AI injected: ${cmd.serviceId}/${cmd.resource}/${cmd.severity}`,
      },
    });
  }));

  /**
   * POST /ai/analyze
   * Gemini answers a natural-language investigation question.
   * Context is the safe GeminiInvestigationContext DTO — no hidden state.
   */
  router.post('/ai/analyze', asyncHandler(async (req: Request, res: Response) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) throw { errorCode: 'BAD_REQUEST', message: 'question is required' };
    if (question.length > 600) throw { errorCode: 'BAD_REQUEST', message: 'question too long (max 600 chars)' };

    const bundle = orchestrator.getBundle();
    console.log(`[AI] Analyst question at tick ${bundle.playback.tick}: "${question.slice(0, 80)}"`);

    const response = await analyzeIncident(bundle, question);
    console.log(`[AI] Answer (geminiAvailable=${response.geminiAvailable}): ${response.answer.slice(0, 100)}...`);

    res.json(response);
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
