import { createHash } from 'node:crypto';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function selectedTickets(document, decision) {
    const ids = new Set(decision.ticketIds);
    return document.tickets.filter((ticket) => ids.has(ticket.ticketId));
}
function receiptCoversTask(receipts, waveId, manifestDigest, taskId) {
    return receipts.some((receipt) => receipt.waveId === waveId && receipt.manifestDigest === manifestDigest && receipt.taskIds.includes(taskId));
}
export function planWaveGeneratedWrite(input) {
    const blockers = [];
    const { decision } = input;
    if (decision.surfaceKind !== input.surfaceKind)
        blockers.push(`decision surface is not ${input.surfaceKind}`);
    if (!decision.waveId)
        blockers.push('decision is missing wave id');
    if (!decision.surfaceFamily)
        blockers.push('decision is missing surface family');
    if (decision.surfaceFamily && decision.surfaceFamily !== input.surfaceFamily)
        blockers.push('decision surface family does not match executor input');
    if (decision.verdict === 'waiting' || decision.verdict === 'empty')
        blockers.push(`scheduler decision is ${decision.verdict}`);
    if (decision.verdict === 'serial-fallback')
        blockers.push(`scheduler requested serial fallback: ${decision.reason}`);
    if (!input.manifestDigest.trim())
        blockers.push('manifest digest is required');
    if (!input.sealedSourceSha.trim())
        blockers.push('sealed source sha is required');
    if (!input.sourceDigest.trim())
        blockers.push('source digest is required');
    if (!input.outputDigest.trim())
        blockers.push('output digest is required');
    if (input.commandExitCode !== null && input.commandExitCode !== undefined && input.commandExitCode !== 0)
        blockers.push(`generated write command failed with exit code ${input.commandExitCode}`);
    const tickets = selectedTickets(input.scheduler, decision);
    const taskIds = uniqueSorted(tickets.map((ticket) => ticket.taskId));
    if (taskIds.length === 0)
        blockers.push('no scheduler tickets selected');
    for (const ticket of tickets) {
        if (ticket.waveId !== decision.waveId)
            blockers.push('selected tickets include another wave');
        if (ticket.surfaceKind !== input.surfaceKind)
            blockers.push('selected tickets include another surface kind');
        if (ticket.surfaceFamily !== input.surfaceFamily)
            blockers.push('selected tickets include another surface family');
    }
    const expected = uniqueSorted(input.expectedTaskIds ?? taskIds);
    const missingExpected = expected.filter((taskId) => !taskIds.includes(taskId));
    if (missingExpected.length > 0)
        blockers.push(`missing expected task receipts: ${missingExpected.join(', ')}`);
    if (blockers.length > 0) {
        return {
            schemaId: 'atm.waveGeneratedWritePlan.v1',
            ok: false,
            verdict: decision.verdict === 'serial-fallback' ? 'serial-fallback' : 'blocked',
            reason: blockers[0],
            blockers,
            receipt: null
        };
    }
    const withoutPayload = {
        schemaId: 'atm.waveGeneratedWriteReceipt.v1',
        specVersion: '0.1.0',
        waveId: decision.waveId,
        surfaceKind: input.surfaceKind,
        surfaceFamily: input.surfaceFamily,
        taskIds,
        ticketIds: decision.ticketIds,
        manifestDigest: input.manifestDigest,
        sealedSourceSha: input.sealedSourceSha,
        sourceDigest: input.sourceDigest,
        outputDigest: input.outputDigest,
        contentAddressedSkip: input.contentAddressedSkip === true,
        command: input.command?.trim() || null,
        commandExitCode: input.commandExitCode ?? null,
        commandDurationMs: input.commandDurationMs ?? null,
        phaseTimingsMs: input.phaseTimingsMs ?? (input.commandDurationMs !== null && input.commandDurationMs !== undefined ? { totalElapsed: input.commandDurationMs } : {}),
        observedOutputFiles: uniqueSorted(input.observedOutputFiles ?? []),
        telemetry: input.treatmentTelemetry ?? {
            schemaId: 'atm.generatedWriteTreatmentTelemetry.v1',
            specVersion: '0.1.0',
            surfaceKind: input.surfaceKind,
            executionMode: input.contentAddressedSkip === true ? 'content-addressed-skip' : input.command ? 'command-executed' : 'receipt-only',
            sideEffectAllowed: Boolean(input.command && input.commandExitCode === 0),
            commandExecuted: Boolean(input.command),
            outputObserved: (input.observedOutputFiles ?? []).length > 0,
            receiptValidity: 'valid',
            exactlyOnce: input.command ? 'observed' : 'not-applicable',
            skipReason: input.contentAddressedSkip === true ? 'content-addressed input/output digest match' : null,
            durationMs: input.commandDurationMs ?? null,
            phaseTimingsMs: input.phaseTimingsMs ?? (input.commandDurationMs !== null && input.commandDurationMs !== undefined ? { totalElapsed: input.commandDurationMs } : {}),
            outputFileCount: uniqueSorted(input.observedOutputFiles ?? []).length
        },
        executorActor: input.actorId,
        createdAt: input.now ?? new Date().toISOString()
    };
    const receipt = { ...withoutPayload, payloadDigest: digestJson(withoutPayload) };
    return {
        schemaId: 'atm.waveGeneratedWritePlan.v1',
        ok: true,
        verdict: 'receipt-ready',
        reason: `same-wave compatible ${input.surfaceKind} receipt ready`,
        blockers: [],
        receipt
    };
}
export function fanOutWaveGeneratedReceipt(receipt) {
    return receipt.taskIds.map((taskId) => ({
        schemaId: 'atm.waveGeneratedTaskReceiptRef.v1',
        taskId,
        waveId: receipt.waveId,
        surfaceKind: receipt.surfaceKind,
        surfaceFamily: receipt.surfaceFamily,
        manifestDigest: receipt.manifestDigest,
        payloadDigest: receipt.payloadDigest
    }));
}
export function evaluateAtomicWaveCheckpoint(input) {
    const taskIds = uniqueSorted(input.taskIds);
    const missingByTask = {};
    for (const taskId of taskIds) {
        const missing = [];
        if (!receiptCoversTask(input.deliveryReceipts, input.waveId, input.manifestDigest, taskId))
            missing.push('commit');
        if (!receiptCoversTask(input.buildReceipts, input.waveId, input.manifestDigest, taskId))
            missing.push('build');
        if (!receiptCoversTask(input.projectionReceipts, input.waveId, input.manifestDigest, taskId))
            missing.push('projection');
        if (missing.length > 0)
            missingByTask[taskId] = missing;
    }
    const withoutPayload = {
        schemaId: 'atm.atomicWaveCheckpointReadiness.v1',
        specVersion: '0.1.0',
        waveId: input.waveId,
        taskIds,
        manifestDigest: input.manifestDigest,
        ready: Object.keys(missingByTask).length === 0 && input.planningClosebackOk !== false,
        missingByTask,
        planningCloseback: input.planningClosebackOk === false ? 'reconcile-required' : 'ready',
        createdAt: input.now ?? new Date().toISOString()
    };
    return { ...withoutPayload, payloadDigest: digestJson(withoutPayload) };
}
