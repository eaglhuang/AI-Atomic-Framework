import {
  rearbitrateLinkedSurfaceScope,
  type BrokerRearbitrationReceipt,
  type LinkedSurfaceClosureReceipt
} from '../../../../../core/src/scope/linked-surface/index.ts';
import { pathMatchesWriteScope } from '../../../../../core/src/broker/write-scope-policy.ts';
import type { WorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import { CliError } from '../../shared.ts';

export type ScopeAmendmentRearbitrationReceipt = Readonly<{
  schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1';
  ok: boolean;
  errorCode: 'ATM_BROKER_REARBITRATION_REQUIRED' | null;
  amendmentPaths: readonly string[];
  rearbitration: BrokerRearbitrationReceipt;
}>;

export function buildScopeAmendmentRearbitration(input: {
  readonly closure: LinkedSurfaceClosureReceipt;
  readonly currentScope: readonly string[];
  readonly ticketReadSet: readonly string[];
  readonly ticketWriteSet: readonly string[];
}): ScopeAmendmentRearbitrationReceipt {
  const current = new Set(input.currentScope.map((surface) => surface.replace(/\\/g, '/')));
  const amendmentPaths = input.closure.requiredSurfaces.filter((surface) => !current.has(surface));
  const rearbitration = rearbitrateLinkedSurfaceScope({
    closure: input.closure,
    ticketReadSet: input.ticketReadSet,
    ticketWriteSet: input.ticketWriteSet
  });
  return {
    schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1',
    ok: amendmentPaths.length === 0 && !rearbitration.required,
    errorCode: rearbitration.errorCode,
    amendmentPaths,
    rearbitration
  };
}

export type ScopeAmendmentPersistPorts = Readonly<{
  resealTicket: (taskDocument: Record<string, unknown>) => void;
  writeLock: (outerLock: Record<string, unknown>) => void;
  persistLedger: (taskDocument: Record<string, unknown>) => void;
}>;

export type AtomicScopeAmendmentResult = Readonly<{
  taskDocument: Record<string, unknown>;
  outerLock: Record<string, unknown>;
  ticket: WorkAdmissionTicket | null;
  mergedAllowed: readonly string[];
}>;

export function cloneAuthorityRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function syncScopeAmendmentScopePaths(input: {
  readonly taskDocument: Record<string, unknown>;
  readonly mergedAllowed: readonly string[];
}): void {
  const existing = Array.isArray(input.taskDocument.scopePaths)
    ? (input.taskDocument.scopePaths as unknown[]).map((entry) => String(entry ?? '').replace(/\\/g, '/').trim()).filter((entry) => entry.length > 0)
    : [];
  const known = new Set(existing);
  const additions = input.mergedAllowed
    .map((entry) => String(entry ?? '').replace(/\\/g, '/').trim())
    .filter((entry) => entry.length > 0 && !known.has(entry));
  if (additions.length === 0) return;
  input.taskDocument.scopePaths = [...existing, ...additions];
}

export function syncScopeAmendmentRuntimeLock(input: {
  readonly outerLock: Record<string, unknown>;
  readonly embeddedLockRecord: Record<string, unknown>;
  readonly mergedAllowed: readonly string[];
}): void {
  input.outerLock.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] };
  input.outerLock.files = [...input.mergedAllowed];
}

export function syncScopeAmendmentState(input: {
  readonly taskDocument: Record<string, unknown>;
  readonly outerLock: Record<string, unknown>;
  readonly embeddedLockRecord: Record<string, unknown>;
  readonly mergedAllowed: readonly string[];
}): void {
  syncScopeAmendmentRuntimeLock(input);
  input.taskDocument.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] };
  const claim = input.taskDocument.claim;
  if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
    const claimRecord = claim as Record<string, unknown>;
    claimRecord.files = [...input.mergedAllowed];
    input.taskDocument.claim = claimRecord;
  }
  syncScopeAmendmentScopePaths(input);
}

