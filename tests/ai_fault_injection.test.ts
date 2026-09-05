/**
 * Block 7: AI Fault Injection Tests — 25 tests
 * Tests FaultValidator: valid commands, ambiguous, unsupported resource/service/severity, double validation.
 */
import { describe, it, expect } from 'vitest';
import { FaultValidator, SUPPORTED_SERVICES, SUPPORTED_RESOURCES, SUPPORTED_SEVERITIES } from '../backend/src/ai/FaultValidator';

describe('Block 7 — FaultValidator: Valid Commands', () => {
  // Test 1
  it('accepts valid records/MEMORY/CRITICAL', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'MEMORY', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command).toMatchObject({ serviceId: 'records', resource: 'MEMORY', severity: 'CRITICAL' });
    expect(result.errors).toHaveLength(0);
  });

  // Test 2
  it('accepts valid records/CPU/CRITICAL', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'CPU', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command?.resource).toBe('CPU');
  });

  // Test 3
  it('accepts valid records/CONNECTIONS/HIGH', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'CONNECTIONS', severity: 'HIGH' });
    expect(result.valid).toBe(true);
    expect(result.command?.resource).toBe('CONNECTIONS');
    expect(result.command?.severity).toBe('HIGH');
  });

  // Test 4
  it('accepts valid records/WORKERS/CRITICAL', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'WORKERS', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command?.resource).toBe('WORKERS');
  });

  // Test 5
  it('accepts valid appointment/WORKERS/CRITICAL', () => {
    const result = FaultValidator.validate({ serviceId: 'appointment', resource: 'WORKERS', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command?.serviceId).toBe('appointment');
  });

  // Test 6
  it('accepts valid appointment/MEMORY/MEDIUM', () => {
    const result = FaultValidator.validate({ serviceId: 'appointment', resource: 'MEMORY', severity: 'MEDIUM' });
    expect(result.valid).toBe(true);
    expect(result.command?.severity).toBe('MEDIUM');
  });

  // Test 7
  it('normalizes service name to lowercase', () => {
    const result = FaultValidator.validate({ serviceId: 'Records', resource: 'MEMORY', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command?.serviceId).toBe('records');
  });

  // Test 8
  it('normalizes resource to uppercase', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'memory', severity: 'CRITICAL' });
    expect(result.valid).toBe(true);
    expect(result.command?.resource).toBe('MEMORY');
  });

  // Test 9
  it('normalizes severity to uppercase', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'CPU', severity: 'critical' });
    expect(result.valid).toBe(true);
    expect(result.command?.severity).toBe('CRITICAL');
  });

  // Test 10
  it('accepts LOW severity', () => {
    const result = FaultValidator.validate({ serviceId: 'portal', resource: 'CPU', severity: 'LOW' });
    expect(result.valid).toBe(true);
    expect(result.command?.severity).toBe('LOW');
  });
});

describe('Block 7 — FaultValidator: Unsupported Resource', () => {
  // Test 11
  it('rejects GPU_MEMORY as unsupported resource', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'GPU_MEMORY', severity: 'CRITICAL' });
    expect(result.valid).toBe(false);
    expect(result.command).toBeNull();
    expect(result.errors.some(e => e.toLowerCase().includes('gpu_memory') || e.toLowerCase().includes('not a supported'))).toBe(true);
  });

  // Test 12
  it('rejects DISK_IO as unsupported resource', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'DISK_IO', severity: 'CRITICAL' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Test 13
  it('rejects NETWORK as unsupported resource', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'NETWORK', severity: 'HIGH' });
    expect(result.valid).toBe(false);
  });

  // Test 14
  it('rejects empty resource', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: '', severity: 'CRITICAL' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('resource'))).toBe(true);
  });
});

describe('Block 7 — FaultValidator: Unsupported Service', () => {
  // Test 15
  it('rejects database as unsupported service', () => {
    const result = FaultValidator.validate({ serviceId: 'database', resource: 'MEMORY', severity: 'CRITICAL' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('database'))).toBe(true);
  });

  // Test 16
  it('rejects unknown service name', () => {
    const result = FaultValidator.validate({ serviceId: 'billing-service', resource: 'CPU', severity: 'HIGH' });
    expect(result.valid).toBe(false);
  });

  // Test 17
  it('rejects empty service', () => {
    const result = FaultValidator.validate({ serviceId: '', resource: 'MEMORY', severity: 'CRITICAL' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('serviceId'))).toBe(true);
  });
});

describe('Block 7 — FaultValidator: Unsupported Severity', () => {
  // Test 18
  it('rejects EXTREME as unsupported severity', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'MEMORY', severity: 'EXTREME' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('extreme'))).toBe(true);
  });

  // Test 19
  it('rejects CATASTROPHIC as unsupported severity', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'CPU', severity: 'CATASTROPHIC' });
    expect(result.valid).toBe(false);
  });

  // Test 20
  it('rejects empty severity', () => {
    const result = FaultValidator.validate({ serviceId: 'records', resource: 'MEMORY', severity: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('severity'))).toBe(true);
  });
});

describe('Block 7 — FaultValidator: Multiple Errors', () => {
  // Test 21
  it('returns multiple errors for multiple invalid fields', () => {
    const result = FaultValidator.validate({ serviceId: 'invalid-svc', resource: 'GPU', severity: 'EXTREME' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  // Test 22
  it('returns 3 errors for all invalid fields', () => {
    const result = FaultValidator.validate({ serviceId: '', resource: '', severity: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});

describe('Block 7 — FaultValidator: Double Validation Integrity', () => {
  // Test 23
  it('supported services list matches expected set', () => {
    expect(SUPPORTED_SERVICES).toContain('records');
    expect(SUPPORTED_SERVICES).toContain('appointment');
    expect(SUPPORTED_SERVICES).toContain('portal');
    expect(SUPPORTED_SERVICES).not.toContain('database');
    expect(SUPPORTED_SERVICES).not.toContain('gpu-service');
  });

  // Test 24
  it('supported resources are exactly the 4 ExhaustTrace types', () => {
    expect(SUPPORTED_RESOURCES).toEqual(['CPU', 'MEMORY', 'CONNECTIONS', 'WORKERS']);
  });

  // Test 25
  it('supported severities are exactly LOW, MEDIUM, HIGH, CRITICAL', () => {
    expect(SUPPORTED_SEVERITIES).toContain('LOW');
    expect(SUPPORTED_SEVERITIES).toContain('MEDIUM');
    expect(SUPPORTED_SEVERITIES).toContain('HIGH');
    expect(SUPPORTED_SEVERITIES).toContain('CRITICAL');
    expect(SUPPORTED_SEVERITIES).not.toContain('NONE');
    expect(SUPPORTED_SEVERITIES).not.toContain('EXTREME');
  });
});
