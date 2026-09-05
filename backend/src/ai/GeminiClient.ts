/**
 * GeminiClient — server-side Gemini API integration for ExhaustTrace Block 7.
 *
 * Security contract:
 *   - API key read ONLY from process.env.GEMINI_API_KEY (set in backend/.env)
 *   - Key NEVER transmitted to frontend
 *   - All Gemini requests are server-to-server
 *   - Safe context DTO strips hidden ground truth before any Gemini call
 *
 * Gemini's role:
 *   A. Natural-language → FaultCommand interpretation
 *   B. Evidence-grounded Q&A about the current investigation
 *
 * Gemini is NOT:
 *   - The causal engine
 *   - The confidence scorer
 *   - The prediction engine
 *   - The validator
 */

import type { IncidentEvidenceBundle, CausalHypothesis } from '@exhausttrace/shared';
import { SUPPORTED_SERVICES, SUPPORTED_RESOURCES, SUPPORTED_SEVERITIES } from './FaultValidator';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FaultInterpretation {
  intent: 'FAULT_INJECTION' | 'INVESTIGATION_QUESTION' | 'AMBIGUOUS' | 'UNSUPPORTED';
  serviceId: string | null;
  resource: string | null;
  severity: string | null;
  clarificationRequired: boolean;
  clarificationQuestion: string | null;
  rawText: string;
  geminiAvailable: boolean;
}

export interface AnalystResponse {
  answer: string;
  intent: string;
  geminiAvailable: boolean;
}

/**
 * GeminiInvestigationContext — the ONLY data Gemini is allowed to see.
 * Constructed by buildSafeContext(). No hidden ground truth passes through.
 */
export interface GeminiInvestigationContext {
  incidentId: string;
  status: string;
  tick: number;
  scenarioId: string;
  dependencyGraph: {
    nodes: { id: string; label?: string }[];
    edges: { from: string; to: string }[];
  } | null;
  currentTelemetrySummary: Array<{
    serviceId: string;
    cpuPressure: number;
    memoryPressure: number;
    connectionsPressure: number;
    workersPressure: number;
    cpuStatus: string;
    memoryStatus: string;
    connectionsStatus: string;
    workersStatus: string;
    latencyMs: number;
    queueDepth: number;
    timeoutRate: number;
    retryRate: number;
  }>;
  recentEvents: Array<{
    tick: number;
    type: string;
    serviceId?: string;
    resource?: string;
    status?: string;
    latencyMs?: number;
    queueDepth?: number;
  }>;
  rankedHypotheses: Array<{
    rank: number;
    serviceId: string;
    resource: string;
    score: number;
    confidence: number;
    supportingSignals: string[];
    contradictingSignals: string[];
    firstAbnormalTick: number | null;
  }>;
  propagationPaths: Array<{
    hypothesisId: string;
    confidence: number;
    nodes: Array<{ serviceId: string; resource?: string; observedCondition: string; firstObservedTick: number }>;
  }>;
  confidenceHistory: Array<{ tick: number; topCandidateId: string; topCandidateConfidence: number }>;
  prediction: {
    rootCandidateId: string;
    rootServiceId: string;
    rootResource: string;
    confidenceAtPrediction: number;
    predictedTransitions: Array<{
      serviceId: string;
      resource?: string;
      fromCondition: string;
      toCondition: string;
      expectedRelativeTick: number;
    }>;
    assumptions: string[];
  } | null;
  experiments: {
    rootValidation: {
      target: string;
      recoveryAccuracy: number;
      cascadeCollapseScore: number;
      validationStatus: string;
      explanation: string;
      milestones: Array<{ description: string; achieved: boolean; achievedAtRelativeTick: number | null }>;
    } | null;
    symptomValidation: {
      target: string;
      recoveryAccuracy: number;
      cascadeCollapseScore: number;
      validationStatus: string;
      explanation: string;
    } | null;
  };
}

// ─── Hidden fields that must NEVER reach Gemini ────────────────────────────

const HIDDEN_FIELD_DENYLIST = new Set([
  'trueRoot', 'trueRootService', 'trueRootResource',
  'injectedRoot', 'injectedResource', 'targetSeverity',
  'AuthoritativeState', 'SimulationWorld', 'rootCause',
  'world', 'hiddenGroundTruth', 'simulation', 'groundTruth',
  'pendingCustomInjection', 'trueInjectedRoot',
  'GEMINI_API_KEY', 'apiKey',
]);

