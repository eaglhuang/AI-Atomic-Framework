import { createHash } from 'node:crypto';
import { cleanupStale, registerIntent, releaseTask, renewIntentLease } from './registry.js';
import { createBrokerRegistryStore } from './registry-store.js';
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
        register: (input) => commitBrokerRegistryTransaction({
            store,
            operation: 'register',
            taskId: input.intent.taskId,
            actorId: input.intent.actorId,
            idempotencyKey: input.idempotencyKey ?? `register:${input.intent.taskId}:${input.intent.actorId}`,
            mutate: (doc) => {
                assertSameTaskLaneFence({
                    doc,
                    taskId: input.intent.taskId,
                    actorId: input.intent.actorId,
                    operation: 'register'
                });
                return registerIntent(doc, input.intent, input.lane, input.ttlSeconds, input.admissionOverride);
            }
        }),
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
            mutate: (doc) => releaseTask(doc, input.taskId)
        })
    };
}
export function assertSameTaskLaneFence(input) {
    const existing = input.doc.activeIntents.find((intent) => intent.taskId === input.taskId);
    if (!existing || existing.actorId === input.actorId) {
        return;
    }
    throw new BrokerTransactionAuthorityError('ATM_BROKER_SAME_TASK_LANE_FENCE', `Task ${input.taskId} already has an active broker lane owned by ${existing.actorId}; ${input.operation} by ${input.actorId} requires an adopt or handoff transition.`, {
        taskId: input.taskId,
        currentActorId: existing.actorId,
        requestedActorId: input.actorId,
        intentId: existing.intentId,
        operation: input.operation,
        recovery: 'Use governed TTL adopt, handoff token, or takeover transition before changing lanes.'
    });
}
export function commitBrokerRegistryTransaction(input) {
    const base = input.store.read();
    const transactionId = buildBrokerTransactionId(input.operation, input.taskId, input.actorId, input.idempotencyKey);
    if (base.lastTransactionId === transactionId) {
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
