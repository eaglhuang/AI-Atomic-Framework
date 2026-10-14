import { createHash } from 'node:crypto';
import { cleanupStale, registerIntent, releaseTask, renewIntentLease } from './registry.js';
import { evaluateBrokerAdmission } from './admission/evaluate-broker-admission.js';
import { digest, ownsExactActiveSerialScope, pendingSerialTickets } from './serial-queue/policy.js';
import { enqueueSerialIntent, refreshSerialQueue, transitionSerialTicket } from './serial-queue/queue.js';
import { createBrokerRegistryStore, BrokerRegistryStoreError } from './registry-store.js';
export class BrokerTransactionAuthorityError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'BrokerTransactionAuthorityError';
        this.code = code;
        this.details = details;
    }
}
export function createBrokerTransactionAuthority(registryPath) {
    const store = createBrokerRegistryStore(registryPath);
    return {
        store,
        read: () => store.read(),
        register: (input) => {
            let admission;
            const evaluate = (doc, requireLiveRegistration = false) => evaluateBrokerAdmission({ intent: input.intent }, doc, {
                requireLiveRegistration,
                serialQueueResume: { ticketId: input.queueTicketId, currentBaseCommit: input.resolveCurrentBaseCommit?.() ?? input.currentBaseCommit }
            });
            const receipt = commitBrokerRegistryTransaction({
                store,
                operation: 'register',
                taskId: input.intent.taskId,
                actorId: input.intent.actorId,
                idempotencyKey: `${input.idempotencyKey ?? 'register'}:${digest(input.intent)}:${input.queueTicketId ?? ''}`,
                canReplay: (doc) => !pendingSerialTickets(doc).some((ticket) => ticket.taskId === input.intent.taskId),
                onReplay: (doc) => { admission = evaluate(doc, true); },
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
                    if (admission.decision.admission?.requiresProposal && !admission.decision.admission.summarySubmitted) {
                        // Preserve the established proposal-only first registration. It is
                        // observable metadata, not write permission or a native wait ticket.
                        const existing = next.activeIntents.find((active) => active.taskId === input.intent.taskId);
                        const unchangedMetadata = existing?.admission?.state === 'proposal-submitted' && !existing.admission.summarySubmitted
                            && existing.baseCommit === input.intent.baseCommit && ownsExactActiveSerialScope(input.intent, existing);
                        if (!own && !input.queueTicketId && (!existing || unchangedMetadata) && admission.disposition === 'proposal-required'
                            && admission.decision.verdict === 'parallel-safe' && admission.decision.admission.state === 'proposal-submitted') {
                            return registerIntent(next, input.intent, admission.decision.lane, input.ttlSeconds, admission.decision.admission);
                        }
                        return next;
                    }
                    if (admission.privateWork)
                        return refreshSerialQueue(registerIntent(next, input.intent, admission.decision.lane, input.ttlSeconds, admission.decision.admission));
                    if (admission.disposition === 'revalidate' && doc.activeIntents.some((active) => active.taskId === input.intent.taskId
                        && active.actorId === input.intent.actorId && (!ownsExactActiveSerialScope(input.intent, active) || active.baseCommit !== input.intent.baseCommit)))
                        return next;
                    if (admission.disposition === 'queue') {
                        const lease = input.intent.leaseBounds?.requestedSeconds ?? input.ttlSeconds ?? 1800;
                        const max = input.intent.leaseBounds?.maxSeconds ?? input.ttlSeconds ?? 1800;
                        if (!Number.isFinite(lease) || !Number.isFinite(max) || lease < 1 || lease > max)
                            throw new RangeError('Invalid serial queue lease bounds.');
                        next = enqueueSerialIntent(next, input.intent, lease, Date.now(), admission.decision.queueReason);
                        admission = evaluate(next);
                        return next;
                    }
                    if (own || input.queueTicketId) {
                        if (!['direct', 'proposal-required', 'compose'].includes(admission.disposition))
                            return next;
                        if (!own || own.ticketId !== input.queueTicketId)
                            return next;
                        // A composer handoff consumes the wait ticket but retains the composer
                        // lane/admission. It is not direct-write permission, and subsequent
                        // runtime admission must not return the same task to its own wait.
                        next = transitionSerialTicket(next, own.ticketId, 'granted');
                        next = refreshSerialQueue(registerIntent(next, input.intent, admission.decision.lane, input.ttlSeconds, admission.decision.admission));
                        admission = evaluate(next);
                        return next;
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
export function assertSameTaskLaneFence(input) {
    const existing = input.doc.activeIntents.find((intent) => intent.taskId === input.taskId)
        ?? pendingSerialTickets(input.doc).find((ticket) => ticket.taskId === input.taskId);
    if (!existing || existing.actorId === input.actorId) {
        return;
    }
    throw new BrokerTransactionAuthorityError('ATM_BROKER_SAME_TASK_LANE_FENCE', `Task ${input.taskId} already has an active broker lane owned by ${existing.actorId}; ${input.operation} by ${input.actorId} requires an adopt or handoff transition.`, {
        taskId: input.taskId,
        currentActorId: existing.actorId,
        requestedActorId: input.actorId,
        intentId: 'intentId' in existing ? existing.intentId : existing.ticketId,
        operation: input.operation,
        recovery: 'Use governed TTL adopt, handoff token, or takeover transition before changing lanes.'
    });
}
export function commitBrokerRegistryTransaction(input) {
    // Rebase only pure registry mutations, never reuse a stale admission decision.
    // Yield briefly to the short compare/write section; permanent errors fail immediately.
    for (let attempt = 0;; attempt++) {
        try {
            return commitBrokerRegistryTransactionOnce(input);
        }
        catch (error) {
            if (!(error instanceof BrokerRegistryStoreError)
                || error.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT' || attempt >= 7)
                throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
        }
    }
}
function commitBrokerRegistryTransactionOnce(input) {
    const base = input.store.read();
    // Clean only the working document. The exact original snapshot remains the
    // CAS base, so expiry wakeup cannot overwrite another writer's transaction.
    const working = cleanupStale(base.document);
    // Store generations advance independently of lease epochs. Normalizing that
    // projection alone is not a new mutation and must not defeat lost-response replay.
    const cleanupChanged = digest({ ...working, currentEpoch: base.document.currentEpoch }) !== digest(base.document);
    const transactionId = buildBrokerTransactionId(input.operation, input.taskId, input.actorId, input.idempotencyKey);
    if (base.lastTransactionId === transactionId && input.canReplay?.(working) !== false) {
        // Cleanup may publish expiry/wakeup, but must never replay the committed
        // register/heartbeat mutation or renew an existing writer's authority.
        const cleanupReceipt = cleanupChanged ? input.store.write({ base, next: working, transactionId }) : null;
        input.onReplay?.(working);
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
            nextGeneration: cleanupReceipt?.nextGeneration ?? base.generation,
            baseDigest: base.digest,
            nextDigest: cleanupReceipt?.nextDigest ?? base.digest,
            committedAt: new Date().toISOString()
        };
    }
    const next = cleanupStale(input.mutate(working));
    const writeReceipt = input.store.write({
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
export function buildBrokerTransactionId(operation, taskId, actorId, idempotencyKey) {
    const digest = createHash('sha256')
        .update(JSON.stringify({ operation, taskId, actorId, idempotencyKey }))
        .digest('hex')
        .slice(0, 24);
    return `broker-txn-${digest}`;
}
