const terminalStates = new Set(['closed', 'failed-terminal']);
const transitionMap = {
    planned: ['admitted', 'needs-review', 'failed-terminal'],
    admitted: ['executing', 'needs-review', 'failed-retryable', 'failed-terminal'],
    executing: ['ready-for-write', 'needs-review', 'failed-retryable', 'failed-terminal'],
    'ready-for-write': ['writing', 'needs-review', 'failed-retryable', 'failed-terminal'],
    writing: ['ready-to-close', 'needs-review', 'failed-retryable', 'failed-terminal'],
    'ready-to-close': ['closed', 'needs-review', 'failed-retryable', 'failed-terminal'],
    closed: [],
    'needs-review': ['planned', 'admitted', 'executing', 'failed-terminal'],
    'failed-retryable': ['planned', 'admitted', 'executing', 'failed-terminal'],
    'failed-terminal': []
};
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function createWaveManifest(input) {
    const now = input.now ?? new Date().toISOString();
    return {
        schemaId: 'atm.waveManifest.v1',
        specVersion: '0.1.0',
        waveId: input.waveId,
        batchRunId: input.batchRunId,
        state: input.state ?? 'planned',
        sealedBaseSha: input.sealedBaseSha ?? null,
        coordinatorActorId: input.coordinatorActorId,
        executor: input.executor ?? 'manual',
        targetRepo: input.targetRepo,
        tasks: input.tasks,
        brokerTickets: input.brokerTickets ?? [],
        sharedReceipts: input.sharedReceipts ?? [],
        createdAt: now,
        updatedAt: now
    };
}
export function validateWaveManifest(manifest) {
    const reasons = [];
    if (manifest.schemaId !== 'atm.waveManifest.v1')
        reasons.push('schemaId must be atm.waveManifest.v1');
    if (!manifest.waveId.trim())
        reasons.push('waveId is required');
    if (!manifest.batchRunId.trim())
        reasons.push('batchRunId is required');
    if (!manifest.coordinatorActorId.trim())
        reasons.push('coordinatorActorId is required');
    if (!manifest.targetRepo.trim())
        reasons.push('targetRepo is required');
    if (manifest.tasks.length === 0)
        reasons.push('at least one task is required');
    const seenTaskIds = new Set();
    for (const task of manifest.tasks) {
        if (!task.taskId.trim())
            reasons.push('every task requires taskId');
        if (seenTaskIds.has(task.taskId))
            reasons.push(`duplicate taskId ${task.taskId}`);
        seenTaskIds.add(task.taskId);
        if (task.targetRepo !== manifest.targetRepo)
            reasons.push(`task ${task.taskId} targetRepo differs`);
        if (!task.surfaceFamily.trim())
            reasons.push(`task ${task.taskId} surfaceFamily is required`);
        if (task.scopePaths.length === 0)
            reasons.push(`task ${task.taskId} requires scopePaths`);
    }
    return { ok: reasons.length === 0, reasons };
}
export function canTransitionWaveManifest(from, to) {
    if (from === to)
        return true;
    if (terminalStates.has(from))
        return false;
    return transitionMap[from].includes(to);
}
export function transitionWaveManifest(manifest, to, now = new Date().toISOString()) {
    if (!canTransitionWaveManifest(manifest.state, to)) {
        throw new Error(`invalid wave manifest transition ${manifest.state} -> ${to}`);
    }
    return { ...manifest, state: to, updatedAt: now };
}
export function evaluateWaveEligibility(tasks) {
    const reasons = [];
    const waveId = tasks.length > 0 ? null : null;
    if (tasks.length === 0)
        return { ok: false, waveId: null, surfaceFamily: null, taskIds: [], reasons: ['at least one task is required'] };
    const repos = uniqueSorted(tasks.map((task) => task.targetRepo));
    const surfaces = uniqueSorted(tasks.map((task) => task.surfaceFamily));
    const missingDependencies = tasks.filter((task) => !task.dependencyReady).map((task) => task.taskId);
    const validatorless = tasks.filter((task) => task.validators.length === 0).map((task) => task.taskId);
    const inferredWaveIds = uniqueSorted(tasks.map((task) => task.waveId));
    if (repos.length !== 1)
        reasons.push('tasks must share one targetRepo');
    if (surfaces.length !== 1)
        reasons.push('tasks must share one surfaceFamily');
    if (missingDependencies.length > 0)
        reasons.push(`dependencies not ready: ${missingDependencies.join(',')}`);
    if (validatorless.length > 0)
        reasons.push(`validators missing: ${validatorless.join(',')}`);
    return {
        ok: reasons.length === 0,
        waveId: inferredWaveIds.length === 1 ? inferredWaveIds[0] : null,
        surfaceFamily: surfaces.length === 1 ? surfaces[0] : null,
        taskIds: uniqueSorted(tasks.map((task) => task.taskId)),
        reasons
    };
}
export function waveManifestSummary(manifest) {
    return {
        schemaId: 'atm.waveManifestSummary.v1',
        waveId: manifest.waveId,
        batchRunId: manifest.batchRunId,
        state: manifest.state,
        taskIds: uniqueSorted(manifest.tasks.map((task) => task.taskId)),
        surfaceFamilies: uniqueSorted(manifest.tasks.map((task) => task.surfaceFamily)),
        brokerTicketCount: manifest.brokerTickets.length,
        sharedReceiptCount: manifest.sharedReceipts.length
    };
}
export function fromTeamWaveEnvelope(envelope, input) {
    return createWaveManifest({
        waveId: envelope.waveId,
        batchRunId: input.batchRunId,
        coordinatorActorId: envelope.coordinatorActorId,
        targetRepo: envelope.targetRepo ?? 'unknown',
        sealedBaseSha: input.sealedBaseSha ?? null,
        executor: 'team-agents',
        now: input.now ?? envelope.metadata.plannedAt,
        tasks: envelope.members.map((member) => ({
            taskId: member.taskId,
            waveId: envelope.waveId,
            targetRepo: envelope.targetRepo ?? 'unknown',
            surfaceFamily: input.surfaceFamilyByTask?.[member.taskId] ?? 'unknown',
            scopePaths: member.scopePaths,
            validators: input.validatorsByTask?.[member.taskId] ?? [],
            dependencyReady: input.dependencyReadyByTask?.[member.taskId] ?? true,
            claimId: member.patchEnvelopeId,
            laneSessionId: member.workerActorId
        }))
    });
}
