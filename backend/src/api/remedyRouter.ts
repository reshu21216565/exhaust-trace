import { Router, Request, Response } from 'express';
import { IncidentOrchestrator } from '../orchestrator/IncidentOrchestrator';
import { RemedyPlanner } from '../remedy/RemedyPlanner';
import { RemedySimulator } from '../remedy/RemedySimulator';
import { RemedyValidator } from '../remedy/RemedyValidator';
import { buildSafeContext } from '../ai/GeminiClient';
import type { RemedyProposal, RemedySimulationResult, RemedyComparison, ResourceType } from '@exhausttrace/shared';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

export function createRemedyRouter(orchestrator: IncidentOrchestrator): Router {
  const router = Router();

  /**
   * POST /api/v1/remedy/generate
   * Generates remediation proposals for the active incident.
   */
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const bundle = orchestrator.getBundle();
      if (!bundle) {
        return res.status(404).json({ errorCode: 'NO_ACTIVE_INCIDENT', message: 'No active incident found.' });
      }

      const { proposals, geminiAvailable } = await RemedyPlanner.generateRemedies(bundle);

      // Store in orchestrator bundle if supported
      (bundle as any).remedyProposals = proposals;

      return res.json({
        incidentId: bundle.incidentId,
        proposals,
        geminiAvailable,
        timestamp: Date.now()
      });
    } catch (err: any) {
      return res.status(500).json({ errorCode: 'REMEDY_GENERATE_ERROR', message: err?.message || 'Failed to generate remedies' });
    }
  });

  /**
   * POST /api/v1/remedy/simulate
   * Runs an isolated simulation fork for a specified proposal.
   */
  router.post('/simulate', (req: Request, res: Response) => {
    try {
      const { proposal } = req.body;
      if (!proposal) {
        return res.status(400).json({ errorCode: 'MISSING_PROPOSAL', message: 'Remedy proposal is required' });
      }

      const validation = RemedyValidator.validateProposal(proposal);
      if (!validation.valid || !validation.sanitizedProposal) {
        return res.status(422).json({ errorCode: 'INVALID_REMEDY_PROPOSAL', message: validation.reason });
      }

      const liveWorld = orchestrator.getOrCreateWorld();
      const result = RemedySimulator.simulateRemedy(liveWorld, validation.sanitizedProposal, 50);

      const bundle = orchestrator.getBundle();
      if (bundle) {
        if (!bundle.remedySimulations) bundle.remedySimulations = {};
        bundle.remedySimulations[validation.sanitizedProposal.id] = result;
      }

      return res.json({
        proposalId: validation.sanitizedProposal.id,
        simulation: result
      });
    } catch (err: any) {
      return res.status(500).json({ errorCode: 'SIMULATION_ERROR', message: err?.message || 'Failed to simulate remedy' });
    }
  });

  /**
   * POST /api/v1/remedy/compare
   * Simulates all available simulatable proposals and returns a comparison.
   */
  router.post('/compare', async (req: Request, res: Response) => {
    try {
      const { proposals } = req.body;
      const liveWorld = orchestrator.getOrCreateWorld();
      const bundle = orchestrator.getBundle();

      if (!liveWorld || !bundle) {
        return res.status(404).json({ errorCode: 'NO_ACTIVE_INCIDENT', message: 'No active incident found' });
      }

      let activeProposals: RemedyProposal[] = Array.isArray(proposals) ? proposals : (bundle.remedyProposals || []);
      
      if (activeProposals.length === 0) {
        const generated = await RemedyPlanner.generateRemedies(bundle);
        activeProposals = generated.proposals;
        bundle.remedyProposals = activeProposals;
      }

      const simulatable = activeProposals.filter(p => p.simulatable);
      const simulations: RemedySimulationResult[] = [];

      for (const p of simulatable) {
        const val = RemedyValidator.validateProposal(p);
        if (val.valid && val.sanitizedProposal) {
          const sim = RemedySimulator.simulateRemedy(liveWorld, val.sanitizedProposal, 50);
          simulations.push(sim);
        }
      }

      // Pick recommended remedy (highest effectiveness score)
      simulations.sort((a, b) => b.effectivenessScore - a.effectivenessScore);
      const recommendedRemedyId = simulations[0]?.remedyId;

      const comparison: RemedyComparison = {
        incidentId: bundle.incidentId,
        baselineTrajectory: [],
        remedySimulations: simulations,
        recommendedRemedyId
      };

      return res.json(comparison);
    } catch (err: any) {
      return res.status(500).json({ errorCode: 'COMPARE_ERROR', message: err?.message || 'Failed to compare remedies' });
    }
  });

  /**
   * POST /api/v1/remedy/apply
   * Explicitly applies a validated remedy to the live incident session.
   */
  router.post('/apply', (req: Request, res: Response) => {
    try {
      const { proposalId, confirmed } = req.body;
      if (!confirmed) {
        return res.status(400).json({ errorCode: 'CONFIRMATION_REQUIRED', message: 'Explicit confirmation is required to apply a remedy to the live session' });
      }

      const bundle = orchestrator.getBundle();
      const liveWorld = orchestrator.getWorld();

      if (!bundle || !liveWorld) {
        return res.status(404).json({ errorCode: 'NO_ACTIVE_INCIDENT', message: 'No active incident' });
      }

      const proposal = (bundle.remedyProposals || []).find(p => p.id === proposalId);
      if (!proposal) {
        return res.status(404).json({ errorCode: 'PROPOSAL_NOT_FOUND', message: `Remedy proposal ${proposalId} not found` });
      }

      const validation = RemedyValidator.validateProposal(proposal);
      if (!validation.valid || !validation.sanitizedProposal) {
        return res.status(422).json({ errorCode: 'INVALID_PROPOSAL', message: validation.reason });
      }

      const sanitized = validation.sanitizedProposal;
      const targetService = sanitized.targetService || 'records';
      const targetResource = (sanitized.targetResource || 'MEMORY') as ResourceType;

      // Apply to live world
      liveWorld.relieveExhaustion(targetService, targetResource);
      bundle.selectedRemedyId = sanitized.id;

      return res.json({
        success: true,
        appliedRemedy: sanitized,
        message: `Applied ${sanitized.title} to live incident state. Target: ${targetService}/${targetResource}.`
      });
    } catch (err: any) {
      return res.status(500).json({ errorCode: 'APPLY_ERROR', message: err?.message || 'Failed to apply remedy' });
    }
  });

  /**
   * POST /api/v1/remedy/ask
   * Natural-language Q&A specifically focused on remediation options and trade-offs.
   */
  router.post('/ask', async (req: Request, res: Response) => {
    try {
      const { question } = req.body;
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ errorCode: 'MISSING_QUESTION', message: 'Question string is required' });
      }

      const bundle = orchestrator.getBundle();
      if (!bundle) {
        return res.status(404).json({ errorCode: 'NO_ACTIVE_INCIDENT', message: 'No active incident' });
      }

      const safeContext = buildSafeContext(bundle);
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.json({
          answer: `Based on current evidence, the primary root candidate is ${bundle.causalAnalysis?.hypotheses?.[0]?.candidateId || 'records/MEMORY'}. Expanding capacity on this root resource is the most effective fix.`,
          geminiAvailable: false
        });
      }

      const systemInstruction = `You are ExhaustTrace Remedy Advisor. Answer user questions about remediation strategies, risks, and trade-offs based strictly on the supplied incident evidence. Do NOT invent fake telemetry.`;

      const prompt = `Incident Evidence Context:\n${JSON.stringify(safeContext, null, 2)}\n\nUser Question about Remedies:\n${question}`;

      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return res.json({
          answer: `Remedy analysis fallback: Root cause is ${bundle.causalAnalysis?.hypotheses?.[0]?.candidateId || 'records/MEMORY'}. Simulating capacity relief shows high recovery effectiveness.`,
          geminiAvailable: false
        });
      }

      const json = await response.json();
      const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No response generated.';

      return res.json({ answer, geminiAvailable: true });
    } catch (err: any) {
      return res.status(500).json({ errorCode: 'ASK_REMEDY_ERROR', message: err?.message || 'Failed to process remedy question' });
    }
  });

  return router;
}
