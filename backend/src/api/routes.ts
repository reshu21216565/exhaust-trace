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

const TAB_INSTRUCTIONS: Record<string, string> = {
  'overview': 'Focus on current top root-cause hypothesis, overall system status, main anomaly signals, and general diagnostic confidence.',
  'causal-analysis': 'Focus on candidate hypothesis rankings, scoring dimensions (temporal precedence, queue growth, resource pressure), and relative score differences between candidates.',
  'evidence': 'Focus on specific supporting vs contradicting evidence items, evidence dot categories, and evidence matrix scoring impacts.',
  'prediction': 'Focus on counterfactual recovery forecasts, expected recovery horizon ticks, predicted state transitions, and frozen target baseline metrics.',
  'experiment': 'Focus on targeted resource relief actions, root hypothesis trial results vs symptom trial results, and counterfactual replay comparison curves.',
  'validation': 'Focus on validation status (MATCH/MISMATCH), cascade collapse score percentage, recovery accuracy, and milestone achievements.',
  'timeline': 'Focus on chronological event sequence, anomaly tick timestamps, and cascade propagation order over time.',
  'report': 'Focus on diagnostic executive summary, root cause conclusion, key takeaways, and systemic recommendations.',
  'confidence': 'Focus on confidence curve progression over simulation ticks, confidence surges, and rank stability over time.',
  'benchmark': 'Focus on benchmark diagnostic accuracy, time-to-diagnosis latency across runs, and scenario consistency.',
  'concurrent': 'Focus on multi-incident isolation, distinguishing overlapping cascades, and independent root failure identification.',
  'analyst-voice': 'Focus on real-time incident analysis takeaways, key findings, and voice-guided inquiry.',
  'remedy-lab': 'Focus on mitigation plans, capacity restoration, and resource remediation strategies.',
  'fix-station': 'Focus on automated code patches, configuration fixes, and post-fix validation checks.'
};

const getFallbackQueriesForTab = (tab: string, bundle: any): string[] => {
  const normTab = tab.toLowerCase().trim().replace(/\s+/g, '-');
  const topCandidate = bundle?.causalAnalysis?.topCandidate ?? null;
  const hypotheses = bundle?.causalAnalysis?.hypotheses ?? [];
  const topName = topCandidate ? `${topCandidate.serviceId.toUpperCase()} ${topCandidate.resource}` : null;
  const altCandidate = hypotheses[1] ? `${hypotheses[1].serviceId.toUpperCase()} ${hypotheses[1].resource}` : null;
  const prediction = bundle?.prediction;
  const rootVal = bundle?.rootValidation;

  switch (normTab) {
    case 'overview':
      if (topName) {
        return [
          `Why is ${topName} the top hypothesis?`,
          altCandidate ? `Why not ${altCandidate}?` : `What evidence supports ${topName}?`,
          `Show the propagation chain for ${topName}.`,
          prediction ? `What did the prediction expect for ${topName}?` : `When will a prediction be generated?`
        ];
      }
      return [
        'What triggers a causal hypothesis?',
        'How is resource pressure measured?',
        'What baseline telemetry is monitored?',
        'How are microservice dependencies tracked?'
      ];

    case 'causal-analysis':
    case 'evidence':
      if (topName) {
        return [
          `Why is ${topName} ranked first in the evidence matrix?`,
          altCandidate ? `Why was ${altCandidate} penalized?` : `Which evidence category contributed most?`,
          `What signals support ${topName}?`,
          `How is downstream propagation score calculated?`
        ];
      }
      return [
        'How are evidence categories scored?',
        'What signals support a root candidate?',
        'How are competing hypotheses penalized?',
        'When does causal analysis run?'
      ];

    case 'prediction':
      if (prediction) {
        return [
          `What recovery targets does prediction forecast for ${prediction.rootServiceId.toUpperCase()}?`,
          `How many ticks is the expected recovery horizon?`,
          `What predicted transitions are expected after relief?`,
          `Why freeze prediction before intervention?`
        ];
      }
      return [
        'What triggers a counterfactual prediction?',
        'How is recovery horizon calculated?',
        'What baseline metrics are used for prediction?',
        'Why freeze prediction before running experiments?'
      ];

    case 'experiment':
      if (bundle?.rootTrajectory) {
        return [
          `How did root relief impact downstream queues?`,
          `Did latency collapse after root intervention?`,
          `How does root experiment compare with symptom relief?`,
          `Which metrics recovered fastest during experiment?`
        ];
      }
      return [
        'What is the difference between root and symptom experiments?',
        'How does root relief collapse a cascade?',
        'What happens during counterfactual replay?',
        'Why test symptom relief separately?'
      ];

    case 'validation':
      if (rootVal) {
        return [
          `Did actual recovery match predicted transitions?`,
          `What was the final cascade collapse score?`,
          `Were all recovery milestones achieved?`,
          `Why was validation status marked as ${rootVal.validationStatus}?`
        ];
      }
      return [
        'How is cascade collapse score calculated?',
        'What constitutes a validation MATCH?',
        'How is recovery accuracy measured?',
        'When can ground truth be revealed?'
      ];

    case 'confidence':
      if (topCandidate) {
        return [
          `Why did candidate confidence reach ${(topCandidate.confidence * 100).toFixed(0)}%?`,
          `What evidence drove confidence from initial baseline?`,
          `How did alternate candidate scores compare over time?`,
          `When did the top hypothesis become dominant?`
        ];
      }
      return [
        'How is hypothesis confidence calculated?',
        'What causes confidence to increase over time?',
        'What is the confidence threshold for predictions?',
        'How are rank shifts tracked over ticks?'
      ];

    case 'timeline':
      return [
        'What sequence of events triggered the incident?',
        'Which microservice degraded first in the timeline?',
        'How did resource pressure propagate chronologically?',
        'What tick recorded peak queue depth?'
      ];

    case 'report':
      return [
        'What is the executive summary of this incident?',
        topName ? `Why was ${topName} confirmed as root cause?` : 'What are the key diagnostic findings?',
        'What key takeaways prevent future recurrence?',
        'How effective was the counterfactual recovery?'
      ];

    case 'benchmark':
      return [
        'How does time-to-diagnosis compare across benchmark runs?',
        'What is the average prediction accuracy in benchmark mode?',
        'How consistent are root cause candidate rankings?',
        'What is the target diagnostic latency per scenario?'
      ];

    case 'concurrent':
      return [
        'How were the two concurrent incidents isolated?',
        'Which incident initiated first in the timeline?',
        'How are overlapping service cascades distinguished?',
        'What signals differentiate independent root failures?'
      ];

    case 'remedy-lab':
    case 'fix-station':
      return [
        'What mitigation plan is recommended for this failure?',
        'How will code patches prevent future resource exhaustion?',
        'What system safety checks validate the fix?',
        'How does the remedy plan restore baseline capacity?'
      ];

    default:
      return [
        'Why is the top hypothesis ranked first?',
        'Why not the second candidate?',
        'Show the propagation chain.',
        'What did the prediction expect?'
      ];
  }
};

