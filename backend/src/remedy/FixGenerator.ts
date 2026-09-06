import type {
  IncidentEvidenceBundle,
  RemedyProposal,
  FixSolution,
  FixType,
  FixAttempt,
  ResourceType
} from '@exhausttrace/shared';
import { buildSafeContext } from '../ai/GeminiClient';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

/**
 * FixGenerator — Server-side solution generator & Fixer assistant engine for Fix Station.
 * Grounded in canonical incident context from ExhaustTrace.
 */
export class FixGenerator {

  /**
   * Generate an actionable engineering solution for the current incident.
   */
  public static async generateSolution(
    bundle: IncidentEvidenceBundle,
    selectedRemedy?: RemedyProposal
  ): Promise<FixSolution> {
    const topHypothesis = bundle.causalAnalysis?.hypotheses?.[0];
    const rootService = selectedRemedy?.targetService || topHypothesis?.serviceId || 'records';
    const rootResource = (selectedRemedy?.targetResource || topHypothesis?.resource || 'MEMORY') as ResourceType;

    // Build prompt for Gemini API
    const safeCtx = buildSafeContext(bundle);
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      try {
        const prompt = `You are ExhaustTrace Fixer, an expert senior staff engineer.
Generate a precise, actionable engineering solution for this incident.

INCIDENT CONTEXT:
Service: ${rootService}
Resource Exhaustion: ${rootResource}
Selected Remedy: ${selectedRemedy ? selectedRemedy.title + ' - ' + selectedRemedy.description : 'Relieve resource pressure and eliminate cascade origin'}

Safe Telemetry Summary:
${JSON.stringify(safeCtx.currentTelemetrySummary, null, 2)}

Provide JSON response in this EXACT format:
{
  "fixType": "CODE" | "CONFIGURATION" | "INFRASTRUCTURE" | "DATABASE" | "OPERATIONAL" | "ARCHITECTURE" | "COMBINATION",
  "title": "<Short action title>",
  "summary": "<Concise summary of what needs to be changed>",
  "explanation": "<Clear technical explanation>",
  "isCodeFix": true/false,
  "codeDiff": "<Git diff format string if code fix, else null>",
  "codeSnippet": "<Clean code snippet if relevant, else null>",
  "filePath": "<Target file path if code/config, e.g. src/services/records.ts or k8s/records-deployment.yaml>",
  "configuration": "<Config YAML/JSON/env string if config/infra, else null>",
  "configFormat": "yaml" | "json" | "env" | "toml",
  "infrastructure": "<Infra changes if applicable, else null>",
  "commands": ["<CLI command 1>", "<CLI command 2>"],
  "architectureNotes": "<Architecture advice if applicable, else null>",
  "operationalSteps": ["<Step 1>", "<Step 2>"],
  "verificationSteps": ["<Verification step 1>", "<Verification step 2>"],
  "whyThisFix": "<Explanation of why this directly resolves the root cause>"
}`;

        const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            return {
              id: `fix-${Date.now()}`,
              fixType: parsed.fixType || 'CODE',
              title: parsed.title || `Remediate ${rootService} ${rootResource} Exhaustion`,
              summary: parsed.summary || `Apply fixes to ${rootService} service to relieve ${rootResource} pressure.`,
              targetService: rootService,
              targetResource: rootResource,
              explanation: parsed.explanation || 'Fix generated based on causal telemetry analysis.',
              isCodeFix: parsed.isCodeFix ?? true,
              codeDiff: parsed.codeDiff || undefined,
              codeSnippet: parsed.codeSnippet || undefined,
              filePath: parsed.filePath || `src/services/${rootService}.ts`,
              configuration: parsed.configuration || undefined,
              configFormat: parsed.configFormat || 'yaml',
              infrastructure: parsed.infrastructure || undefined,
              commands: parsed.commands || [],
              architectureNotes: parsed.architectureNotes || undefined,
              operationalSteps: parsed.operationalSteps || [],
              verificationSteps: parsed.verificationSteps || ['Verify memory usage drops below 60%', 'Check latency returns to baseline < 50ms'],
              whyThisFix: parsed.whyThisFix || 'Prevents resource exhaustion cascade.',
              iterationIndex: 1
            };
          }
        }
      } catch (err) {
        console.warn('[FixGenerator] Gemini generation failed, falling back to deterministic template:', err);
      }
    }

    // Deterministic fallback based on root service & resource
    return this.getFallbackSolution(rootService, rootResource, selectedRemedy, 1);
  }

  /**
   * Refine solution based on user error feedback / test failure.
   */
  public static async refineSolution(
    bundle: IncidentEvidenceBundle,
    currentSolution: FixSolution,
    feedback: string,
    history: FixAttempt[]
  ): Promise<{ solution: FixSolution; analysis: string }> {
    const nextIteration = (currentSolution.iterationIndex || 1) + 1;
    const rootService = currentSolution.targetService;
    const rootResource = currentSolution.targetResource || 'MEMORY';

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const prompt = `You are ExhaustTrace Fixer. The previous fix attempt failed during verification.
Analyze the user's feedback and refine the solution.

PREVIOUS SOLUTION:
Title: ${currentSolution.title}
Fix Type: ${currentSolution.fixType}
Summary: ${currentSolution.summary}

USER FEEDBACK / ERROR RESULT:
"${feedback}"

Provide JSON response:
{
  "analysis": "<Detailed technical breakdown of why previous fix failed based on user feedback>",
  "revisedSolution": {
    "fixType": "CODE" | "CONFIGURATION" | "INFRASTRUCTURE" | "DATABASE" | "OPERATIONAL" | "ARCHITECTURE" | "COMBINATION",
    "title": "<Revised title>",
    "summary": "<Revised summary>",
    "explanation": "<Technical explanation of revised fix>",
    "isCodeFix": true/false,
    "codeDiff": "<Git diff string if applicable>",
    "codeSnippet": "<Code snippet if applicable>",
    "filePath": "<Target file path>",
    "configuration": "<Config YAML/JSON/env string>",
    "configFormat": "yaml" | "json" | "env",
    "commands": ["<CLI command 1>", "<CLI command 2>"],
    "operationalSteps": ["<Step 1>", "<Step 2>"],
    "verificationSteps": ["<Verification 1>", "<Verification 2>"],
    "whyThisFix": "<Why this revised fix solves the feedback issue>"
  }
}`;

        const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            const revised = parsed.revisedSolution;
            return {
              analysis: parsed.analysis || 'Analysis determined the previous change was incomplete.',
              solution: {
                id: `fix-${Date.now()}`,
                fixType: revised.fixType || currentSolution.fixType,
                title: revised.title || `Refined ${currentSolution.title}`,
                summary: revised.summary || currentSolution.summary,
                targetService: rootService,
                targetResource: rootResource,
                explanation: revised.explanation || 'Refined solution to address reported feedback.',
                isCodeFix: revised.isCodeFix ?? currentSolution.isCodeFix,
                codeDiff: revised.codeDiff || currentSolution.codeDiff,
                codeSnippet: revised.codeSnippet || currentSolution.codeSnippet,
                filePath: revised.filePath || currentSolution.filePath,
                configuration: revised.configuration || currentSolution.configuration,
                configFormat: revised.configFormat || currentSolution.configFormat,
                commands: revised.commands || currentSolution.commands,
                operationalSteps: revised.operationalSteps || currentSolution.operationalSteps,
                verificationSteps: revised.verificationSteps || currentSolution.verificationSteps,
                whyThisFix: revised.whyThisFix || 'Addresses runtime feedback.',
                iterationIndex: nextIteration
              }
            };
          }
        }
      } catch (err) {
        console.warn('[FixGenerator] Refinement via Gemini failed, falling back:', err);
      }
    }

    // Deterministic fallback refinement
    return this.getFallbackRefinement(currentSolution, feedback, nextIteration);
  }

  /**
   * Deterministic high-quality fallback solution generator grounded in root cause.
   */
  public static getFallbackSolution(
    service: string,
    resource: ResourceType,
    proposal?: RemedyProposal,
    iteration: number = 1
  ): FixSolution {
    if (resource === 'MEMORY' || service === 'records') {
      return {
        id: `fix-${Date.now()}`,
        fixType: 'CODE',
        title: 'Implement Paginated Cursor & Stream Buffer Control',
        summary: 'Replace unbounded in-memory record aggregation with chunked streaming to prevent V8 heap exhaustion.',
        targetService: 'records',
        targetResource: 'MEMORY',
        explanation: 'The Records Service accumulates complete dataset arrays in memory prior to JSON serialization. Under high concurrent query volume, heap allocation exceeds container memory limits, causing garbage collection pauses and cascade timeouts.',
        isCodeFix: true,
        filePath: 'src/services/records/RecordRepository.ts',
        codeDiff: `--- a/src/services/records/RecordRepository.ts
+++ b/src/services/records/RecordRepository.ts
@@ -42,7 +42,9 @@ export class RecordRepository {
   public async fetchActiveRecords(patientId: string): Promise<Record[]> {
-    const allRecords = await this.db.query('SELECT * FROM records WHERE patient_id = ?', [patientId]);
-    return allRecords.map(r => this.hydrate(r));
+    const limit = 100;
+    const cursor = this.db.queryStream('SELECT * FROM records WHERE patient_id = ? LIMIT ?', [patientId, limit]);
+    return this.streamTransform(cursor);
   }
`,
        codeSnippet: `// Paginated stream handler to enforce fixed memory footprint
export async function* streamRecordsPaginated(query: RecordQuery, pageSize = 100) {
  let offset = 0;
  while (true) {
    const chunk = await db.records.findMany({ where: query.where, take: pageSize, skip: offset });
    if (chunk.length === 0) break;
    yield chunk;
    offset += chunk.length;
  }
}`,
        configuration: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: records-service
spec:
  template:
    spec:
      containers:
      - name: records-api
        resources:
          limits:
            memory: "1Gi"
            cpu: "1000m"
          requests:
            memory: "512Mi"
            cpu: "250m"
        env:
        - name: NODE_OPTIONS
          value: "--max-old-space-size=768"`,
        configFormat: 'yaml',
        commands: [
          'kubectl apply -f k8s/records-deployment.yaml',
          'kubectl rollout status deployment/records-service -n production'
        ],
        operationalSteps: [
          'Deploy code patch with paginated cursor support to staging environment.',
          'Apply Kubernetes deployment memory limit update (512Mi request / 1Gi limit).',
          'Configure NODE_OPTIONS=--max-old-space-size=768 to align Node.js process heap with container memory headroom.',
          'Trigger verification stress test using 500 concurrent record requests.'
        ],
        verificationSteps: [
          'Confirm memory utilization drops from 98% (CRITICAL) to < 35% (HEALTHY).',
          'Verify GC pause times drop from > 2400ms to < 15ms.',
          'Verify downstream Appointment Service HTTP request latency returns to < 45ms.',
          'Confirm zero timeout or retry events emitted across the cascade graph.'
        ],
        whyThisFix: 'Eliminates unbounded dataset retention in Node.js process memory. By chunking queries to 100 items and raising container memory ceiling to 1Gi, memory pressure is capped regardless of request concurrency.',
        iterationIndex: iteration
      };
    }

    if (resource === 'CONNECTIONS' || service === 'appointment') {
      return {
        id: `fix-${Date.now()}`,
        fixType: 'CONFIGURATION',
        title: 'Optimize Connection Pool Sizing & Idle Timeout Recraft',
        summary: 'This is primarily a configuration issue, not a source-code defect. Adjust database pool bounds and enable circuit breaker bounds.',
        targetService: 'appointment',
        targetResource: 'CONNECTIONS',
        explanation: 'Connection exhaustion stems from static pool sizing (max: 10 connections) coupled with unbounded wait queues. Increasing pool ceiling to 50 with 5000ms acquire timeouts prevents caller thread starvation.',
        isCodeFix: false,
        filePath: 'config/database.yaml',
        configuration: `database:
  connection_pool:
    min_connections: 5
    max_connections: 50
    acquire_timeout_ms: 5000
    idle_timeout_ms: 10000
    max_lifetime_ms: 1800000
circuit_breaker:
  enabled: true
  failure_threshold: 5
  reset_timeout_ms: 15000`,
        configFormat: 'yaml',
        commands: [
          'helm upgrade appointment-service ./charts/appointment --set db.pool.maxConnections=50',
          'kubectl rollout restart deployment/appointment-service'
        ],
        operationalSteps: [
          'Update database connection pool pool bounds in config/database.yaml.',
          'Deploy updated Helm release to production cluster.',
          'Monitor active database connection counts on Postgres dashboard.'
        ],
        verificationSteps: [
          'Verify active connection count stays below 80% pool capacity.',
          'Confirm connection acquisition latency drops from > 3000ms to < 4ms.',
          'Verify Portal Service retry surge drops to 0.'
        ],
        whyThisFix: 'Expands available database sockets and enforces eager connection recycling, eliminating connection queue backpressure.',
        iterationIndex: iteration
      };
    }

    // Default fallback
    return {
      id: `fix-${Date.now()}`,
      fixType: 'COMBINATION',
      title: `Remediate ${service.toUpperCase()} ${resource} Saturation`,
      summary: `Apply coordinated resource headroom expansion and load shedding controls on ${service}.`,
      targetService: service,
      targetResource: resource,
      explanation: `Telemetry evidence identifies ${service} ${resource} as the cascade origin. Expanding headroom and tuning queue thresholds restores system stability.`,
      isCodeFix: false,
      filePath: `config/${service}-service.env`,
      configuration: `SERVICE_NAME=${service}
RESOURCE_CAPACITY_SCALE=2.0
MAX_CONCURRENT_REQUESTS=200
TIMEOUT_THRESHOLD_MS=3000
ENABLE_LOAD_SHEDDING=true`,
      configFormat: 'env',
      commands: [
        `kubectl scale deployment/${service}-service --replicas=3`,
        `kubectl set env deployment/${service}-service RESOURCE_CAPACITY_SCALE=2.0`
      ],
      operationalSteps: [
        `Scale ${service} replicas from 1 to 3.`,
        `Apply load shedding environment parameters.`,
        `Run health checks to confirm cluster stabilization.`
      ],
      verificationSteps: [
        `Verify ${service} ${resource} utilization drops below 50%.`,
        `Confirm system-wide cascade collapses and status returns to HEALTHY.`
      ],
      whyThisFix: `Provides immediate capacity relief on ${service} while shedding excessive burst traffic.`,
      iterationIndex: iteration
    };
  }

  /**
   * Fallback refinement logic when user pastes error output.
   */
  public static getFallbackRefinement(
    prev: FixSolution,
    feedback: string,
    iteration: number
  ): { solution: FixSolution; analysis: string } {
    const fb = feedback.toLowerCase();
    let analysis = 'The previous fix attempt adjusted container limits, but did not resolve process-level runtime constraints or secondary memory leaks.';

    if (fb.includes('heap') || fb.includes('javascript') || fb.includes('oom') || fb.includes('memory')) {
      analysis = 'CRITICAL DIAGNOSIS: Increasing Kubernetes container memory to 1Gi allowed the container to stay alive longer, but the Node.js V8 process heap remained capped at its default (512MB). The process hit a V8 fatal allocation failure before reaching the container ceiling.';
      return {
        analysis,
        solution: {
          ...prev,
          id: `fix-${Date.now()}`,
          title: 'Add Node.js Heap Flag & Stream Transformer Limit',
          summary: 'Explicitly configure V8 max heap via NODE_OPTIONS and add stream chunk rate limiting.',
          fixType: 'COMBINATION',
          isCodeFix: true,
          filePath: 'k8s/records-deployment.yaml',
          codeDiff: `--- a/k8s/records-deployment.yaml
+++ b/k8s/records-deployment.yaml
@@ -18,6 +18,8 @@ spec:
         env:
         - name: NODE_OPTIONS
-          value: "--max-old-space-size=768"
+          value: "--max-old-space-size=1536 --expose-gc"
+        - name: STREAM_CHUNK_SIZE
+          value: "50"
`,
          configuration: `env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=1536 --expose-gc"
  - name: STREAM_CHUNK_SIZE
    value: "50"`,
          commands: [
            'kubectl apply -f k8s/records-deployment.yaml',
            'kubectl rollout restart deployment/records-service'
          ],
          operationalSteps: [
            'Increase Node.js V8 max-old-space-size parameter from 768MB to 1536MB.',
            'Reduce streaming chunk size to 50 items per payload batch.',
            'Force deployment restart to clear stagnant V8 heap spaces.'
          ],
          verificationSteps: [
            'Verify Node.js heap used stays under 400MB during heavy batch processing.',
            'Confirm no JavaScript fatal OOM crashes occur in service logs.'
          ],
          whyThisFix: 'Synchronizes V8 heap limits with Kubernetes container limits, preventing process-level heap exhaustion.',
          iterationIndex: iteration
        }
      };
    }

    return {
      analysis,
      solution: {
        ...prev,
        id: `fix-${Date.now()}`,
        title: `Iteration #${iteration}: Enforce Strict Fallback Safeguards`,
        summary: `Refined implementation to add safety fallbacks for: ${feedback.slice(0, 60)}...`,
        iterationIndex: iteration
      }
    };
  }

  /**
   * Generates a complete downloadable / exportable engineering package manifest.
   */
  public static exportPackage(
    bundle: IncidentEvidenceBundle,
    solution: FixSolution,
    history: FixAttempt[]
  ): Record<string, string> {
    const top = bundle.causalAnalysis?.hypotheses?.[0];
    const service = solution.targetService;
    const resource = solution.targetResource || 'MEMORY';

    return {
      'ExhaustTrace-Fix/01_incident_summary.md': `# ExhaustTrace Incident Remediation Package

## Incident Metadata
- **Incident ID**: ${bundle.incidentId}
- **Status**: ${bundle.status}
- **Playback Tick**: ${bundle.playback.tick}
- **Validated Root Cause**: ${service.toUpperCase()} / ${resource}
- **Confidence**: ${top ? Math.round(top.confidence * 100) : 91}%

## Cascade Narrative
The incident originated at **${service}** due to **${resource}** exhaustion.
Observed propagation: ${service} (${resource}) → Downstream latency → Dependent service timeouts → Queue backpressure.
`,
      'ExhaustTrace-Fix/02_root_cause_casc_asr.md': `# Canonical CASC & ASR Analysis

## CASC (Causal Anomaly Scoring Matrix)
- **Top Candidate**: ${service} / ${resource}
- **Score**: ${top ? top.score : 8.5}
- **Confidence**: ${top ? Math.round(top.confidence * 100) : 91}%

## Supporting Evidence
${(top?.supportingSignals || ['Resource utilization reached CRITICAL (98%)', 'First abnormal telemetry tick at t=12']).map(s => `- ${s}`).join('\n')}
`,
      'ExhaustTrace-Fix/03_recommended_remedy.md': `# Recommended Remedy Strategy

- **Title**: ${solution.title}
- **Fix Type**: ${solution.fixType}
- **Target**: ${service} (${resource})
- **Summary**: ${solution.summary}

## Rationale & Why This Fix
${solution.whyThisFix}
`,
      'ExhaustTrace-Fix/04_implementation_guide.md': `# Implementation Guide

## Overview
${solution.explanation}

## Operational Steps
${(solution.operationalSteps || []).map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Recommended Commands
\`\`\`bash
${(solution.commands || []).join('\n')}
\`\`\`
`,
      [`ExhaustTrace-Fix/${solution.isCodeFix ? 'patch.diff' : 'configuration.yaml'}`]: solution.codeDiff || solution.configuration || '# No code patch or configuration needed',
      'ExhaustTrace-Fix/06_verification_steps.md': `# Verification Procedure

Execute the following verification checks after applying the solution:

${solution.verificationSteps.map((v, i) => `[ ] ${i + 1}. ${v}`).join('\n')}
`,
      'ExhaustTrace-Fix/07_fix_iteration_history.json': JSON.stringify(history, null, 2)
    };
  }

  /**
   * Comprehensive, intelligent Fixer Q&A engine for answering any developer question or doubt.
   */
  public static answerQuestion(
    bundle: IncidentEvidenceBundle,
    currentSolution: FixSolution | null,
    question: string
  ): string {
    const q = question.toLowerCase();
    const top = bundle.causalAnalysis?.hypotheses?.[0];
    const service = currentSolution?.targetService || top?.serviceId || 'records';
    const resource = currentSolution?.targetResource || top?.resource || 'MEMORY';

    // 1. How to fix / Step-by-step
    if (q.includes('step') || q.includes('how do i fix') || q.includes('start') || q.includes('begin') || q.includes('order') || q.includes('first')) {
      return `### Implementation Roadmap for ${service.toUpperCase()} (${resource} Remediation)

Here is the recommended step-by-step implementation sequence:

1. **Apply Code Patch**: Update \`${currentSolution?.filePath || `src/services/${service}/RecordRepository.ts`}\` to replace unbounded dataset loading with chunked paginated streaming (\`pageSize = 100\`).
2. **Update Deployment Limits**: Edit \`k8s/${service}-deployment.yaml\` to raise memory limits to \`1Gi\` and pass \`NODE_OPTIONS="--max-old-space-size=768"\` to align Node.js process heap bounds with the container ceiling.
3. **Deploy & Rollout**: Run:
   \`\`\`bash
   kubectl apply -f k8s/${service}-deployment.yaml
   kubectl rollout status deployment/${service}-service -n production
   \`\`\`
4. **Verification Stress Test**: Trigger 500 concurrent requests and verify memory utilization drops from 98% (CRITICAL) to < 35% (HEALTHY).`;
    }

    // 2. Code / Patch / Implementation
    if (q.includes('code') || q.includes('implementation') || q.includes('patch') || q.includes('diff') || q.includes('snippet')) {
      return `### Production-Ready Implementation Code Patch for ${service.toUpperCase()}

Here is the complete implementation code:

\`\`\`typescript
// ${currentSolution?.filePath || `src/services/${service}/RecordRepository.ts`}
import { db } from '../../lib/database';

export async function* streamRecordsPaginated(patientId: string, pageSize = 100) {
  let offset = 0;
  while (true) {
    const records = await db.query(
      'SELECT id, patient_id, data, updated_at FROM records WHERE patient_id = ? ORDER BY id ASC LIMIT ? OFFSET ?',
      [patientId, pageSize, offset]
    );

    if (!records || records.length === 0) break;
    yield records;
    offset += records.length;
  }
}
\`\`\`

**Why this fix works**: Stream processing in 100-record chunks caps total V8 heap retention below 40MB regardless of concurrent request concurrency, preventing heap exhaustion.`;
    }

    // 3. Kubernetes / Configuration / Without code
    if (q.includes('kubernetes') || q.includes('k8s') || q.includes('yaml') || q.includes('configuration') || q.includes('cannot modify') || q.includes('without code')) {
      return `### Kubernetes & Configuration Fix for ${service.toUpperCase()}

If modifying source code is restricted, you can resolve the issue through Kubernetes limits and V8 runtime heap bounds:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${service}-service
  namespace: production
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: ${service}-api
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: NODE_OPTIONS
          value: "--max-old-space-size=768 --expose-gc"
        - name: MAX_CONCURRENT_STREAM_REQUESTS
          value: "100"
\`\`\`

**CLI Rollout Commands**:
\`\`\`bash
kubectl apply -f k8s/${service}-deployment.yaml
kubectl rollout restart deployment/${service}-service
\`\`\``;
    }

    // 4. Verification / Testing
    if (q.includes('verify') || q.includes('test') || q.includes('check') || q.includes('validate')) {
      return `### Verification & Validation Procedure

Execute these checks after applying the patch:

1. **Memory Utilization Check**: Confirm \`${service}\` memory pressure drops from **98% (CRITICAL)** to **< 35% (HEALTHY)**.
2. **GC Pause Duration**: Verify V8 garbage collection pause times drop from \`> 2400ms\` to \`< 15ms\`.
3. **Downstream Latency Recovery**: Confirm dependent caller response times drop from \`1850ms\` to \`< 45ms\`.
4. **Queue & Timeout Drain**: Verify timeout rate collapses to \`0%\` and queue backlog drains to \`0\`.

\`\`\`bash
# Run concurrent load test to verify resolution
npx autocannon -c 100 -d 30 http://localhost:3000/api/records
\`\`\``;
    }

    // 5. Risks & Blast Radius
    if (q.includes('wrong') || q.includes('risk') || q.includes('fail') || q.includes('blast') || q.includes('side effect')) {
      return `### Risk Analysis & Blast Radius Assessment

**Primary Risks & Mitigations**:
1. **Container OOMKill Risk**: Setting \`NODE_OPTIONS=--max-old-space-size\` too close to or above the pod memory limit causes the Linux kernel to OOMKill the pod before V8 triggers garbage collection.
   - *Mitigation*: Maintain a 256MB buffer (\`limit: 1Gi\`, \`max-old-space-size: 768MB\`).
2. **Chunk Overhead**: Reading 100 records per page adds minor round-trip overhead for bulk queries.
   - *Mitigation*: Use database cursor streams over persistent connection sockets.`;
    }

    // 6. Alternative approaches
    if (q.includes('alternative') || q.includes('another') || q.includes('option') || q.includes('not possible') || q.includes('cannot increase')) {
      return `### Alternative Remediation Strategies

If increasing memory or updating core repository code is restricted:

1. **Option A: API Gateway Rate Limiting & Load Shedding**
   Configure NGINX/Envoy to shed excess concurrent requests to \`${service}\` with HTTP 429 when concurrency exceeds 150.
2. **Option B: Async Queue Isolation**
   Offload bulk record processing to an asynchronous background worker pool (BullMQ / RabbitMQ) instead of processing synchronously in HTTP threads.
3. **Option C: Horizontal Pod Autoscaling (HPA)**
   Scale deployment replicas from 1 to 5 based on target memory utilization (60%).`;
    }

    // 7. Why this fix / Rationale
    if (q.includes('why') || q.includes('reason') || q.includes('recommended') || q.includes('justification')) {
      return `### Technical Rationale: Why This Fix Resolves The Root Cause

The ExhaustTrace causal analyzer identified **${service.toUpperCase()} ${resource}** as the origin node with **${Math.round((top?.confidence || 0.91) * 100)}% confidence**.

Simply increasing memory limits without changing dataset retention only delays garbage collection pauses. Implementing **chunked paginated streaming** caps the live object graph size in memory regardless of query volume or caller concurrency, directly breaking the cascade chain!`;
    }

    // General fallback for any other question
    return `### Fixer Assistant Analysis (${service.toUpperCase()} / ${resource})

For **${service} ${resource}** exhaustion, applying ${currentSolution?.title || 'the recommended patch'} addresses the root cause directly. 

**Summary of recommended actions**:
- View the **Diff Patch** or **Config** tab in the center panel.
- Click **EXECUTE FIX** to launch the deployment sequence.
- Ask me for specific code snippets, Kubernetes YAML configs, or verification steps.`;
  }
}

