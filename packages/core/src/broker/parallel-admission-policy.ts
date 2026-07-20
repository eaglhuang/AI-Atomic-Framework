// @ts-nocheck
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const parallelAdmissionPolicySchemaId = 'atm.parallelAdmissionPolicy.v1';
export const parallelAdmissionPolicySpecVersion = '0.1.0';

export type ParallelAdmissionMode = 'enforce' | 'observe';
export type ParallelAdmissionFallbackMode = 'queue-only' | 'fail-closed';
export type ParallelAdmissionGateClass = 'hard-exception' | 'ticketed-shared-write';
export type ParallelAdmissionGateId =
  | 'R1_SAME_TASK_SECOND_LANE'
  | 'R2_DEPENDENCY_GATE'
  | 'R3_SHARED_WRITE_SURFACE'
  | 'R4_SHARED_SIDE_EFFECT';

export interface ParallelAdmissionGatePolicy {
  readonly gateId: ParallelAdmissionGateId;
  readonly gateClass: ParallelAdmissionGateClass;
  readonly owner: string;
  readonly adapter: string;
  readonly statusCommand: string;
  readonly nextAction: string;
  readonly recoveryCommand: string;
  readonly canPolicyRelax: boolean;
}

export interface ParallelAdmissionPolicy {
  readonly schemaId: typeof parallelAdmissionPolicySchemaId;
  readonly specVersion: typeof parallelAdmissionPolicySpecVersion;
  readonly mode: ParallelAdmissionMode;
  readonly circuitBreakerEnabled: boolean;
  readonly fallbackMode: ParallelAdmissionFallbackMode;
  readonly rolloutScope: readonly string[];
  readonly configDigest: string;
  readonly tripped: boolean;
  readonly trippedAt: string | null;
  readonly trippedBy: string | null;
  readonly tripReason: string | null;
  readonly resetEvidenceDigest: string | null;
  readonly resetAt: string | null;
  readonly gatePolicies: readonly ParallelAdmissionGatePolicy[];
}

export interface ParallelAdmissionPolicyReceipt {
  readonly schemaId: 'atm.parallelAdmissionPolicyReceipt.v1';
  readonly action: 'status' | 'set' | 'trip' | 'reset';
  readonly actorId: string | null;
  readonly createdAt: string;
  readonly policyPath: string;
  readonly policy: ParallelAdmissionPolicy;
  readonly rollbackCommand: string;
}

export function defaultParallelAdmissionPolicy(): ParallelAdmissionPolicy {
  const base = {
    schemaId: parallelAdmissionPolicySchemaId,
    specVersion: parallelAdmissionPolicySpecVersion,
    mode: 'enforce' as ParallelAdmissionMode,
    circuitBreakerEnabled: true,
    fallbackMode: 'queue-only' as ParallelAdmissionFallbackMode,
    rolloutScope: [
      'runner-sync',
      'build',
      'release-mirror',
      'projection',
      'generated-write',
      'checkpoint',
      'closeback',
      'git-commit'
    ],
    tripped: false,
    trippedAt: null,
    trippedBy: null,
    tripReason: null,
    resetEvidenceDigest: null,
    resetAt: null,
    gatePolicies: defaultGatePolicies()
  };
  return { ...base, configDigest: digestPolicyConfig(base) };
}

export function defaultGatePolicies(): readonly ParallelAdmissionGatePolicy[] {
  return [
    {
      gateId: 'R1_SAME_TASK_SECOND_LANE',
      gateClass: 'hard-exception',
      owner: 'task-lifecycle',
      adapter: 'claim-admission',
      statusCommand: 'node atm.mjs tasks status --task <task-id> --json',
      nextAction: 'Reject same-task second-lane writes unless explicit adoption/handoff succeeds.',
      recoveryCommand: 'node atm.mjs tasks release --task <task-id> --actor <actor-id> --reason "<handoff reason>" --json',
      canPolicyRelax: false
    },
    {
      gateId: 'R2_DEPENDENCY_GATE',
      gateClass: 'hard-exception',
      owner: 'task-dependency',
      adapter: 'next-claim-readiness',
      statusCommand: 'node atm.mjs tasks status --task <dependency-id> --json',
      nextAction: 'Wait for dependency closeback or choose another independent task.',
      recoveryCommand: 'node atm.mjs next --prompt "<dependency completion or independent task prompt>" --json',
      canPolicyRelax: false
    },
    {
      gateId: 'R3_SHARED_WRITE_SURFACE',
      gateClass: 'ticketed-shared-write',
      owner: 'broker',
      adapter: 'shared-surface-queue',
      statusCommand: 'node atm.mjs broker parallel-admission status --json',
      nextAction: 'Route shared write through a canonical broker ticket and queue-only fallback.',
      recoveryCommand: 'node atm.mjs broker parallel-admission trip --actor <actor-id> --reason "<gate failure>" --json',
      canPolicyRelax: true
    },
    {
      gateId: 'R4_SHARED_SIDE_EFFECT',
      gateClass: 'ticketed-shared-write',
      owner: 'broker',
      adapter: 'side-effect-steward',
      statusCommand: 'node atm.mjs broker parallel-admission status --json',
      nextAction: 'Serialize side effects through canonical ticket/status/recovery evidence.',
      recoveryCommand: 'node atm.mjs broker parallel-admission reset --actor <actor-id> --receipt-digest <sha256> --json',
      canPolicyRelax: true
    }
  ];
}