/**
 * Build a safe Gemini-visible context from the canonical IncidentEvidenceBundle.
 * This is an EXPLICIT mapping — not a blind serialization.
 * Hidden ground truth fields are never included.
 */
export function buildSafeContext(bundle: IncidentEvidenceBundle): GeminiInvestigationContext {
  const telemetrySummary = (bundle.currentTelemetry?.services ?? []).map(svc => ({
    serviceId: svc.serviceId,
    cpuPressure: Math.round((svc.resources.CPU?.pressure ?? 0) * 100) / 100,
    memoryPressure: Math.round((svc.resources.MEMORY?.pressure ?? 0) * 100) / 100,
    connectionsPressure: Math.round((svc.resources.CONNECTIONS?.pressure ?? 0) * 100) / 100,
    workersPressure: Math.round((svc.resources.WORKERS?.pressure ?? 0) * 100) / 100,
    cpuStatus: svc.resources.CPU?.status ?? 'HEALTHY',
    memoryStatus: svc.resources.MEMORY?.status ?? 'HEALTHY',
    connectionsStatus: svc.resources.CONNECTIONS?.status ?? 'HEALTHY',
    workersStatus: svc.resources.WORKERS?.status ?? 'HEALTHY',
    latencyMs: Math.round(svc.metrics.latencyMs),
    queueDepth: Math.round(svc.metrics.queueDepth),
    timeoutRate: Math.round(svc.metrics.timeoutRate * 1000) / 1000,
    retryRate: Math.round(svc.metrics.retryRate * 1000) / 1000,
  }));

  const recentEvents = (bundle.events ?? []).slice(-15).map(e => {
    const base: any = { tick: e.tick, type: e.type };
    if ((e as any).serviceId) base.serviceId = (e as any).serviceId;
    if ((e as any).resource) base.resource = (e as any).resource;
    if ((e as any).status) base.status = (e as any).status;
    if ((e as any).latencyMs) base.latencyMs = Math.round((e as any).latencyMs);
    if ((e as any).queueDepth) base.queueDepth = Math.round((e as any).queueDepth);
    return base;
  });

  const hypotheses = (bundle.causalAnalysis?.hypotheses ?? []).slice(0, 5).map(h => ({
    rank: h.rank,
    serviceId: h.serviceId,
    resource: h.resource,
    score: Math.round(h.score * 10) / 10,
    confidence: Math.round(h.confidence * 1000) / 1000,
    supportingSignals: (h.supportingSignals ?? []).slice(0, 4),
    contradictingSignals: (h.contradictingSignals ?? []).slice(0, 3),
    firstAbnormalTick: h.firstAbnormalTick ?? null,
  }));

  const paths = (bundle.causalAnalysis?.reconstructedPaths ?? []).slice(0, 3).map(p => ({
    hypothesisId: p.hypothesisId,
    confidence: Math.round(p.confidence * 1000) / 1000,
    nodes: (p.nodes ?? []).map(n => ({
      serviceId: n.serviceId,
      resource: n.resource,
      observedCondition: n.observedCondition,
      firstObservedTick: n.firstObservedTick,
    })),
  }));

  const confHistory = (bundle.causalAnalysis?.confidenceHistory ?? []).slice(-20).map(c => ({
    tick: c.tick,
    topCandidateId: c.topCandidateId,
    topCandidateConfidence: Math.round(c.topCandidateConfidence * 1000) / 1000,
  }));

  const pred = bundle.prediction ? {
    rootCandidateId: bundle.prediction.rootCandidateId,
    rootServiceId: bundle.prediction.rootServiceId,
    rootResource: bundle.prediction.rootResource,
    confidenceAtPrediction: Math.round(bundle.prediction.confidenceAtPrediction * 1000) / 1000,
    predictedTransitions: (bundle.prediction.predictedTransitions ?? []).slice(0, 5).map(t => ({
      serviceId: t.serviceId,
      resource: t.resource,
      fromCondition: t.fromCondition,
      toCondition: t.toCondition,
      expectedRelativeTick: t.expectedRelativeTick,
    })),
    assumptions: bundle.prediction.assumptions ?? [],
  } : null;

  const rootVal = bundle.rootValidation ? {
    target: bundle.rootValidation.target,
    recoveryAccuracy: Math.round(bundle.rootValidation.recoveryAccuracy * 1000) / 1000,
    cascadeCollapseScore: Math.round(bundle.rootValidation.cascadeCollapseScore * 1000) / 1000,
    validationStatus: bundle.rootValidation.validationStatus,
    explanation: bundle.rootValidation.explanation,
    milestones: (bundle.rootValidation.milestones ?? []).map(m => ({
      description: m.description,
      achieved: m.achieved,
      achievedAtRelativeTick: m.achievedAtRelativeTick,
    })),
  } : null;

  const symVal = bundle.symptomValidation ? {
    target: bundle.symptomValidation.target,
    recoveryAccuracy: Math.round(bundle.symptomValidation.recoveryAccuracy * 1000) / 1000,
    cascadeCollapseScore: Math.round(bundle.symptomValidation.cascadeCollapseScore * 1000) / 1000,
    validationStatus: bundle.symptomValidation.validationStatus,
    explanation: bundle.symptomValidation.explanation,
  } : null;

  return {
    incidentId: bundle.incidentId,
    status: bundle.status,
    tick: bundle.playback.tick,
    scenarioId: bundle.scenarioId,
    dependencyGraph: bundle.dependencyGraph
      ? { nodes: bundle.dependencyGraph.nodes, edges: bundle.dependencyGraph.edges }
      : null,
    currentTelemetrySummary: telemetrySummary,
    recentEvents,
    rankedHypotheses: hypotheses,
    propagationPaths: paths,
    confidenceHistory: confHistory,
    prediction: pred,
    experiments: { rootValidation: rootVal, symptomValidation: symVal },
  };
}

