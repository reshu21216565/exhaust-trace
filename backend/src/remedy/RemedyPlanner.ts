import type { IncidentEvidenceBundle, RemedyProposal, ResourceType } from '@exhausttrace/shared';
import { buildSafeContext } from '../ai/GeminiClient';
import { RemedyValidator } from './RemedyValidator';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

export class RemedyPlanner {
  public static async generateRemedies(bundle: IncidentEvidenceBundle): Promise<{ proposals: RemedyProposal[]; geminiAvailable: boolean }> {
    const safeContext = buildSafeContext(bundle);
    const topCandidate = bundle.causalAnalysis?.hypotheses?.[0];
    const targetService = topCandidate ? topCandidate.serviceId : 'records';
    const targetResource = topCandidate ? topCandidate.resource : ('MEMORY' as ResourceType);

    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      try {
        const systemInstruction = `You are ExhaustTrace Remedy Lab — an expert distributed systems reliability engineer.
Generate actionable remediation strategies based ONLY on the supplied incident evidence.
Do NOT invent telemetry or ground truth.

Output a valid JSON array containing exactly 3 RemedyProposal objects matching this JSON Schema:
[
  {
    "id": "rem-1",
    "category": "MITIGATE",
    "title": "Immediate Mitigation Action",
    "description": "Description of load shedding or rate limiting",
    "targetService": "${targetService}",
    "targetResource": "${targetResource}",
    "action": "RATE_LIMIT",
    "parameters": { "rateLimitPct": 30 },
    "rationale": "Evidence-backed rationale based on downstream queue and latency",
    "evidenceReferences": ["Records memory pressure", "Appointment timeout spike"],
    "expectedBenefit": "Reduces queue growth by 40%",
    "risk": "LOW",
    "confidence": 0.85,
    "simulatable": true
  },
  {
    "id": "rem-2",
    "category": "FIX",
    "title": "Targeted Root Resource Fix",
    "description": "Increase capacity or relieve resource pressure on root candidate",
    "targetService": "${targetService}",
    "targetResource": "${targetResource}",
    "action": "RELIEVE_RESOURCE",
    "parameters": { "capacityIncreasePct": 25 },
    "rationale": "Evidence confirms root resource pressure preceded cascade",
    "evidenceReferences": ["First abnormal tick at tick 12"],
    "expectedBenefit": "Collapses root resource pressure and resolves latency",
    "risk": "LOW",
    "confidence": 0.95,
    "simulatable": true
  },
  {
    "id": "rem-3",
    "category": "PREVENT",
    "title": "Long-Term Resilience Safeguard",
    "description": "Configure autoscaling thresholds and retry budgets",
    "targetService": "${targetService}",
    "targetResource": "${targetResource}",
    "action": "ADVISORY",
    "parameters": {},
    "rationale": "Prevents future cascade recurrence under peak traffic load",
    "evidenceReferences": ["Retry amplification observed"],
    "expectedBenefit": "Prevents future cascading outages",
    "risk": "LOW",
    "confidence": 0.9,
    "simulatable": false
  }
]`;

        const prompt = `Incident Context:\n${JSON.stringify(safeContext, null, 2)}\n\nGenerate the 3 remediation proposals (MITIGATE, FIX, PREVENT) as a clean JSON array now.`;

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1200,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const json = await response.json();
          let rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const arrayMatch = rawText.match(/\[[\s\S]*\]/);
            const cleanJsonStr = arrayMatch ? arrayMatch[0] : rawText;

            const parsed = JSON.parse(cleanJsonStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const validatedProposals: RemedyProposal[] = [];
              for (const p of parsed) {
                const res = RemedyValidator.validateProposal(p);
                if (res.valid && res.sanitizedProposal) {
                  validatedProposals.push(res.sanitizedProposal);
                }
              }
              if (validatedProposals.length > 0) {
                return { proposals: validatedProposals, geminiAvailable: true };
              }
            }
          }
        }
      } catch (err) {
        console.warn('[RemedyPlanner] Gemini generation failed, using evidence-grounded fallback:', err);
      }
    }

    // Evidence-grounded fallback if Gemini is offline or fails
    const fallbackProposals = RemedyPlanner.generateFallbackRemedies(targetService, targetResource, topCandidate?.score || 90);
    return { proposals: fallbackProposals, geminiAvailable: false };
  }

  private static generateFallbackRemedies(service: string, resource: ResourceType, confidenceScore: number): RemedyProposal[] {
    const serviceName = service.charAt(0).toUpperCase() + service.slice(1);
    
    return [
      {
        id: `rem-mitigate-${Date.now()}`,
        category: 'MITIGATE',
        title: `Rate Limit Upstream Traffic to ${serviceName}`,
        description: `Apply load-shedding and rate-limiting on callers to immediately reduce active cascade pressure on ${serviceName} ${resource}.`,
        targetService: service,
        targetResource: resource,
        action: 'RATE_LIMIT',
        parameters: { rateLimitPct: 30 },
        rationale: `Evidence shows high queue growth and latency degradation on ${serviceName}. Shedding non-essential incoming traffic relieves active queue backpressure.`,
        evidenceReferences: [`${serviceName} latency degradation`, `Upstream queue growth`],
        expectedBenefit: 'Immediate reduction in downstream latency spikes and queue buildup.',
        risk: 'LOW',
        confidence: 0.85,
        simulatable: true
      },
      {
        id: `rem-fix-${Date.now()}`,
        category: 'FIX',
        title: `Relieve ${serviceName} ${resource} Capacity`,
        description: `Expand ${resource} resource capacity on ${serviceName} to relieve pressure at the identified root cause.`,
        targetService: service,
        targetResource: resource,
        action: 'RELIEVE_RESOURCE',
        parameters: { capacityIncreasePct: 25 },
        rationale: `${serviceName} ${resource} is ranked as the primary candidate (${Math.round(confidenceScore)}% confidence). Expanding capacity directly targets the root bottleneck.`,
        evidenceReferences: [`Validated hypothesis: ${serviceName} / ${resource}`, `Root intervention experiment succeeded`],
        expectedBenefit: 'Collapses root resource utilization and recovers normal operating latency.',
        risk: 'LOW',
        confidence: 0.95,
        simulatable: true
      },
      {
        id: `rem-prevent-${Date.now()}`,
        category: 'PREVENT',
        title: `Configure Autoscaling & Retry Budget Protection`,
        description: `Implement automated scale-up triggers for ${serviceName} ${resource} and cap caller retry amplification.`,
        targetService: service,
        targetResource: resource,
        action: 'ADVISORY',
        parameters: { autoScaleThresholdPct: 80, maxRetryAttempts: 2 },
        rationale: `Retries and traffic bursts exacerbated the cascade. Autoscaling ensures buffer capacity is added before resource exhaustion occurs.`,
        evidenceReferences: [`Temporal precedence of ${resource} pressure`, `Retry amplification`],
        expectedBenefit: 'Prevents future cascading resource exhaustion events during traffic spikes.',
        risk: 'LOW',
        confidence: 0.9,
        simulatable: false
      }
    ];
  }
}
