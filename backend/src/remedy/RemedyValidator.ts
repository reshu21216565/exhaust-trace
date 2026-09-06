import type { RemedyProposal, ResourceType } from '@exhausttrace/shared';
import { SUPPORTED_SERVICES, SUPPORTED_RESOURCES } from '../ai/FaultValidator';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedProposal?: RemedyProposal;
}

const SUPPORTED_ACTIONS = new Set([
  'RELIEVE_RESOURCE',
  'ADJUST_CAPACITY',
  'REDUCE_RETRY_PRESSURE',
  'RATE_LIMIT',
  'SHED_LOAD',
  'ADVISORY'
]);

export class RemedyValidator {
  public static validateProposal(proposal: Partial<RemedyProposal>): ValidationResult {
    if (!proposal.id || !proposal.title || !proposal.category || !proposal.action) {
      return { valid: false, reason: 'Missing required fields (id, title, category, action)' };
    }

    if (!['MITIGATE', 'FIX', 'PREVENT'].includes(proposal.category)) {
      return { valid: false, reason: `Invalid category: ${proposal.category}` };
    }

    if (!SUPPORTED_ACTIONS.has(proposal.action)) {
      return { valid: false, reason: `Unsupported action: ${proposal.action}` };
    }

    // Check service if specified
    if (proposal.targetService) {
      const svc = proposal.targetService.toLowerCase();
      if (!SUPPORTED_SERVICES.includes(svc as any)) {
        return { valid: false, reason: `Unsupported target service: ${proposal.targetService}` };
      }
    }

    // Check resource if specified
    if (proposal.targetResource) {
      const res = proposal.targetResource.toUpperCase() as ResourceType;
      if (!SUPPORTED_RESOURCES.includes(res)) {
        return { valid: false, reason: `Unsupported target resource: ${proposal.targetResource}` };
      }
    }

    // Determine if simulatable
    const isAdvisory = proposal.action === 'ADVISORY' || proposal.category === 'PREVENT';
    const isSimulatable = Boolean(
      !isAdvisory &&
      proposal.targetService &&
      proposal.targetResource &&
      ['RELIEVE_RESOURCE', 'ADJUST_CAPACITY', 'REDUCE_RETRY_PRESSURE', 'RATE_LIMIT', 'SHED_LOAD'].includes(proposal.action)
    );

    const sanitized: RemedyProposal = {
      id: String(proposal.id),
      category: proposal.category,
      title: String(proposal.title).trim(),
      description: String(proposal.description || '').trim(),
      targetService: proposal.targetService ? proposal.targetService.toLowerCase() : undefined,
      targetResource: proposal.targetResource ? (proposal.targetResource.toUpperCase() as ResourceType) : undefined,
      action: proposal.action,
      parameters: proposal.parameters && typeof proposal.parameters === 'object' ? proposal.parameters : {},
      rationale: String(proposal.rationale || '').trim(),
      evidenceReferences: Array.isArray(proposal.evidenceReferences) ? proposal.evidenceReferences : [],
      expectedBenefit: proposal.expectedBenefit ? String(proposal.expectedBenefit) : undefined,
      risk: ['LOW', 'MEDIUM', 'HIGH'].includes(proposal.risk as string) ? (proposal.risk as any) : 'MEDIUM',
      confidence: typeof proposal.confidence === 'number' ? Math.max(0, Math.min(1, proposal.confidence)) : 0.8,
      simulatable: isSimulatable
    };

    return { valid: true, sanitizedProposal: sanitized };
  }
}