export function parallelAdmissionPolicyPath(cwd: string): string {
  return path.join(cwd, '.atm', 'runtime', 'parallel-admission-policy.json');
}

export function readParallelAdmissionPolicy(cwd: string): ParallelAdmissionPolicy {
  const policyPath = parallelAdmissionPolicyPath(cwd);
  if (!existsSync(policyPath)) return defaultParallelAdmissionPolicy();
  const parsed = JSON.parse(readFileSync(policyPath, 'utf8'));
  return normalizeParallelAdmissionPolicy(parsed);
}

export function writeParallelAdmissionPolicy(cwd: string, policy: ParallelAdmissionPolicy): ParallelAdmissionPolicy {
  const policyPath = parallelAdmissionPolicyPath(cwd);
  mkdirSync(path.dirname(policyPath), { recursive: true });
  const normalized = normalizeParallelAdmissionPolicy(policy);
  writeFileSync(policyPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function updateParallelAdmissionPolicy(
  cwd: string,
  patch: Partial<Pick<ParallelAdmissionPolicy, 'mode' | 'circuitBreakerEnabled' | 'fallbackMode' | 'rolloutScope'>>
): ParallelAdmissionPolicy {
  const current = readParallelAdmissionPolicy(cwd);
  return writeParallelAdmissionPolicy(cwd, {
    ...current,
    ...patch,
    configDigest: digestPolicyConfig({ ...current, ...patch })
  });
}

export function tripParallelAdmissionPolicy(cwd: string, input: { readonly actorId: string | null; readonly reason: string }): ParallelAdmissionPolicy {
  const current = readParallelAdmissionPolicy(cwd);
  return writeParallelAdmissionPolicy(cwd, {
    ...current,
    tripped: true,
    trippedAt: new Date().toISOString(),
    trippedBy: input.actorId,
    tripReason: input.reason,
    fallbackMode: 'queue-only',
    configDigest: digestPolicyConfig({ ...current, tripped: true, fallbackMode: 'queue-only' })
  });
}

export function resetParallelAdmissionPolicy(cwd: string, input: { readonly actorId: string | null; readonly receiptDigest: string }): ParallelAdmissionPolicy {
  const current = readParallelAdmissionPolicy(cwd);
  return writeParallelAdmissionPolicy(cwd, {
    ...current,
    tripped: false,
    tripReason: null,
    resetAt: new Date().toISOString(),
    trippedBy: input.actorId,
    resetEvidenceDigest: input.receiptDigest,
    configDigest: digestPolicyConfig({ ...current, tripped: false, resetEvidenceDigest: input.receiptDigest })
  });
}

export function buildParallelAdmissionReceipt(input: {
  readonly cwd: string;
  readonly action: ParallelAdmissionPolicyReceipt['action'];
  readonly actorId: string | null;
  readonly policy: ParallelAdmissionPolicy;
}): ParallelAdmissionPolicyReceipt {
  return {
    schemaId: 'atm.parallelAdmissionPolicyReceipt.v1',
    action: input.action,
    actorId: input.actorId,
    createdAt: new Date().toISOString(),
    policyPath: '.atm/runtime/parallel-admission-policy.json',
    policy: input.policy,
    rollbackCommand: 'node atm.mjs broker parallel-admission set --mode enforce --fallback-mode queue-only --json'
  };
}

export function resolveGatePolicy(gateId: ParallelAdmissionGateId, policy: ParallelAdmissionPolicy = defaultParallelAdmissionPolicy()) {
  return policy.gatePolicies.find((gate) => gate.gateId === gateId) ?? null;
}

function normalizeParallelAdmissionPolicy(value: unknown): ParallelAdmissionPolicy {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate = {
    ...defaultParallelAdmissionPolicy(),
    ...record,
    mode: record.mode === 'observe' ? 'observe' : 'enforce',
    circuitBreakerEnabled: record.circuitBreakerEnabled !== false,
    fallbackMode: record.fallbackMode === 'fail-closed' ? 'fail-closed' : 'queue-only',
    rolloutScope: Array.isArray(record.rolloutScope) ? record.rolloutScope.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : defaultParallelAdmissionPolicy().rolloutScope,
    gatePolicies: defaultGatePolicies()
  };
  return { ...candidate, configDigest: digestPolicyConfig(candidate) };
}

function digestPolicyConfig(value: Record<string, unknown>): string {
  const stable = {
    mode: value.mode,
    circuitBreakerEnabled: value.circuitBreakerEnabled,
    fallbackMode: value.fallbackMode,
    rolloutScope: value.rolloutScope,
    tripped: value.tripped,
    resetEvidenceDigest: value.resetEvidenceDigest
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(stable)).digest('hex')}`;
}
