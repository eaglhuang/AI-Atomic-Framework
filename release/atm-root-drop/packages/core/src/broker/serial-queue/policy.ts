import { createHash } from 'node:crypto';
import { findResourceOverlapMatches, resourceListsOverlap } from '../resource-overlap.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';
import type { SerialQueueDocument, SerialQueueTicket } from './contracts.ts';
import { resolveProposalRegionsForFile } from '../decision/proposal-regions.ts';
import { normalizeBoundedRegions, normalizeStringList } from '../decision/admission.ts';

export const SERIAL_QUEUE_POLICY = Object.freeze({ eligibleLeaseMs: 30_000, historyLimit: 256, eventLimit: 512 });

export function serialScopeDigest(intent: WriteIntent): string {
  return digest({ taskId: intent.taskId, actorId: intent.actorId,
    targetFiles: [...intent.targetFiles].sort(), atomRefs: intent.atomRefs,
    readAtoms: intent.readAtoms ?? [], sharedSurfaces: intent.sharedSurfaces,
    requestedLane: intent.requestedLane, proposalAdmission: intent.proposalAdmission ?? null });
}

export function digest(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item;
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

export function isPendingSerialTicket(ticket: SerialQueueTicket, now = Date.now()): boolean {
  return (ticket.state === 'queued' || ticket.state === 'eligible') && ticket.expiresAt > now;
}

export function pendingSerialTickets(doc: WriteBrokerRegistryDocument, now = Date.now()): readonly SerialQueueTicket[] {
  return (doc.serialQueue?.tickets ?? []).filter((ticket) => isPendingSerialTicket(ticket, now))
    .sort((left, right) => left.sequence - right.sequence);
}

export function activeAsIntent(active: ActiveWriteIntent): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'queue conflict observation' },
    taskId: active.taskId, actorId: active.actorId, baseCommit: active.baseCommit,
    targetFiles: active.resourceKeys.files,
    atomRefs: active.resourceKeys.atomIds.map((atomId, index) => ({ atomId,
      atomCid: active.resourceKeys.atomCids[index] ?? atomId, operation: 'modify',
      ...(active.resourceKeys.atomRanges?.[index] ? { sourceRange: active.resourceKeys.atomRanges[index] } : {}) })),
    readAtoms: (active.resourceKeys.readAtomIds ?? []).map((atomId, index) => ({ atomId,
      atomCid: active.resourceKeys.readAtomCids?.[index] ?? atomId, operation: 'modify' })),
    sharedSurfaces: active.resourceKeys, requestedLane: 'auto',
    ...(active.admission ? { proposalAdmission: active.admission } : {})
  };
}

export function hasSerialReadDependency(left: WriteIntent, right: WriteIntent): boolean {
  return resourceListsOverlap('atom-id', (left.readAtoms ?? []).map((ref) => ref.atomId), right.atomRefs.map((ref) => ref.atomId))
    || resourceListsOverlap('atom-cid', (left.readAtoms ?? []).map((ref) => ref.atomCid), right.atomRefs.map((ref) => ref.atomCid))
    || resourceListsOverlap('atom-id', left.atomRefs.map((ref) => ref.atomId), (right.readAtoms ?? []).map((ref) => ref.atomId))
    || resourceListsOverlap('atom-cid', left.atomRefs.map((ref) => ref.atomCid), (right.readAtoms ?? []).map((ref) => ref.atomCid));
}

/** Logical overlap, not a global file lock. Missing bounds remain conservative. */
export function serialScopesConflict(left: WriteIntent, right: WriteIntent): boolean {
  if (hasSerialReadDependency(left, right)) return true;
  for (const match of findResourceOverlapMatches('file', left.targetFiles, right.targetFiles)) {
    const a = resolveProposalRegionsForFile(left, match.leftKey);
    const b = resolveProposalRegionsForFile(right, match.rightKey);
    if (match.verdict === 'unknown' || a.length === 0 || b.length === 0) return true;
    if (a.some((x) => b.some((y) => x.lineStart <= y.lineEnd && y.lineStart <= x.lineEnd))) return true;
  }
  return false;
}

export function serialPredecessors(intent: WriteIntent, doc: WriteBrokerRegistryDocument, now = Date.now()): readonly SerialQueueTicket[] {
  // An already admitted writer does not wait behind its own later waiters.
  // This exemption cannot authorize an expansion into a queued resource.
  if (doc.activeIntents.some((entry) => ownsExactActiveSerialScope(intent, entry) || isProposalReadinessUpgrade(intent, entry, now))) return [];
  const pending = pendingSerialTickets(doc, now);
  const own = pending.find((entry) => entry.taskId === intent.taskId);
  return pending.filter((entry) => entry.taskId !== intent.taskId && (!own || entry.sequence < own.sequence)
    && serialScopesConflict(intent, entry.intent));
}

