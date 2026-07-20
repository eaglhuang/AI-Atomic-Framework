import { createHash } from 'node:crypto';
const ORDERED_PHASES = [
    'prepare-inputs',
    'plan-blockers',
    'compose-and-semantic-checks',
    'prepare-temp-index',
    'verify-expected-head',
    'cas-publish',
    'write-receipt',
    'generated-writes',
    'checkpoint',
    'closeback',
    'push'
];
export function planSharedDeliverySaga(input) {
    const blockers = [];
    if (input.decision.verdict !== 'batch-ready')
        blockers.push(`batch decision is ${input.decision.verdict}`);
    if (input.decision.surfaceKind !== 'commit')
        blockers.push('shared delivery saga only publishes commit surfaces');
    if (!input.expectedHeadSha.trim())
        blockers.push('expected HEAD is required before publish');
    if (input.actualHeadSha && input.actualHeadSha !== input.expectedHeadSha && !input.sharedWriteReceipt?.commitSha) {
        blockers.push('actual HEAD drifted before CAS publish');
    }
    const members = membersForDecision(input);
    if (members.length !== input.decision.ticketIds.length)
        blockers.push('every selected ticket must resolve to one member');
    for (const member of members) {
        if (member.fileSlice.length === 0)
            blockers.push(`task ${member.taskId} has no file slice`);
        if (member.validatorRefs.length === 0)
            blockers.push(`task ${member.taskId} has no validator refs`);
    }
    const sideEffects = normalizeSideEffects(input.attemptedSideEffects, input.sharedWriteReceipt);
    const duplicateAcknowledged = findDuplicateAcknowledgedEffects(sideEffects);
    if (duplicateAcknowledged.length > 0)
        blockers.push(`duplicate acknowledged side effect: ${duplicateAcknowledged.join(', ')}`);
    const completedPhases = completedPhasesFor(input.killpoint, input.sharedWriteReceipt);
    const blocked = blockers.length > 0;
    const sagaId = stableId([input.decision.waveId ?? 'wave', input.decision.surfaceFamily ?? 'surface', input.expectedHeadSha, input.decision.ticketIds.join(',')].join('\0'));
    const journal = {
        schemaId: 'atm.sharedDeliverySagaJournal.v1',
        specVersion: '0.1.0',
        sagaId,
        waveId: input.decision.waveId ?? 'unknown-wave',
        phases: ORDERED_PHASES,
        completedPhases,
        killpoint: input.killpoint ?? null,
        sideEffects,
        expectedHeadSha: input.expectedHeadSha,
        actualHeadSha: input.actualHeadSha ?? input.sharedWriteReceipt?.commitSha ?? null,
        terminalState: blocked ? 'blocked' : input.sharedWriteReceipt?.commitSha ? 'published' : input.killpoint ? 'recovered' : 'ready-to-publish'
    };
    return {
        schemaId: 'atm.sharedDeliverySagaPlan.v1',
        ok: !blocked,
        sagaId,
        blockers,
        journal,
        receipt: blocked ? null : {
            schemaId: 'atm.sharedDeliverySagaReceipt.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'shared delivery saga receipt baseline' },
            sagaId,
            waveId: journal.waveId,
            taskIds: members.map((member) => member.taskId),
            ticketIds: members.map((member) => member.ticketId),
            expectedHeadSha: input.expectedHeadSha,
            actualHeadSha: journal.actualHeadSha,
            commitSha: input.sharedWriteReceipt?.commitSha ?? null,
            sharedWriteReceiptDigest: input.sharedWriteReceipt ? digestJson(input.sharedWriteReceipt) : null,
            memberSlices: members,
            sideEffects,
            recoveryAction: recoveryActionFor(input.killpoint, sideEffects),
            exactlyOnce: duplicateAcknowledged.length === 0
        }
    };
}
function membersForDecision(input) {
    const ids = new Set(input.decision.ticketIds);
    return input.scheduler.tickets
        .filter((ticket) => ids.has(ticket.ticketId))
        .map((ticket) => ({
        taskId: ticket.taskId,
        ticketId: ticket.ticketId,
        fileSlice: uniqueSorted(input.fileSlices[ticket.taskId] ?? []),
        validatorRefs: uniqueSorted(input.validatorRefs[ticket.taskId] ?? []),
        semanticRefs: uniqueSorted(input.semanticRefs?.[ticket.taskId] ?? [])
    }))
        .sort((left, right) => left.taskId.localeCompare(right.taskId));
}
function normalizeSideEffects(attempted, receipt) {
    if (attempted && attempted.length > 0)
        return dedupeSideEffects(attempted);
    if (!receipt?.commitSha)
        return [];
    return [{
            operationId: `commit:${receipt.commitSha}`,
            kind: 'commit',
            state: 'acknowledged',
            attempt: 1,
            acknowledged: true,
            compensation: 'governed-revert-required'
        }, {
            operationId: `update-ref:${receipt.currentHeadSha}->${receipt.commitSha}`,
            kind: 'update-ref',
            state: 'acknowledged',
            attempt: 1,
            acknowledged: true,
            compensation: 'governed-revert-required'
        }, {
            operationId: `receipt:${receipt.payloadDigest}`,
            kind: 'receipt',
            state: 'acknowledged',
            attempt: 1,
            acknowledged: true,
            compensation: null
        }];
}
function dedupeSideEffects(sideEffects) {
    const byOperation = new Map();
    for (const effect of sideEffects) {
        const existing = byOperation.get(effect.operationId);
        if (!existing) {
            byOperation.set(effect.operationId, effect);
            continue;
        }
        byOperation.set(effect.operationId, {
            ...existing,
            state: existing.acknowledged || effect.acknowledged ? 'replayed' : existing.state,
            attempt: Math.max(existing.attempt, effect.attempt),
            acknowledged: existing.acknowledged || effect.acknowledged,
            compensation: existing.compensation ?? effect.compensation
        });
    }
    return [...byOperation.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
}
function findDuplicateAcknowledgedEffects(sideEffects) {
    const counts = new Map();
    for (const effect of sideEffects) {
        if (!effect.acknowledged)
            continue;
        counts.set(effect.operationId, (counts.get(effect.operationId) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([operationId]) => operationId).sort();
}
function completedPhasesFor(killpoint, receipt) {
    if (receipt?.commitSha)
        return ORDERED_PHASES.slice(0, 7);
    if (!killpoint)
        return ORDERED_PHASES.slice(0, 5);
    const stopAt = {
        'before-blocker-plan': 'prepare-inputs',
        'after-blocker-plan': 'plan-blockers',
        'after-temp-tree': 'prepare-temp-index',
        'after-commit-object': 'verify-expected-head',
        'after-update-ref': 'cas-publish',
        'after-receipt-write': 'write-receipt',
        'after-build': 'generated-writes',
        'after-projection': 'generated-writes',
        'after-checkpoint': 'checkpoint',
        'after-closeback': 'closeback',
        'after-push': 'push'
    };
    const index = ORDERED_PHASES.indexOf(stopAt[killpoint]);
    return ORDERED_PHASES.slice(0, Math.max(1, index + 1));
}
function recoveryActionFor(killpoint, sideEffects) {
    if (!killpoint)
        return 'none';
    if (sideEffects.some((effect) => effect.acknowledged && effect.kind === 'update-ref'))
        return 'replay-receipt';
    if (sideEffects.some((effect) => effect.acknowledged && effect.compensation))
        return 'compensate';
    return 'rearbitrate';
}
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function stableId(value) {
    return `shared-saga-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
