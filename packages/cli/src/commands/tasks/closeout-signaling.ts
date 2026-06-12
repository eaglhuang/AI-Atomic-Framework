import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type CloseoutProvenanceGapSegment =
  | 'closure-packet'
  | 'close-transition-metadata'
  | 'imported-as-done-without-governed-closeout';

export interface CloseoutProvenanceGapReport {
  readonly trusted: boolean;
  readonly bucket: 'source-done-governance-incomplete' | null;
  readonly missingSegments: readonly CloseoutProvenanceGapSegment[];
  readonly truth: string;
  readonly residue: string;
  readonly reason: string;
  readonly recoveryCommand: string;
}

export type TaskDependencyBlockerStatus =
  | string
  | 'source-done-governance-incomplete'
  | 'incomplete-closeout';

export interface TaskDependencyCloseoutBlocker {
  readonly taskId: string;
  readonly status: TaskDependencyBlockerStatus;
  readonly taskPath: string;
  readonly missingSegments?: readonly CloseoutProvenanceGapSegment[];
  readonly requiredCommand?: string;
  readonly detail?: string;
}

function readLastTransitionEvent(cwd: string, taskId: string, document: Record<string, unknown>) {
  const lastTransitionId = document.lastTransitionId ?? document.last_transition_id;
  if (typeof lastTransitionId !== 'string' || lastTransitionId.trim().length === 0) {
    return null;
  }
  const eventPath = path.join(cwd, '.atm', 'history', 'task-events', taskId, `${lastTransitionId.trim()}.json`);
  if (!existsSync(eventPath)) return null;
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasValidClosurePacketFile(cwd: string, taskId: string, document: Record<string, unknown>): boolean {
  const closurePacketVal = document.closurePacket ?? document.closure_packet;
  if (typeof closurePacketVal === 'string' && closurePacketVal.trim().length > 0) {
    const cpPath = path.resolve(cwd, closurePacketVal.trim());
    if (existsSync(cpPath)) {
      try {
        const cpData = JSON.parse(readFileSync(cpPath, 'utf8'));
        return Boolean(cpData && cpData.schemaId === 'atm.closurePacket.v1' && cpData.taskId === taskId);
      } catch {
        return false;
      }
    }
  }
  const fallbackCpPath = path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`);
  if (!existsSync(fallbackCpPath)) return false;
  try {
    const cpData = JSON.parse(readFileSync(fallbackCpPath, 'utf8'));
    return Boolean(cpData && cpData.schemaId === 'atm.closurePacket.v1' && cpData.taskId === taskId);
  } catch {
    return false;
  }
}

export function verifyCloseoutProvenance(cwd: string, taskId: string, document: Record<string, unknown>): boolean {
  if (hasValidClosurePacketFile(cwd, taskId, document)) {
    return true;
  }
  const lastTransitionEvent = readLastTransitionEvent(cwd, taskId, document);
  return hasValidCloseTransitionMetadata(lastTransitionEvent);
}

function hasValidCloseTransitionMetadata(lastTransitionEvent: Record<string, unknown> | null): boolean {
  if (!lastTransitionEvent) return false;
  const action = typeof lastTransitionEvent.action === 'string' ? lastTransitionEvent.action : null;
  const toStatus = typeof lastTransitionEvent.toStatus === 'string' ? lastTransitionEvent.toStatus : null;
  if (action !== 'close' && toStatus !== 'done' && toStatus !== 'verified') {
    return false;
  }
  const closure = lastTransitionEvent.closure;
  return Boolean(
    closure
    && typeof closure === 'object'
    && (closure as Record<string, unknown>).schemaId === 'atm.taskClosureTransition.v1'
  );
}

export function assessCloseoutProvenanceGap(
  cwd: string,
  taskId: string,
  document: Record<string, unknown>
): CloseoutProvenanceGapReport {
  if (verifyCloseoutProvenance(cwd, taskId, document)) {
    return {
      trusted: true,
      bucket: null,
      missingSegments: [],
      truth: 'governed closeout provenance is present',
      residue: 'No closeout gap remains for dependency admission.',
      reason: 'Closure packet or close transition metadata satisfies closeout provenance.',
      recoveryCommand: `node atm.mjs tasks status --task ${taskId} --json`
    };
  }

  const lastTransitionEvent = readLastTransitionEvent(cwd, taskId, document);
  const missingSegments: CloseoutProvenanceGapSegment[] = [];
  if (!hasValidClosurePacketFile(cwd, taskId, document)) {
    missingSegments.push('closure-packet');
  }
  if (!hasValidCloseTransitionMetadata(lastTransitionEvent)) {
    missingSegments.push('close-transition-metadata');
  }
  if (lastTransitionEvent?.action === 'import') {
    missingSegments.push('imported-as-done-without-governed-closeout');
  }

  const importedAsDone = lastTransitionEvent?.action === 'import';
  const recoveryCommand = importedAsDone
    ? `node atm.mjs tasks reconcile --task ${taskId} --actor <actor> --delivery-commit <sha> --json`
    : `node atm.mjs tasks repair-closure --task ${taskId} --actor <actor> --json`;

  return {
    trusted: false,
    bucket: 'source-done-governance-incomplete',
    missingSegments,
    truth: 'source delivery may exist, but governed closeout is incomplete',
    residue: importedAsDone
      ? 'The task ledger shows import -> done without a trusted close transition, closure packet, or reconcile attestation.'
      : 'The task is marked done, but ATM cannot trust closure packet or close transition provenance for dependency admission.',
    reason: 'Source-done is not governed-done. Finish the closeout chain before downstream claim or close.',
    recoveryCommand
  };
}

export function buildDependencyCloseoutBlocker(
  cwd: string,
  dependencyTaskId: string,
  dependencyPath: string,
  dependencyDocument: Record<string, unknown>
): TaskDependencyCloseoutBlocker {
  const gap = assessCloseoutProvenanceGap(cwd, dependencyTaskId, dependencyDocument);
  return {
    taskId: dependencyTaskId,
    status: gap.bucket ?? 'incomplete-closeout',
    taskPath: dependencyPath,
    missingSegments: gap.missingSegments,
    requiredCommand: gap.recoveryCommand,
    detail: gap.residue
  };
}

export function buildDependencyCloseoutRecoveryCommand(blocker: TaskDependencyCloseoutBlocker): string {
  return blocker.requiredCommand
    ?? `node atm.mjs tasks finalize diagnose --task ${blocker.taskId} --json`;
}

export function formatDependencyCloseoutBlockedMessage(blocker: TaskDependencyCloseoutBlocker): string {
  if (blocker.status === 'source-done-governance-incomplete') {
    return `Prerequisite ${blocker.taskId} is source-done but not governably closed. ${blocker.detail ?? 'Complete the governed closeout chain before claiming.'}`;
  }
  return `Prerequisite ${blocker.taskId} is marked done without trusted closeout provenance.`;
}