/**
 * Verify the safe context has no hidden-state fields.
 * Used in tests and development logging.
 */
export function assertNoHiddenFields(obj: any, path = ''): string[] {
  const violations: string[] = [];
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (HIDDEN_FIELD_DENYLIST.has(key)) {
        violations.push(`${path}.${key}`);
      }
      violations.push(...assertNoHiddenFields(obj[key], `${path}.${key}`));
    }
  }
  return violations;
}

// ─── Natural-language aliases ───────────────────────────────────────────────

const RESOURCE_ALIASES: Record<string, string> = {
  'memory': 'MEMORY', 'ram': 'MEMORY', 'heap': 'MEMORY', 'heap pressure': 'MEMORY',
  'cpu': 'CPU', 'processor': 'CPU', 'compute': 'CPU', 'processor saturation': 'CPU',
  'cpu saturation': 'CPU', 'compute exhaustion': 'CPU',
  'connections': 'CONNECTIONS', 'connection pool': 'CONNECTIONS',
  'connection exhaustion': 'CONNECTIONS', 'db connections': 'CONNECTIONS',
  'database connections': 'CONNECTIONS', 'conn': 'CONNECTIONS', 'sockets': 'CONNECTIONS',
  'workers': 'WORKERS', 'worker pool': 'WORKERS', 'thread pool': 'WORKERS',
  'thread pool saturation': 'WORKERS', 'worker threads': 'WORKERS',
  'threadpool': 'WORKERS', 'threads': 'WORKERS',
};

const SEVERITY_ALIASES: Record<string, string> = {
  'critical': 'CRITICAL', 'crit': 'CRITICAL', 'severe': 'CRITICAL', 'catastrophic': 'CRITICAL',
  'full': 'CRITICAL', 'complete': 'CRITICAL', 'total': 'CRITICAL', 'maximum': 'CRITICAL',
  'high': 'HIGH', 'heavy': 'HIGH', 'major': 'HIGH', 'significant': 'HIGH', 'serious': 'HIGH',
  'medium': 'MEDIUM', 'moderate': 'MEDIUM', 'partial': 'MEDIUM',
  'low': 'LOW', 'light': 'LOW', 'minor': 'LOW', 'slight': 'LOW',
};

// ─── Gemini API call ────────────────────────────────────────────────────────

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

