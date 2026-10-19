import type { BrokerConflictMatrix, BrokerDecision, ConflictDetail, ProposalAdmissionEvidence, WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';
import { resourceListsOverlap } from '../resource-overlap.ts';
import { activeAsIntent, hasSerialReadDependency, pendingSerialTickets, serialPredecessors, serialScopesConflict } from '../serial-queue/policy.ts';
import { finalizeProposalAdmission } from './admission.ts';
import { withFailureReason } from './failure.ts';
import { findOverlappingProposalRegion, resolveActiveProposalRegionsForFile, resolveProposalRegionsForFile } from './proposal-regions.ts';
import type { SerialQueueReason } from '../serial-queue/contracts.ts';

/** Only proven, ready write/write conflicts may wait; hard guards run before this classifier. */
export function hotSerialBlockers(intent: WriteIntent, registry: WriteBrokerRegistryDocument,
  base: ProposalAdmissionEvidence): readonly string[] {
  if (!['auto', 'serial'].includes(intent.requestedLane) || (base.requiresProposal && !base.summarySubmitted)) return [];
  const blockers: string[] = [];
  for (const active of registry.activeIntents) {
    if (active.taskId === intent.taskId) continue;
    const other = activeAsIntent(active);
    if (!serialScopesConflict(intent, other)) continue;
    if (hasSerialReadDependency(intent, other)) return [];
    if (!base.requiresProposal && !active.admission?.requiresProposal) continue;
    const sameAtom = resourceListsOverlap('atom-id', intent.atomRefs.map((ref) => ref.atomId), active.resourceKeys.atomIds)
      || resourceListsOverlap('atom-cid', intent.atomRefs.map((ref) => ref.atomCid), active.resourceKeys.atomCids);
    const provenRange = intent.targetFiles.some((file) => findOverlappingProposalRegion(
      resolveProposalRegionsForFile(intent, file), resolveActiveProposalRegionsForFile(active, file)) !== null);
    if (sameAtom || provenRange) blockers.push(active.intentId);
  }
  return blockers;
}

export function coldSerialBlockers(intent: WriteIntent, registry: WriteBrokerRegistryDocument): readonly string[] {
  const cold = (value: WriteIntent) => (!value.proposalAdmission || value.proposalAdmission.trigger === 'not-required')
    && !(value.proposalAdmission?.hotFiles?.length) && !(value.proposalAdmission?.summarySubmitted);
  if (!cold(intent) || !['auto', 'serial'].includes(intent.requestedLane)) return [];
  const blockers: string[] = [];
  for (const active of registry.activeIntents) {
    if (active.taskId === intent.taskId) continue;
    const other = activeAsIntent(active);
    if (!serialScopesConflict(intent, other)) continue;
    if (!cold(other) || hasSerialReadDependency(intent, other)) return [];
    const sameAtom = resourceListsOverlap('atom-id', intent.atomRefs.map((ref) => ref.atomId), active.resourceKeys.atomIds)
      || resourceListsOverlap('atom-cid', intent.atomRefs.map((ref) => ref.atomCid), active.resourceKeys.atomCids);
    const provenRange = intent.atomRefs.some((ref) => ref.sourceRange && (active.resourceKeys.atomRanges ?? []).some((range) =>
      ref.sourceRange!.filePath === range.filePath && ref.sourceRange!.lineStart <= range.lineEnd && range.lineStart <= ref.sourceRange!.lineEnd));
    if (!sameAtom && !provenRange && intent.requestedLane !== 'serial') return [];
    blockers.push(active.intentId);
  }
  return blockers;
}

export function serialDecision(intent: WriteIntent, base: ProposalAdmissionEvidence, matrix: BrokerConflictMatrix,
  reason: string, blockers: readonly string[], conflicts?: readonly ConflictDetail[], queueReason: SerialQueueReason = 'cold-write-conflict'): BrokerDecision {
  return withFailureReason({
    schemaId: 'atm.brokerDecision.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'native serial admission' },
    intentId: `decision-${Date.now()}`, taskId: intent.taskId, verdict: 'serial', lane: 'serial', applyMethod: 'none', reason, queueReason,
    conflicts: conflicts ?? blockers.map((id) => ({ kind: 'file-range', detail: `Serial write boundary waits for '${id}'.` })),
    conflictMatrix: matrix,
    admission: finalizeProposalAdmission(base, 'blocked-before-write', { reason, rearbitrationRequired: true })
  });
}

export function pendingSerialDecision(intent: WriteIntent, registry: WriteBrokerRegistryDocument,
  base: ProposalAdmissionEvidence, matrix: BrokerConflictMatrix, revalidatedTicketId?: string): BrokerDecision | null {
  const predecessors = serialPredecessors(intent, registry);
  const own = pendingSerialTickets(registry).find((ticket) => ticket.taskId === intent.taskId);
  if ((!own || own.ticketId === revalidatedTicketId) && predecessors.length === 0) return null;
  if (base.requiresProposal && !base.summarySubmitted) {
    const reason = 'Submit the required proposal before entering or resuming the native wait queue.';
    return withFailureReason({ ...serialDecision(intent, base, matrix, reason, []),
      verdict: 'blocked-cid-conflict', lane: 'blocked', queueReason: undefined,
      conflicts: [{ kind: 'cid', detail: reason }] });
  }
  const readBlocker = predecessors.find((ticket) => hasSerialReadDependency(intent, ticket.intent));
  const decision = serialDecision(intent, base, matrix,
    own ? 'A durable queue ticket requires explicit current-base revalidation before write.' : 'An earlier conflicting queue ticket has FIFO priority.',
    predecessors.map((ticket) => ticket.ticketId), undefined, own?.reason ?? 'fifo-predecessor');
  return readBlocker ? { ...decision, verdict: 'blocked-cid-conflict', lane: 'blocked',
    reason: 'A pending writer has a read/write dependency; revalidate without acquiring write authority.',
    conflicts: [{ kind: 'cid', detail: `Read-set conflict with queued task '${readBlocker.taskId}'.` }] } : decision;
}
