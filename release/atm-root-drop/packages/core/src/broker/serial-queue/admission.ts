import type { WriteBrokerRegistryDocument, WriteIntent } from '../types.ts';
import type { SerialQueueObservation } from './contracts.ts';
import { observeSerialTicket, refreshSerialQueue } from './queue.ts';
import { hasSerialReadDependency, ownsExactActiveSerialScope, serialScopeDigest } from './policy.ts';
import { resourceListsOverlap } from '../resource-overlap.ts';

export interface SerialQueueResume {
  readonly ticketId?: string;
  readonly currentBaseCommit?: string | null;
}

/** One owner/scope/expiry/base snapshot consumed by preview and the CAS writer. */
export function resolveSerialAdmission(intent: WriteIntent, registry: WriteBrokerRegistryDocument,
  resume: SerialQueueResume = {}, now = Date.now()): {
    readonly registry: WriteBrokerRegistryDocument;
    readonly queue?: SerialQueueObservation;
    readonly disposition?: 'queue' | 'revalidate';
    readonly reason?: string;
    readonly revalidatedTicketId?: string;
    readonly privateWork?: boolean;
  } {
  const doc = refreshSerialQueue(registry, now);
  const pending = doc.serialQueue?.tickets.find((ticket) => ticket.taskId === intent.taskId && ['queued', 'eligible'].includes(ticket.state));
  if (!resume.ticketId && pending && pending.actorId === intent.actorId && intent.targetFiles.length > 0
    && !resourceListsOverlap('file', intent.targetFiles, pending.intent.targetFiles) && !hasSerialReadDependency(intent, pending.intent)
    && (['generators', 'projections', 'registries', 'validators', 'artifacts'] as const).every((key) =>
      !resourceListsOverlap(key, intent.sharedSurfaces[key], pending.intent.sharedSurfaces[key]))) {
    return { registry: doc, queue: observeSerialTicket(doc, pending, now), revalidatedTicketId: pending.ticketId, privateWork: true };
  }
  const ticket = resume.ticketId ? doc.serialQueue?.tickets.find((entry) => entry.ticketId === resume.ticketId) : pending;
  if (!ticket) return resume.ticketId ? { registry: doc, disposition: 'revalidate', reason: 'Queue ticket is missing or no longer retained.' } : { registry: doc };
  const queue = observeSerialTicket(doc, ticket, now);
  const liveGrant = ticket.state === 'granted' && resume.ticketId === ticket.ticketId
    && ticket.scopeDigest === serialScopeDigest(intent) && resume.currentBaseCommit === intent.baseCommit
    && doc.activeIntents.some((active) => ownsExactActiveSerialScope(intent, active) && active.baseCommit === intent.baseCommit
      && !!active.expiresAt && Date.parse(active.expiresAt) > now);
  if (liveGrant) return { registry: doc, queue, revalidatedTicketId: ticket.ticketId };
  const invalid = ticket.taskId !== intent.taskId || ticket.actorId !== intent.actorId || ticket.scopeDigest !== serialScopeDigest(intent)
    || !['queued', 'eligible'].includes(ticket.state) || ticket.expiresAt <= now;
  if (invalid) return { registry: doc, queue, disposition: 'revalidate', reason: 'Queue ticket owner, exact scope, or lifetime does not match the current request.' };
  if (queue.blockerIntentIds.length > 0) return { registry: doc, queue, disposition: 'queue', reason: 'The ticket is waiting for its current blockers and earlier conflicting tickets.' };
  if (!resume.ticketId || !resume.currentBaseCommit || resume.currentBaseCommit !== intent.baseCommit) {
    return { registry: doc, queue, disposition: 'revalidate', reason: 'Eligible ticket requires explicit resume with the current base commit and unchanged scope.' };
  }
  // Retain the head's sequence while suppressing only its self-wait gate.
  // Removing it would make later waiters appear to be predecessors on retry.
  return { registry: doc, queue, revalidatedTicketId: ticket.ticketId };
}
