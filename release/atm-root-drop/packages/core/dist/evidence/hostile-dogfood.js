import { createHash } from 'node:crypto';
export const HOSTILE_DOGFOOD_SCHEMA_ID = 'atm.hostileDogfoodReceipt.v1';
export const HOSTILE_DOGFOOD_SATURATION_SCHEMA_ID = 'atm.hostileDogfoodSaturation.v1';
const digest = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const isDigest = (value) => /^sha256:[a-f0-9]{64}$/i.test(value ?? '');
export function compileHostileDogfood(input) {
    const conditions = [...(input.conditions ?? [])].sort((a, b) => a.condition.localeCompare(b.condition));
    const lanes = [...(input.lanes ?? [])].sort((a, b) => a.laneId.localeCompare(b.laneId));
    const requiredConditions = [...new Set(input.requiredConditions ?? [])].sort();
    const minimumIndependentLanes = input.minimumIndependentLanes ?? 2;
    const diagnostics = [];
    if (!isDigest(input.sealedReceiptDigest))
        diagnostics.push('sealed-receipt-missing-or-invalid');
    if (lanes.length < minimumIndependentLanes)
        diagnostics.push('independent-lane-receipts-missing');
    const laneIds = new Set();
    const actorIds = new Set();
    for (const lane of lanes) {
        if (!lane.laneId)
            diagnostics.push('lane-id-missing');
        if (!lane.actorId)
            diagnostics.push(`lane-actor-missing:${lane.laneId || 'unknown'}`);
        if (!isDigest(lane.receiptDigest))
            diagnostics.push(`lane-receipt-digest-missing-or-invalid:${lane.laneId || 'unknown'}`);
        if (lane.sealed !== true)
            diagnostics.push(`lane-receipt-unsealed:${lane.laneId || 'unknown'}`);
        if (laneIds.has(lane.laneId))
            diagnostics.push(`lane-id-not-independent:${lane.laneId}`);
        if (actorIds.has(lane.actorId))
            diagnostics.push(`lane-actor-not-independent:${lane.actorId}`);
        laneIds.add(lane.laneId);
        actorIds.add(lane.actorId);
    }
    if (!conditions.length)
        diagnostics.push('hostile-conditions-missing');
    const observedConditions = new Set();
    for (const item of conditions) {
        if (observedConditions.has(item.condition))
            diagnostics.push(`duplicate-condition:${item.condition}`);
        observedConditions.add(item.condition);
        if (requiredConditions.length && !requiredConditions.includes(item.condition))
            diagnostics.push(`unexpected-condition:${item.condition}`);
        if (item.outcome === 'unknown')
            diagnostics.push(`unknown-outcome:${item.condition}`);
        if (item.overrideLeaseUsed)
            diagnostics.push(`override-lease-forbidden:${item.condition}`);
        if (item.rollbackPreserved !== true)
            diagnostics.push(`rollback-not-preserved:${item.condition}`);
        if (item.canonicalWorktreeIntact !== true)
            diagnostics.push(`canonical-worktree-not-proven:${item.condition}`);
    }
    for (const requiredCondition of requiredConditions) {
        if (!observedConditions.has(requiredCondition))
            diagnostics.push(`required-condition-missing:${requiredCondition}`);
    }
    const rollbackPreserved = conditions.length > 0 && conditions.every((item) => item.rollbackPreserved === true);
    const canonicalWorktreeIntact = conditions.length > 0 && conditions.every((item) => item.canonicalWorktreeIntact === true);
    const status = diagnostics.length ? 'blocked' : 'proven';
    const saturation = {
        recurrenceCount: conditions.filter((item) => item.outcome === 'recovered').length,
        conditionCount: conditions.length,
        requiredConditionCount: requiredConditions.length,
        independentLaneCount: laneIds.size
    };
    return {
        schemaId: HOSTILE_DOGFOOD_SCHEMA_ID,
        status,
        conditions,
        saturation,
        rollbackPreserved,
        canonicalWorktreeIntact,
        diagnostics,
        resultDigest: digest({ sealedReceiptDigest: input.sealedReceiptDigest, lanes, conditions, requiredConditions, minimumIndependentLanes, status, saturation, rollbackPreserved, canonicalWorktreeIntact })
    };
}
export function compileHostileDogfoodSaturation(input) {
    const diagnostics = [];
    const pairedExperimentSummary = summarizePairedExperiments(input.pairedExperiments);
    const incidentFamilySummary = summarizeIncidentFamilies(input.incidentFamilies);
    if (input.hostile.status !== 'proven')
        diagnostics.push('hostile-dogfood-not-proven');
    if (input.replayProof.breaker.verdict !== 'pass')
        diagnostics.push('parallel-replay-not-pass');
    if (input.replayProof.correctness.escapedConflictCount !== 0)
        diagnostics.push('escaped-conflict-observed');
    if (input.replayProof.correctness.silentOverwriteCount !== 0)
        diagnostics.push('silent-overwrite-observed');
    if (input.replayProof.breaker.timeInQueueOnlyRatio !== 0)
        diagnostics.push('queue-only-ratio-observed');
    if (pairedExperimentSummary.aaSamples < input.stoppingRule.minimumSamplesPerArm)
        diagnostics.push('aa-samples-below-stopping-rule');
    if (pairedExperimentSummary.abSamples < input.stoppingRule.minimumSamplesPerArm)
        diagnostics.push('ab-samples-below-stopping-rule');
    if (pairedExperimentSummary.baSamples < input.stoppingRule.minimumSamplesPerArm)
        diagnostics.push('ba-samples-below-stopping-rule');
    if (!pairedExperimentSummary.correctnessPass)
        diagnostics.push('paired-experiment-correctness-failed');
    if (!pairedExperimentSummary.rollbackPreserved)
        diagnostics.push('paired-experiment-rollback-not-preserved');
    if (incidentFamilySummary.unknownDispositionCount > input.stoppingRule.maximumUnknownFamilies)
        diagnostics.push('unknown-incident-family-disposition');
    const verdict = diagnostics.length ? 'blocked' : 'pass';
    const withoutDigest = {
        schemaId: HOSTILE_DOGFOOD_SATURATION_SCHEMA_ID,
        taskId: input.taskId,
        verdict,
        hostileDigest: input.hostile.resultDigest,
        replayProofDigest: input.replayProof.digest,
        pairedExperimentSummary,
        incidentFamilySummary,
        diagnostics
    };
    return {
        ...withoutDigest,
        digest: digest(withoutDigest)
    };
}
function summarizePairedExperiments(input) {
    const count = (label) => input.filter((entry) => entry.label === label).reduce((sum, entry) => sum + entry.sampleCount, 0);
    return {
        aaSamples: count('AA'),
        abSamples: count('AB'),
        baSamples: count('BA'),
        correctnessPass: input.length > 0 && input.every((entry) => entry.correctnessPass),
        queueWaitMs: input.reduce((sum, entry) => sum + entry.queueWaitMs, 0),
        rollbackPreserved: input.length > 0 && input.every((entry) => entry.rollbackPreserved)
    };
}
function summarizeIncidentFamilies(input) {
    return {
        familyCount: new Set(input.map((entry) => entry.family)).size,
        recurrenceCount: input.reduce((sum, entry) => sum + entry.recurrenceCount, 0),
        newBacklogRequiredCount: input.filter((entry) => entry.disposition === 'new-backlog-required').length,
        unknownDispositionCount: input.filter((entry) => entry.disposition === 'unknown').length
    };
}