async function callGemini(prompt: string, systemInstruction: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 800,
          responseMimeType: 'text/plain',
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      console.warn(`[GeminiClient] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? '')
      .join('')
      .trim();

    return text || null;
  } catch (err: any) {
    console.warn('[GeminiClient] Request failed:', err?.message ?? err);
    return null;
  }
}

// ─── System Instructions ────────────────────────────────────────────────────

const ANALYST_SYSTEM_INSTRUCTION = `You are ExhaustTrace Analyst — an evidence-grounded investigation assistant for a distributed-system resource-exhaustion incident.

RULES:
1. Use ONLY the supplied ExhaustTrace investigation context. Never invent telemetry, events, scores, confidence, causal relationships, predictions, or validation results.
2. Do not claim access to hidden ground truth. You see only observable evidence.
3. Do not independently determine or override the causal analyzer's root hypothesis. The analyzer is authoritative.
4. When discussing root cause, explicitly distinguish between TOP HYPOTHESIS (the analyzer's current leading candidate) and VALIDATED ROOT (confirmed through experiment).
5. Explain conclusions using observable evidence: ticks, pressure values, event types, latency, queues, timeouts.
6. If evidence is insufficient, say so plainly.
7. If the supplied context does not contain the answer, say the information is unavailable.
8. Never fabricate missing information.
9. Be concise, technical, and confident in your analyst tone — not chatty or generic.
10. Reference specific tick numbers, service names, and metric values from the context where available.`;

const FAULT_SYSTEM_INSTRUCTION = `You are an ExhaustTrace fault-injection interpreter.

Your task: Convert natural language fault-injection requests into structured JSON.

SUPPORTED SERVICES: ${SUPPORTED_SERVICES.join(', ')}
SUPPORTED RESOURCES: CPU, MEMORY, CONNECTIONS, WORKERS
SUPPORTED SEVERITIES: LOW, MEDIUM, HIGH, CRITICAL

RESOURCE ALIASES (map these to canonical values):
- memory, RAM, heap → MEMORY
- CPU, processor, compute → CPU
- connections, connection pool, sockets → CONNECTIONS
- workers, worker pool, thread pool → WORKERS

SEVERITY ALIASES:
- severe, catastrophic, full, complete → CRITICAL
- heavy, major, significant → HIGH
- moderate, partial → MEDIUM
- light, minor, slight → LOW

OUTPUT RULES:
1. If the request clearly identifies a service, resource, and severity → output JSON with all fields.
2. If the resource is AMBIGUOUS (e.g. "make Records slow" — could be CPU/MEMORY/CONNECTIONS/WORKERS) → output clarificationRequired: true.
3. If the service is NOT in the supported list → output intent: "UNSUPPORTED".
4. If the resource maps to something outside CPU/MEMORY/CONNECTIONS/WORKERS → output intent: "UNSUPPORTED".
5. If this is clearly an investigation QUESTION (not a fault request) → output intent: "INVESTIGATION_QUESTION".

ALWAYS respond with valid JSON in this exact schema:
{
  "intent": "FAULT_INJECTION" | "INVESTIGATION_QUESTION" | "AMBIGUOUS" | "UNSUPPORTED",
  "serviceId": "<service name lowercase or null>",
  "resource": "CPU" | "MEMORY" | "CONNECTIONS" | "WORKERS" | null,
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null,
  "clarificationRequired": true | false,
  "clarificationQuestion": "<question to ask user, or null>"
}`;

// ─── Heuristic fallback interpreter ────────────────────────────────────────

function heuristicInterpretFault(text: string): FaultInterpretation {
  const lower = text.toLowerCase();

  // Detect service
  let detectedService: string | null = null;
  for (const svc of SUPPORTED_SERVICES) {
    if (lower.includes(svc)) { detectedService = svc; break; }
  }

  // Detect resource via aliases
  let detectedResource: string | null = null;
  for (const [alias, canonical] of Object.entries(RESOURCE_ALIASES)) {
    if (lower.includes(alias)) { detectedResource = canonical; break; }
  }

  // Detect severity via aliases
  let detectedSeverity: string | null = null;
  for (const [alias, canonical] of Object.entries(SEVERITY_ALIASES)) {
    if (lower.includes(alias)) { detectedSeverity = canonical; break; }
  }
  if (!detectedSeverity) detectedSeverity = 'CRITICAL'; // default

  // Check if it's a question (not a fault request)
  const questionWords = ['why', 'what', 'how', 'explain', 'show', 'describe', 'is', 'are', 'did', 'does', 'which'];
  const isQuestion = questionWords.some(w => lower.startsWith(w) || lower.includes(` ${w} `));
  if (isQuestion && !lower.includes('inject') && !lower.includes('exhaust') && !lower.includes('cause') && !lower.includes('create')) {
    return {
      intent: 'INVESTIGATION_QUESTION',
      serviceId: null, resource: null, severity: null,
      clarificationRequired: false, clarificationQuestion: null,
      rawText: text, geminiAvailable: false,
    };
  }

  // Ambiguous resource
  if (!detectedResource) {
    return {
      intent: 'AMBIGUOUS',
      serviceId: detectedService, resource: null, severity: detectedSeverity,
      clarificationRequired: true,
      clarificationQuestion: 'Which resource should be exhausted? Options: CPU, MEMORY, CONNECTIONS, WORKERS',
      rawText: text, geminiAvailable: false,
    };
  }

  // Unknown service
  if (!detectedService) {
    return {
      intent: 'UNSUPPORTED',
      serviceId: null, resource: detectedResource, severity: detectedSeverity,
      clarificationRequired: true,
      clarificationQuestion: `Which service? Supported: ${SUPPORTED_SERVICES.join(', ')}`,
      rawText: text, geminiAvailable: false,
    };
  }

  return {
    intent: 'FAULT_INJECTION',
    serviceId: detectedService,
    resource: detectedResource,
    severity: detectedSeverity,
    clarificationRequired: false, clarificationQuestion: null,
    rawText: text, geminiAvailable: false,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Interpret a natural-language fault request.
 * Returns a structured FaultInterpretation.
 * Does NOT execute anything — execution requires explicit user confirmation + server double-validation.
 */
export async function interpretFault(text: string): Promise<FaultInterpretation> {
  const rawText = text.trim();

  // Try Gemini first
  const geminiText = await callGemini(rawText, FAULT_SYSTEM_INSTRUCTION);
  if (geminiText) {
    try {
      // Extract JSON from response (Gemini may wrap it in markdown)
      const jsonMatch = geminiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[GeminiClient] Fault interpretation:', JSON.stringify(parsed));
        return {
          intent: parsed.intent ?? 'AMBIGUOUS',
          serviceId: parsed.serviceId ?? null,
          resource: parsed.resource ?? null,
          severity: parsed.severity ?? null,
          clarificationRequired: parsed.clarificationRequired ?? false,
          clarificationQuestion: parsed.clarificationQuestion ?? null,
          rawText,
          geminiAvailable: true,
        };
      }
    } catch (err) {
      console.warn('[GeminiClient] Failed to parse fault interpretation JSON:', err);
    }
  }

  // Heuristic fallback
  return heuristicInterpretFault(rawText);
}

/**
 * Answer a natural-language investigation question.
 * Grounds the answer in the safe context derived from IncidentEvidenceBundle.
 * Hidden ground truth is never included.
 */
export async function analyzeIncident(
  bundle: IncidentEvidenceBundle,
  question: string
): Promise<AnalystResponse> {
  const safeCtx = buildSafeContext(bundle);

  // Verify no hidden fields (development safety check)
  const violations = assertNoHiddenFields(safeCtx);
  if (violations.length > 0) {
    console.error('[GeminiClient] SECURITY: Hidden fields detected in context!', violations);
  }

  const contextSummary = JSON.stringify(safeCtx, null, 0);
  const prompt = `EXHAUSTTRACE INVESTIGATION CONTEXT:
${contextSummary}

ANALYST QUESTION: ${question}

Answer using ONLY the evidence in the context above. Reference specific tick numbers, service names, pressure values, and event types where available.`;

  const geminiAnswer = await callGemini(prompt, ANALYST_SYSTEM_INSTRUCTION);

  if (geminiAnswer) {
    return { answer: geminiAnswer, intent: 'INVESTIGATION_QUESTION', geminiAvailable: true };
  }

  // Heuristic fallback
  const fallback = generateHeuristicAnswer(safeCtx, question);
  return { answer: fallback, intent: 'INVESTIGATION_QUESTION', geminiAvailable: false };
}

/**
 * Evidence-backed heuristic answer when Gemini is unavailable.
 * Uses actual context values — never fabricates.
 */
function generateHeuristicAnswer(ctx: GeminiInvestigationContext, question: string): string {
  const q = question.toLowerCase();
  const top = ctx.rankedHypotheses[0];
  const prediction = ctx.prediction;
  const rootVal = ctx.experiments.rootValidation;

  if (!top) {
    return `Incident is at tick ${ctx.tick} with status ${ctx.status}. No causal hypotheses have been established yet — insufficient telemetry has accumulated. The causal analyzer requires resource pressure events to score candidates.`;
  }

  if (q.includes('top hypothesis') || q.includes('why is') || q.includes('why') || q.includes('ranked first')) {
    const signals = top.supportingSignals.length > 0
      ? `Supporting signals: ${top.supportingSignals.join('; ')}.`
      : '';
    return `The causal analyzer ranks ${top.serviceId.toUpperCase()} ${top.resource} as the top hypothesis (Rank #${top.rank}, confidence ${(top.confidence * 100).toFixed(0)}%, score ${top.score}). ${top.firstAbnormalTick ? `First abnormal telemetry appeared at tick ${top.firstAbnormalTick}.` : ''} ${signals}`;
  }

  if (q.includes('why not') || q.includes('alternative') || q.includes('second') || q.includes('other candidate')) {
    const alt = ctx.rankedHypotheses[1];
    if (!alt) return `No alternative hypothesis exists. ${top.serviceId.toUpperCase()} ${top.resource} accounts for all significant anomaly signals in the current telemetry window.`;
    return `${alt.serviceId.toUpperCase()} ${alt.resource} is ranked #${alt.rank} with confidence ${(alt.confidence * 100).toFixed(0)}% — lower than ${top.serviceId.toUpperCase()} ${top.resource} (${(top.confidence * 100).toFixed(0)}%). ${alt.contradictingSignals.length > 0 ? `Contradicting signals: ${alt.contradictingSignals.join('; ')}.` : 'Its pressure pattern appeared later, suggesting downstream causation rather than root origin.'}`;
  }

  if (q.includes('propagation') || q.includes('chain') || q.includes('cascade') || q.includes('path')) {
    const path = ctx.propagationPaths[0];
    if (!path) return `Propagation path data is not yet available. More telemetry ticks are needed to reconstruct the causal chain.`;
    const chain = path.nodes.map(n => `${n.serviceId}${n.resource ? ` [${n.resource}]` : ''} (${n.observedCondition} @ tick ${n.firstObservedTick})`).join(' → ');
    return `Reconstructed propagation path for hypothesis ${path.hypothesisId}: ${chain}. Confidence: ${(path.confidence * 100).toFixed(0)}%.`;
  }

  if (q.includes('prediction') || q.includes('expect') || q.includes('forecast') || q.includes('counterfactual')) {
    if (!prediction) return 'No counterfactual prediction has been locked yet. Lock a prediction to inspect the expected recovery trajectory.';
    const transitions = prediction.predictedTransitions.map(t => `${t.serviceId} ${t.resource ?? ''}: ${t.fromCondition} → ${t.toCondition} (expected tick +${t.expectedRelativeTick})`).join('; ');
    return `Counterfactual prediction targets ${prediction.rootServiceId.toUpperCase()} ${prediction.rootResource} with ${(prediction.confidenceAtPrediction * 100).toFixed(0)}% confidence. Expected transitions: ${transitions || 'none recorded'}.`;
  }

  if (q.includes('validation') || q.includes('experiment') || q.includes('validate') || q.includes('prove') || q.includes('confirmed')) {
    if (!rootVal) return 'No intervention experiment has been run yet. Use the Experiment tab to run a root or symptom intervention.';
    return `Root intervention on ${rootVal.target}: recovery accuracy ${(rootVal.recoveryAccuracy * 100).toFixed(0)}%, cascade collapse score ${(rootVal.cascadeCollapseScore * 100).toFixed(0)}%. Status: ${rootVal.validationStatus}. ${rootVal.explanation}`;
  }

  if (q.includes('now') || q.includes('current') || q.includes('happening') || q.includes('status')) {
    const highPressure = ctx.currentTelemetrySummary.filter(s =>
      s.cpuStatus === 'CRITICAL' || s.memoryStatus === 'CRITICAL' ||
      s.connectionsStatus === 'CRITICAL' || s.workersStatus === 'CRITICAL'
    );
    return `At tick ${ctx.tick}, status is ${ctx.status}. Top hypothesis: ${top.serviceId}/${top.resource} at ${(top.confidence * 100).toFixed(0)}% confidence. ${highPressure.length > 0 ? `CRITICAL pressure on: ${highPressure.map(s => s.serviceId).join(', ')}.` : 'No services at CRITICAL pressure currently.'}`;
  }

  return `At tick ${ctx.tick}: Incident status is ${ctx.status}. Top hypothesis: ${top.serviceId.toUpperCase()} ${top.resource} (confidence ${(top.confidence * 100).toFixed(0)}%, score ${top.score}). ${prediction ? `Counterfactual prediction locked targeting ${prediction.rootServiceId}.` : 'Prediction not yet locked.'} ${rootVal ? `Root experiment: ${rootVal.validationStatus}.` : 'No experiments run yet.'}`;
}
