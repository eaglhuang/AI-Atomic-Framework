import { createHash } from 'node:crypto';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';
import { cleanupStale, registerIntent, releaseTask, renewIntentLease } from './registry.ts';
import { evaluateBrokerAdmission } from './admission/evaluate-broker-admission.ts';
import type { BrokerAdmissionResult } from './admission/contracts.ts';
import { digest, ownsExactActiveSerialScope, pendingSerialTickets } from './serial-queue/policy.ts';
import { enqueueSerialIntent, refreshSerialQueue, transitionSerialTicket } from './serial-queue/queue.ts';
import {
  createBrokerRegistryStore,
  BrokerRegistryStoreError,
  type BrokerRegistrySnapshot,
  type BrokerRegistryStore,
  type BrokerRegistryWriteReceipt
} from './registry-store.ts';

export type BrokerTransactionOperation = 'register' | 'heartbeat' | 'release' | 'adopt';

export interface BrokerTransactionReceipt {
  readonly admission?: BrokerAdmissionResult;
  readonly schemaId: 'atm.brokerTransactionReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly transactionId: string;
  readonly operation: BrokerTransactionOperation;
  readonly taskId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly status: 'committed' | 'idempotent-replay';
  readonly registryPath: string;
  readonly baseGeneration: number;
  readonly nextGeneration: number;
  readonly baseDigest: string;
  readonly nextDigest: string;
  readonly committedAt: string;
}

export interface BrokerTransactionAuthority {
  readonly store: BrokerRegistryStore;
  read(): BrokerRegistrySnapshot;
  register(input: {
    readonly intent: WriteIntent;
    readonly lane: ActiveWriteIntent['lane'];
    readonly ttlSeconds?: number;
    readonly admissionOverride?: ActiveWriteIntent['admission'];
    readonly resolveRegistration?: (doc: WriteBrokerRegistryDocument) => {
      readonly lane: ActiveWriteIntent['lane'];
      readonly admissionOverride?: ActiveWriteIntent['admission'];
    };
    readonly idempotencyKey?: string;
    readonly queueTicketId?: string;
    readonly currentBaseCommit?: string | null;
    readonly resolveCurrentBaseCommit?: () => string | null;
  }): BrokerTransactionReceipt;
  heartbeat(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly ttlSeconds?: number;
    readonly idempotencyKey?: string;
  }): BrokerTransactionReceipt;
  release(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly idempotencyKey?: string;
  }): BrokerTransactionReceipt;
}

export class BrokerTransactionAuthorityError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = 'BrokerTransactionAuthorityError';
    this.code = code;
    this.details = details;
  }
}

export function createBrokerTransactionAuthority(registryPath: string): BrokerTransactionAuthority {
  const store = createBrokerRegistryStore(registryPath);
  return {
    store,
    read: () => store.read(),
    register: (input) => {
      let admission: BrokerAdmissionResult | undefined;
      const evaluate = (doc: WriteBrokerRegistryDocument) => evaluateBrokerAdmission({ intent: input.intent }, doc, {
        serialQueueResume: { ticketId: input.queueTicketId, currentBaseCommit: input.resolveCurrentBaseCommit?.() ?? input.currentBaseCommit }
      });
      const receipt = commitBrokerRegistryTransaction({
      store,
      operation: 'register',
      taskId: input.intent.taskId,
      actorId: input.intent.actorId,
      idempotencyKey: `${input.idempotencyKey ?? 'register'}:${digest(input.intent)}:${input.queueTicketId ?? ''}`,
      canReplay: (doc) => !pendingSerialTickets(doc).some((ticket) => ticket.taskId === input.intent.taskId),
      onReplay: (doc) => { admission = evaluate(doc); },
      mutate: (doc) => {
        assertSameTaskLaneFence({
          doc,
          taskId: input.intent.taskId,
          actorId: input.intent.actorId,
          operation: 'register'
        });
        const registration = input.resolveRegistration?.(doc) ?? input;
        admission = evaluate(doc);
        let next = refreshSerialQueue(doc);
        const own = pendingSerialTickets(next).find((ticket) => ticket.taskId === input.intent.taskId);
        if (admission.privateWork) return refreshSerialQueue(registerIntent(next, input.intent, admission.decision.lane, input.ttlSeconds, admission.decision.admission));
        if (admission.disposition === 'revalidate' && doc.activeIntents.some((active) => active.taskId === input.intent.taskId
          && active.actorId === input.intent.actorId && !ownsExactActiveSerialScope(input.intent, active))) return next;
        if (admission.disposition === 'queue') {
          const lease = input.intent.leaseBounds?.requestedSeconds ?? input.ttlSeconds ?? 1800;
          const max = input.intent.leaseBounds?.maxSeconds ?? input.ttlSeconds ?? 1800;
          if (!Number.isFinite(lease) || !Number.isFinite(max) || lease < 1 || lease > max) throw new RangeError('Invalid serial queue lease bounds.');
          next = enqueueSerialIntent(next, input.intent, lease);
          admission = evaluate(next);
          return next;
        }
        if (own || input.queueTicketId) {
          if (admission.disposition !== 'direct' && admission.disposition !== 'proposal-required') return next;
          if (!own || own.ticketId !== input.queueTicketId) return next;
          next = transitionSerialTicket(next, own.ticketId, 'granted');
          return refreshSerialQueue(registerIntent(next, input.intent, admission.decision.lane, input.ttlSeconds, admission.decision.admission));
        }
        return refreshSerialQueue(registerIntent(next, input.intent, registration.lane, input.ttlSeconds, registration.admissionOverride));
      }
      });
      return { ...receipt, admission };
    },
    heartbeat: (input) => commitBrokerRegistryTransaction({
      store,
      operation: 'heartbeat',
      taskId: input.taskId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey ?? `heartbeat:${input.taskId}:${input.actorId}`,
      mutate: (doc) => {
        assertSameTaskLaneFence({
          doc,
          taskId: input.taskId,
          actorId: input.actorId,
          operation: 'heartbeat'
        });
        return renewIntentLease(doc, input.taskId, input.actorId, input.ttlSeconds);
      }
    }),
    release: (input) => commitBrokerRegistryTransaction({
      store,
      operation: 'release',
      taskId: input.taskId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey ?? `release:${input.taskId}:${input.actorId}`,
      mutate: (doc) => {
        assertSameTaskLaneFence({ doc, taskId: input.taskId, actorId: input.actorId, operation: 'release' });
        return releaseTask(doc, input.taskId);
      }
    })
  };
}