export function readTicketWriteGrant(ticket: unknown): readonly string[] {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) return [];
  const grants = (ticket as { grants?: unknown }).grants;
  if (!Array.isArray(grants)) return [];
  const fileGrant = grants.find((grant) => grant && typeof grant === 'object' && (grant as { kind?: unknown }).kind === 'file-write');
  const values = fileGrant && typeof fileGrant === 'object' ? (fileGrant as { values?: unknown }).values : null;
  return Array.isArray(values) ? values.map((entry) => String(entry)) : [];
}

export function assertTicketCoversAmendedScope(input: {
  readonly ticket: WorkAdmissionTicket | null;
  readonly mergedAllowed: readonly string[];
  readonly taskId: string;
  readonly actorId: string;
}): void {
  const grant = readTicketWriteGrant(input.ticket);
  const missing = input.mergedAllowed.filter((path) => !grant.some((scope) => pathMatchesWriteScope(path, scope)));
  if (!input.ticket || missing.length > 0) {
    throw new CliError(
      'ATM_WRITE_TICKET_SCOPE_VIOLATION',
      'Requested mutation path is outside the ticket file grant.',
      {
        exitCode: 1,
        details: {
          taskId: input.taskId,
          actorId: input.actorId,
          missingPaths: missing,
          requiredCommand: `node atm.mjs tasks scope add --task ${input.taskId} --add <path> --json`
        }
      }
    );
  }
}

function replaceRecord(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, source);
}

/**
 * Extraction proposal (ATM-GOV-0393): the scope-amendment transaction boundary
 * lives here. One canonical amended snapshot is projected to ledger, claim,
 * direction lock, and work-admission ticket, or no consumer-visible surface
 * changes. The legacy tasks facade only routes into this module.
 */
export function applyAtomicScopeAmendment(input: {
  readonly taskDocument: Record<string, unknown>;
  readonly outerLock: Record<string, unknown>;
  readonly embeddedLockRecord: Record<string, unknown>;
  readonly mergedAllowed: readonly string[];
  readonly taskId: string;
  readonly actorId: string;
  readonly ports: ScopeAmendmentPersistPorts;
}): AtomicScopeAmendmentResult {
  const priorDocument = cloneAuthorityRecord(input.taskDocument);
  const priorLock = cloneAuthorityRecord(input.outerLock);
  const nextDocument = cloneAuthorityRecord(input.taskDocument);
  const nextLock = cloneAuthorityRecord(input.outerLock);
  const nextEmbedded = (
    nextLock.taskDirectionLock && typeof nextLock.taskDirectionLock === 'object' && !Array.isArray(nextLock.taskDirectionLock)
      ? nextLock.taskDirectionLock
      : cloneAuthorityRecord(input.embeddedLockRecord)
  ) as Record<string, unknown>;
  let lockWritten = false;
  try {
    syncScopeAmendmentState({
      taskDocument: nextDocument,
      outerLock: nextLock,
      embeddedLockRecord: nextEmbedded,
      mergedAllowed: input.mergedAllowed
    });
    input.ports.resealTicket(nextDocument);
    const ticket = (nextDocument.workAdmissionTicket ?? null) as WorkAdmissionTicket | null;
    assertTicketCoversAmendedScope({
      ticket,
      mergedAllowed: input.mergedAllowed,
      taskId: input.taskId,
      actorId: input.actorId
    });
    input.ports.writeLock(nextLock);
    lockWritten = true;
    input.ports.persistLedger(nextDocument);
    replaceRecord(input.taskDocument, nextDocument);
    replaceRecord(input.outerLock, nextLock);
    return {
      taskDocument: nextDocument,
      outerLock: nextLock,
      ticket,
      mergedAllowed: input.mergedAllowed
    };
  } catch (error) {
    replaceRecord(input.taskDocument, priorDocument);
    replaceRecord(input.outerLock, priorLock);
    if (lockWritten) {
      try {
        input.ports.writeLock(priorLock);
      } catch {
        // Restore is best-effort; the original error remains the command result.
      }
    }
    throw error;
  }
}
