import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from '../shared.ts';
import type { EmergencyPermissionId } from './registry.ts';

export type ProtectedOverrideOutcome = 'authorized' | 'succeeded' | 'failed';

export interface ProtectedOverrideRepairCandidate {
  readonly schemaId: 'atm.protectedOverrideRepairCandidate.v1';
  readonly summary: string;
  readonly suggestedCommand: string;
  readonly deferredChecks: readonly string[];
}

export interface ProtectedOverrideAuditEvent {
  readonly schemaId: 'atm.protectedOverrideAuditEvent.v1';
  readonly eventId: string;
  readonly recordedAt: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly surface: string;
  readonly command: string | null;
  readonly flags: readonly string[];
  readonly permission: EmergencyPermissionId | string | null;
  readonly leaseId: string | null;
  readonly reason: string | null;
  readonly skippedChecks: readonly string[];
  readonly touchedFiles: readonly string[];
  readonly outcome: ProtectedOverrideOutcome;
  readonly failureCode: string | null;
  readonly emergencyUsePath: string | null;
  readonly parentEventId: string | null;
  readonly repairCandidate: ProtectedOverrideRepairCandidate | null;
}

export interface RecordProtectedOverrideInput {
  readonly cwd: string;
  readonly actorId: string | null;
  readonly taskId: string | null;
  readonly surface: string;
  readonly command: string | null;
  readonly flags?: readonly string[];
  readonly permission?: EmergencyPermissionId | string | null;
  readonly leaseId?: string | null;
  readonly reason?: string | null;
  readonly skippedChecks?: readonly string[];
  readonly touchedFiles?: readonly string[];
  readonly outcome: ProtectedOverrideOutcome;
  readonly failureCode?: string | null;
  readonly emergencyUsePath?: string | null;
  readonly parentEventId?: string | null;
  readonly repairCandidate?: ProtectedOverrideRepairCandidate | null;
}

export function protectedOverrideAuditRoot(cwd: string): string {
  return path.join(path.resolve(cwd), '.atm', 'history', 'protected-override-audit');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function normalizeFlags(flags: readonly string[] | undefined): string[] {
  return [...new Set((flags ?? []).map((flag) => {
    const trimmed = String(flag ?? '').trim();
    if (!trimmed) return '';
    return trimmed.startsWith('--') ? trimmed : `--${trimmed}`;
  }).filter(Boolean))].sort();
}

function normalizeTouchedFiles(files: readonly string[] | undefined): string[] {
  return [...new Set((files ?? []).map((entry) => String(entry).replace(/\\/g, '/')).filter(Boolean))].sort();
}

export function buildProtectedOverrideRepairCandidate(input: {
  readonly summary: string;
  readonly suggestedCommand: string;
  readonly deferredChecks?: readonly string[];
}): ProtectedOverrideRepairCandidate {
  return {
    schemaId: 'atm.protectedOverrideRepairCandidate.v1',
    summary: input.summary,
    suggestedCommand: input.suggestedCommand,
    deferredChecks: [...new Set((input.deferredChecks ?? []).map((entry) => String(entry).trim()).filter(Boolean))]
  };
}

export function recordProtectedOverrideAuditEvent(input: RecordProtectedOverrideInput): {
  event: ProtectedOverrideAuditEvent;
  eventPath: string;
} {
  const recordedAt = new Date().toISOString();
  const seed = `${input.surface}:${input.outcome}:${recordedAt}:${randomUUID()}`;
  const eventId = `POA-${shortHash(seed)}`;
  const event: ProtectedOverrideAuditEvent = {
    schemaId: 'atm.protectedOverrideAuditEvent.v1',
    eventId,
    recordedAt,
    actorId: input.actorId,
    taskId: input.taskId,
    surface: input.surface,
    command: input.command,
    flags: normalizeFlags(input.flags),
    permission: input.permission ?? null,
    leaseId: input.leaseId ?? null,
    reason: input.reason ?? null,
    skippedChecks: [...new Set((input.skippedChecks ?? []).map((entry) => String(entry).trim()).filter(Boolean))],
    touchedFiles: normalizeTouchedFiles(input.touchedFiles),
    outcome: input.outcome,
    failureCode: input.failureCode ?? null,
    emergencyUsePath: input.emergencyUsePath ?? null,
    parentEventId: input.parentEventId ?? null,
    repairCandidate: input.repairCandidate ?? null
  };
  const root = protectedOverrideAuditRoot(input.cwd);
  mkdirSync(root, { recursive: true });
  const absolutePath = path.join(root, `${recordedAt.replace(/[:.]/g, '-')}-${eventId}.json`);
  writeFileSync(absolutePath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return {
    event,
    eventPath: relativePathFrom(input.cwd, absolutePath)
  };
}

export function recordProtectedOverrideAuthorization(input: Omit<RecordProtectedOverrideInput, 'outcome'> & {
  readonly outcome?: 'authorized';
}): ReturnType<typeof recordProtectedOverrideAuditEvent> {
  return recordProtectedOverrideAuditEvent({
    ...input,
    outcome: 'authorized'
  });
}

export function recordProtectedOverrideCompletion(input: Omit<RecordProtectedOverrideInput, 'outcome'> & {
  readonly parentEventId: string;
  readonly outcome: 'succeeded' | 'failed';
}): ReturnType<typeof recordProtectedOverrideAuditEvent> {
  return recordProtectedOverrideAuditEvent(input);
}

export function listProtectedOverrideAuditEvents(cwd: string, input: {
  readonly taskId?: string | null;
  readonly leaseId?: string | null;
  readonly limit?: number;
} = {}): ProtectedOverrideAuditEvent[] {
  const root = protectedOverrideAuditRoot(cwd);
  if (!existsSync(root)) return [];
  const limit = input.limit ?? 100;
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(path.join(root, entry), 'utf8')) as ProtectedOverrideAuditEvent;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ProtectedOverrideAuditEvent => Boolean(entry))
    .filter((entry) => !input.taskId || entry.taskId === input.taskId)
    .filter((entry) => !input.leaseId || entry.leaseId === input.leaseId)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, limit);
}

export function recordFailedProtectedOverrideAttempt(input: {
  readonly cwd: string;
  readonly leaseId: string | null | undefined;
  readonly permission: EmergencyPermissionId;
  readonly surface: string;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly command: string | null;
  readonly flags?: readonly string[];
  readonly skippedChecks?: readonly string[];
  readonly failureCode: string | null;
}): string | null {
  if (!input.leaseId) return null;
  try {
    const recorded = recordProtectedOverrideAuditEvent({
      cwd: input.cwd,
      actorId: input.actorId,
      taskId: input.taskId,
      surface: input.surface,
      command: input.command,
      flags: input.flags,
      permission: input.permission,
      leaseId: input.leaseId,
      reason: input.reason,
      skippedChecks: input.skippedChecks ?? ['protected-backend-surface'],
      touchedFiles: [],
      outcome: 'failed',
      failureCode: input.failureCode,
      repairCandidate: buildProtectedOverrideRepairCandidate({
        summary: 'Authorized protected override failed before completion; inspect failureCode and retry through the normal lane when possible.',
        suggestedCommand: input.command ?? 'node atm.mjs next --json',
        deferredChecks: input.skippedChecks ?? ['protected-backend-surface']
      })
    });
    return recorded.eventPath;
  } catch {
    return null;
  }
}
