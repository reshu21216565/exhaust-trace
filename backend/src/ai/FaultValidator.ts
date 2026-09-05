/**
 * FaultValidator — server-side validation of AI-generated FaultCommands.
 *
 * This module is AUTHORITATIVE. It runs twice:
 *   1. After Gemini interpretation (returning candidate + errors to UI)
 *   2. Immediately before execution (blocking any bypassed validation)
 *
 * It must NEVER be circumvented by the frontend or Gemini.
 */

import type { ResourceType } from '@exhausttrace/shared';

// ─── Canonical supported values ────────────────────────────────────────────

export const SUPPORTED_SERVICES = [
  'records',
  'appointment',
  'portal',
  'notification',
  'auth',
] as const;

export const SUPPORTED_RESOURCES: ResourceType[] = [
  'CPU',
  'MEMORY',
  'CONNECTIONS',
  'WORKERS',
];

export const SUPPORTED_SEVERITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];
export type SupportedSeverity = (typeof SUPPORTED_SEVERITIES)[number];

// ─── FaultCommand ──────────────────────────────────────────────────────────

/**
 * The canonical bridge between natural-language intent and SimulationWorld.
 * Only validated FaultCommands reach the orchestrator.
 */
export interface FaultCommand {
  serviceId: string;
  resource: ResourceType;
  severity: SupportedSeverity;
}

// ─── Validation Result ─────────────────────────────────────────────────────

export interface FaultValidationResult {
  valid: boolean;
  command: FaultCommand | null;
  errors: string[];
}

// ─── Validator ─────────────────────────────────────────────────────────────

export class FaultValidator {
  /**
   * Validate a raw fault command object (from Gemini or from user).
   * Returns a typed, normalized result.
   */
  static validate(raw: {
    serviceId?: string;
    resource?: string;
    severity?: string;
  }): FaultValidationResult {
    const errors: string[] = [];

    // Normalize inputs
    const serviceId = (raw.serviceId ?? '').toLowerCase().trim();
    const resource = (raw.resource ?? '').toUpperCase().trim() as ResourceType;
    const severity = (raw.severity ?? '').toUpperCase().trim() as SupportedSeverity;

    // Validate service
    if (!serviceId) {
      errors.push('serviceId is required');
    } else if (!SUPPORTED_SERVICES.includes(serviceId as SupportedService)) {
      errors.push(
        `"${serviceId}" is not a supported ExhaustTrace service. Supported: ${SUPPORTED_SERVICES.join(', ')}`
      );
    }

    // Validate resource
    if (!raw.resource) {
      errors.push('resource is required');
    } else if (!SUPPORTED_RESOURCES.includes(resource)) {
      errors.push(
        `"${raw.resource}" is not a supported ExhaustTrace resource. Supported: ${SUPPORTED_RESOURCES.join(', ')}`
      );
    }

    // Validate severity
    if (!raw.severity) {
      errors.push('severity is required');
    } else if (!SUPPORTED_SEVERITIES.includes(severity)) {
      errors.push(
        `"${raw.severity}" is not a supported severity. Supported: ${SUPPORTED_SEVERITIES.join(', ')}`
      );
    }

    if (errors.length > 0) {
      return { valid: false, command: null, errors };
    }

    return {
      valid: true,
      command: { serviceId, resource, severity },
      errors: [],
    };
  }
}