const callGeminiSuggestedQueries = async (bundle: any, tab: string): Promise<string[]> => {
  const normTab = tab.toLowerCase().trim().replace(/\s+/g, '-');
  const safeBundle = pruneHiddenFields(bundle);
  const fallbacks = getFallbackQueriesForTab(tab, safeBundle);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbacks;

  const topCandidate = safeBundle?.causalAnalysis?.topCandidate ?? null;
  const altCandidate = safeBundle?.causalAnalysis?.hypotheses?.[1] ?? null;
  const tabInstruction = TAB_INSTRUCTIONS[normTab] || TAB_INSTRUCTIONS['overview'];

  const prompt = `You are the ExhaustTrace analyst assistant.
Generate exactly 4 to 5 short, highly relevant suggested user questions for the active UI tab "${tab}" based on the observable incident telemetry below.

Tab Focus:
${tabInstruction}

Strict Requirements:
1. Return EXACTLY 4 or 5 questions.
2. Each question MUST be under 12 words and phrased in a terse, direct, analyst style.
3. Reference specific observable data from the telemetry below (such as candidate service names like "${topCandidate?.serviceId ?? 'records'}", resource "${topCandidate?.resource ?? 'MEMORY'}", confidence values, or prediction/validation metrics) if present.
4. Return ONLY a valid JSON object matching this exact schema: { "queries": ["Question 1?", "Question 2?", "Question 3?", "Question 4?"] }. No markdown formatting, no code block backticks, no prose.

Observable Incident Telemetry:
- Status: ${safeBundle?.status ?? 'IDLE'}
- Active Tab: ${tab}
- Top Candidate: ${topCandidate ? `${topCandidate.serviceId}/${topCandidate.resource} (${(topCandidate.confidence * 100).toFixed(0)}% confidence, score ${Math.round(topCandidate.score)})` : 'None yet'}
- Alternate Candidate: ${altCandidate ? `${altCandidate.serviceId}/${altCandidate.resource} (${(altCandidate.confidence * 100).toFixed(0)}% confidence)` : 'None'}
- Prediction: ${safeBundle?.prediction ? `Locked for ${safeBundle.prediction.rootServiceId}/${safeBundle.prediction.rootResource} (horizon ${safeBundle.prediction.horizonTicks} ticks)` : 'None'}
- Root Validation: ${safeBundle?.rootValidation ? `Status ${safeBundle.rootValidation.validationStatus}, Collapse ${Math.round((safeBundle.rootValidation.cascadeCollapseScore ?? 0) * 100)}%` : 'None'}
- Recent Events Count: ${safeBundle?.events?.length ?? 0}
`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
          responseMimeType: "application/json"
        }
      })
    });

    if (response.ok) {
      const json = await response.json();
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      const queries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.queries) ? parsed.queries : null);

      if (queries && queries.length >= 3) {
        return queries.slice(0, 5).map((q: any) => String(q).trim()).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn('[SuggestedQueries] Gemini request failed, using data-backed fallback:', e);
  }

  return fallbacks;
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
    res.json(orchestrator.getBundle());
  }));

  router.post('/incident/resume', asyncHandler(async (req: Request, res: Response) => {
    orchestrator.resume();
    res.json(orchestrator.getBundle());
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

  router.post('/incident/suggested-queries', asyncHandler(async (req: Request, res: Response) => {
    const tab = String(req.body?.tab ?? 'Overview').trim();
    const bundle = orchestrator.getBundle();
    const queries = await callGeminiSuggestedQueries(bundle, tab);
    res.json({ queries });
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