export function assertSameTaskLaneFence(input: {
  readonly doc: WriteBrokerRegistryDocument;
  readonly taskId: string;
  readonly actorId: string;
  readonly operation: BrokerTransactionOperation;
}): void {
  const existing = input.doc.activeIntents.find((intent) => intent.taskId === input.taskId)
    ?? pendingSerialTickets(input.doc).find((ticket) => ticket.taskId === input.taskId);
  if (!existing || existing.actorId === input.actorId) {
    return;
  }

  throw new BrokerTransactionAuthorityError(
    'ATM_BROKER_SAME_TASK_LANE_FENCE',
    `Task ${input.taskId} already has an active broker lane owned by ${existing.actorId}; ${input.operation} by ${input.actorId} requires an adopt or handoff transition.`,
    {
      taskId: input.taskId,
      currentActorId: existing.actorId,
      requestedActorId: input.actorId,
      intentId: 'intentId' in existing ? existing.intentId : existing.ticketId,
      operation: input.operation,
      recovery: 'Use governed TTL adopt, handoff token, or takeover transition before changing lanes.'
    }
  );
}

type BrokerTransactionInput = {
  readonly store: BrokerRegistryStore;
  readonly operation: BrokerTransactionOperation;
  readonly taskId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly mutate: (doc: WriteBrokerRegistryDocument) => WriteBrokerRegistryDocument;
  readonly canReplay?: (doc: WriteBrokerRegistryDocument) => boolean;
  readonly onReplay?: (doc: WriteBrokerRegistryDocument) => void;
};

export function commitBrokerRegistryTransaction(input: BrokerTransactionInput): BrokerTransactionReceipt {
  // Rebase only pure registry mutations, never reuse a stale admission decision.
  // Yield briefly to the short compare/write section; permanent errors fail immediately.
  for (let attempt = 0; ; attempt++) {
    try {
      return commitBrokerRegistryTransactionOnce(input);
    } catch (error) {
      if (!(error instanceof BrokerRegistryStoreError)
        || error.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT' || attempt >= 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
  }
}

function commitBrokerRegistryTransactionOnce(input: BrokerTransactionInput): BrokerTransactionReceipt {
  const base = input.store.read();
  const transactionId = buildBrokerTransactionId(input.operation, input.taskId, input.actorId, input.idempotencyKey);
  if (base.lastTransactionId === transactionId && input.canReplay?.(base.document) !== false) {
    input.onReplay?.(base.document);
    return {
      schemaId: 'atm.brokerTransactionReceipt.v1',
      specVersion: '0.1.0',
      transactionId,
      operation: input.operation,
      taskId: input.taskId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      status: 'idempotent-replay',
      registryPath: base.registryPath,
      baseGeneration: base.generation,
      nextGeneration: base.generation,
      baseDigest: base.digest,
      nextDigest: base.digest,
      committedAt: new Date().toISOString()
    };
  }

  const next = cleanupStale(input.mutate(base.document));
  const writeReceipt: BrokerRegistryWriteReceipt = input.store.write({
    base,
    next,
    transactionId
  });
  return {
    schemaId: 'atm.brokerTransactionReceipt.v1',
    specVersion: '0.1.0',
    transactionId,
    operation: input.operation,
    taskId: input.taskId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    status: 'committed',
    registryPath: writeReceipt.registryPath,
    baseGeneration: writeReceipt.baseGeneration,
    nextGeneration: writeReceipt.nextGeneration,
    baseDigest: writeReceipt.baseDigest,
    nextDigest: writeReceipt.nextDigest,
    committedAt: writeReceipt.committedAt
  };
}

export function buildBrokerTransactionId(
  operation: BrokerTransactionOperation,
  taskId: string,
  actorId: string,
  idempotencyKey: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ operation, taskId, actorId, idempotencyKey }))
    .digest('hex')
    .slice(0, 24);
  return `broker-txn-${digest}`;
}
