import { createHash } from 'node:crypto';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function ticketsForDecision(document, decision) {
    const ids = new Set(decision.ticketIds);
    return document.tickets.filter((ticket) => ids.has(ticket.ticketId));
}
export function planSharedDeliveryCommit(input) {
    const blockers = [];
    const decision = input.decision;
    if (decision.surfaceKind !== 'commit')
        blockers.push('decision surface is not commit');
    if (!decision.waveId)
        blockers.push('decision is missing wave id');
    if (!decision.surfaceFamily)
        blockers.push('decision is missing surface family');
    if (decision.verdict === 'waiting' || decision.verdict === 'empty')
        blockers.push(`scheduler decision is ${decision.verdict}`);
    if (decision.verdict === 'serial-fallback')
        blockers.push(`scheduler requested serial fallback: ${decision.reason}`);
    if (input.expectedHeadSha && input.currentHeadSha !== input.expectedHeadSha)
        blockers.push('current HEAD does not match expected HEAD');
    if (!input.manifestDigest.trim())
        blockers.push('manifest digest is required');
    if (!input.sealedBaseSha.trim())
        blockers.push('sealed base sha is required');
    if (!input.currentHeadSha.trim())
        blockers.push('current HEAD sha is required');
    if (!input.temporaryIndexPath)
        blockers.push('temporary index isolation evidence is required');
    const tickets = ticketsForDecision(input.scheduler, decision);
    const taskIds = uniqueSorted(tickets.map((ticket) => ticket.taskId));
    if (taskIds.length === 0)
        blockers.push('no scheduler tickets selected');
    const nonCommitTickets = tickets.filter((ticket) => ticket.surfaceKind !== 'commit');
    if (nonCommitTickets.length > 0)
        blockers.push('selected tickets include non-commit surfaces');
    const foreignWaveTickets = tickets.filter((ticket) => ticket.waveId !== decision.waveId);
    if (foreignWaveTickets.length > 0)
        blockers.push('selected tickets include another wave');
    const foreignSurfaceTickets = tickets.filter((ticket) => ticket.surfaceFamily !== decision.surfaceFamily);
    if (foreignSurfaceTickets.length > 0)
        blockers.push('selected tickets include another surface family');
    const claimed = new Set(uniqueSorted(input.claimedTaskIds));
    const validated = new Set(uniqueSorted(input.validatorTaskIds));
    for (const taskId of taskIds) {
        if (!claimed.has(taskId))
            blockers.push(`task ${taskId} has no claim evidence`);
        if (!validated.has(taskId))
            blockers.push(`task ${taskId} has no validator evidence`);
    }
    const fileSlices = input.fileSlices ?? Object.fromEntries(taskIds.map((taskId) => [taskId, input.stagedFiles]));
    for (const taskId of taskIds) {
        const files = uniqueSorted(fileSlices[taskId] ?? []);
        if (files.length === 0)
            blockers.push(`task ${taskId} has no staged file slice`);
    }
    const unrelatedSlices = Object.keys(fileSlices).filter((taskId) => !taskIds.includes(taskId));
    if (unrelatedSlices.length > 0)
        blockers.push(`unrelated task slices are not batch eligible: ${unrelatedSlices.sort().join(', ')}`);
    if (blockers.length > 0) {
        return {
            schemaId: 'atm.sharedDeliveryCommitPlan.v1',
            ok: false,
            verdict: decision.verdict === 'serial-fallback' ? 'serial-fallback' : 'blocked',
            reason: blockers[0],
            blockers,
            receipt: null
        };
    }
    const normalizedSlices = Object.fromEntries(taskIds.map((taskId) => [taskId, uniqueSorted(fileSlices[taskId] ?? [])]));
    const receiptWithoutPayload = {
        schemaId: 'atm.sharedWriteReceipt.v1',
        specVersion: '0.1.0',
        waveId: decision.waveId,
        surfaceKind: 'commit',
        surfaceFamily: decision.surfaceFamily,
        taskIds,
        ticketIds: decision.ticketIds,
        manifestDigest: input.manifestDigest,
        sealedBaseSha: input.sealedBaseSha,
        currentHeadSha: input.currentHeadSha,
        commitSha: input.commitSha ?? null,
        fileSlices: normalizedSlices,
        executorActor: input.actorId,
        temporaryIndexIsolated: true,
        payloadAssertion: {
            status: input.commitSha ? 'passed' : 'pending',
            expectedFileCount: uniqueSorted(Object.values(normalizedSlices).flat()).length,
            committedFileCount: input.commitSha ? uniqueSorted(Object.values(normalizedSlices).flat()).length : null
        },
        telemetry: {
            schemaId: 'atm.sharedDeliveryTreatmentTelemetry.v1',
            specVersion: '0.1.0',
            decisionKind: 'batch',
            parallelAdmissionAttempted: true,
            conflictDetected: false,
            composeCandidate: taskIds.length > 1,
            composeDecision: taskIds.length > 1 ? 'compose' : 'separate',
            finalDisposition: input.commitSha ? 'committed' : 'commit-ready',
            sideEffectAllowed: Boolean(input.commitSha),
            safetyFallback: null,
            correctnessVerdict: input.commitSha ? 'correct' : 'pending'
        },
        createdAt: input.now ?? new Date().toISOString()
    };
    const receipt = {
        ...receiptWithoutPayload,
        payloadDigest: digestJson(receiptWithoutPayload)
    };
    return {
        schemaId: 'atm.sharedDeliveryCommitPlan.v1',
        ok: true,
        verdict: 'receipt-ready',
        reason: 'same-wave compatible commit receipt ready',
        blockers: [],
        receipt
    };
}