/** Only the incumbent's monotonic readiness upgrade may precede its later waiters. */
export function isProposalReadinessUpgrade(intent: WriteIntent, active: ActiveWriteIntent, now: number): boolean {
  const admission = active.admission;
  const expiresAt = Date.parse(active.expiresAt ?? '');
  if (!admission?.requiresProposal || admission.state !== 'proposal-submitted' || admission.summarySubmitted
    || intent.proposalAdmission?.summarySubmitted !== true || active.baseCommit !== intent.baseCommit
    || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return ownsExactActiveSerialScope(intent, { ...active, admission: { ...admission, summarySubmitted: true } });
}

export function ownsExactActiveSerialScope(intent: WriteIntent, active: ActiveWriteIntent): boolean {
  if (active.taskId !== intent.taskId || active.actorId !== intent.actorId) return false;
  const sorted = (values: readonly unknown[]) => [...values].map(digest).sort();
  const proposal = (value: WriteIntent['proposalAdmission'] | ActiveWriteIntent['admission']) => {
    if (!value) return null;
    const hotFiles = normalizeStringList(value.hotFiles ?? []);
    const boundedRegions = normalizeBoundedRegions(value.boundedRegions ?? []);
    return value.trigger === 'not-required' && !value.summarySubmitted && !hotFiles.length && !boundedRegions.length ? null
      : { trigger: value.trigger, summarySubmitted: value.summarySubmitted, hotFiles, boundedRegions };
  };
  const requested = { files: sorted(intent.targetFiles), atomIds: sorted(intent.atomRefs.map((ref) => ref.atomId)),
    atomCids: sorted(intent.atomRefs.map((ref) => ref.atomCid)), readAtomIds: sorted((intent.readAtoms ?? []).map((ref) => ref.atomId)),
    readAtomCids: sorted((intent.readAtoms ?? []).map((ref) => ref.atomCid)),
    atomRanges: sorted(intent.atomRefs.flatMap((ref) => ref.sourceRange ? [{ ...ref.sourceRange, atomCid: ref.atomCid }] : [])),
    surfaces: ['generators', 'projections', 'registries', 'validators', 'artifacts'].map((key) => sorted(intent.sharedSurfaces[key as keyof WriteIntent['sharedSurfaces']])) };
  const owned = { files: sorted(active.resourceKeys.files), atomIds: sorted(active.resourceKeys.atomIds),
    atomCids: sorted(active.resourceKeys.atomCids), readAtomIds: sorted(active.resourceKeys.readAtomIds ?? []),
    readAtomCids: sorted(active.resourceKeys.readAtomCids ?? []), atomRanges: sorted(active.resourceKeys.atomRanges ?? []),
    surfaces: ['generators', 'projections', 'registries', 'validators', 'artifacts'].map((key) => sorted(active.resourceKeys[key as keyof WriteIntent['sharedSurfaces']])) };
  return digest(requested) === digest(owned) && digest(proposal(intent.proposalAdmission)) === digest(proposal(active.admission));
}

export function isSerialQueueDocument(value: unknown): value is SerialQueueDocument {
  if (!value || typeof value !== 'object') return false;
  const q = value as SerialQueueDocument;
  if (q.schemaId !== 'atm.brokerSerialQueue.v1' || !Number.isSafeInteger(q.nextSequence) || q.nextSequence < 1
    || !Number.isSafeInteger(q.nextEventSequence) || q.nextEventSequence < 1 || !Array.isArray(q.tickets) || !Array.isArray(q.events)) return false;
  const ids = new Set<string>();
  const sequences = new Set<number>();
  try {
    return q.tickets.every((ticket) => {
      if (!ticket || typeof ticket.ticketId !== 'string' || ids.has(ticket.ticketId)
        || !Number.isSafeInteger(ticket.sequence) || ticket.sequence < 1 || ticket.sequence >= q.nextSequence
        || sequences.has(ticket.sequence) || !['queued', 'eligible', 'granted', 'released', 'cancelled', 'expired'].includes(ticket.state)
        || !Number.isFinite(ticket.expiresAt) || !Number.isFinite(ticket.enqueuedAt) || !Array.isArray(ticket.blockerIntentIds)
        || ticket.taskId !== ticket.intent.taskId || ticket.actorId !== ticket.intent.actorId
        || ticket.scopeDigest !== serialScopeDigest(ticket.intent)
        || (ticket.reason !== undefined && !['cold-write-conflict', 'hot-write-conflict', 'provisional-overlap', 'fifo-predecessor'].includes(ticket.reason))
        || (ticket.blockerTaskIds !== undefined && (!Array.isArray(ticket.blockerTaskIds) || !ticket.blockerTaskIds.every((id: unknown) => typeof id === 'string')))) return false;
      ids.add(ticket.ticketId); sequences.add(ticket.sequence); return true;
    }) && q.events.every((event) => event && Number.isSafeInteger(event.sequence) && event.sequence > 0
      && event.sequence < q.nextEventSequence && typeof event.ticketId === 'string' && Number.isFinite(event.at));
  } catch { return false; }
}
