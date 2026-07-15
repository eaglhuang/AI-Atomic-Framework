import { createHash } from 'node:crypto';
export function projectTeamAdmission(input) {
    const collapsedGroups = collapseAdmissionGroups(input.workGroups);
    const deterministicInputsReady = Boolean(input.fanOutCap
        && input.fanOutCap > 0
        && input.quotaProbeDigest
        && input.teamRosterFingerprintDigest
        && input.pricingCatalogFresh);
    const costInputsComplete = input.providerUsageComplete && input.subscriptionAllocationComplete;
    const mutuallyExclusiveGroups = collapsedGroups.filter((group) => group.mutuallyExclusive);
    const hasEnoughParallelGroups = mutuallyExclusiveGroups.length >= 2;
    const sharedBottleneckFiles = [...new Set(input.sharedBottleneckFiles.map(normalizePath).filter(Boolean))];
    const boundedExperiment = !input.workloadClass;
    const selectedModels = mutuallyExclusiveGroups.flatMap((group) => {
        const model = chooseCheapestQualifiedModel(input.modelOptions, group.capability);
        return model
            ? [{
                    groupId: group.groupId,
                    providerId: model.providerId,
                    modelId: model.modelId,
                    plan: model.plan
                }]
            : [];
    });
    const thresholdOk = input.productionDefault
        ? (input.fullyLoadedCostRatio !== null && input.fullyLoadedCostRatio <= 0.80
            && input.timeRatio !== null && input.timeRatio <= 0.75
            && input.qualityParity
            && input.noWorseRepairResidue)
        : true;
    const promotionEligible = deterministicInputsReady
        && costInputsComplete
        && input.quotaOk
        && hasEnoughParallelGroups
        && sharedBottleneckFiles.length === 0
        && selectedModels.length === mutuallyExclusiveGroups.length
        && !boundedExperiment
        && thresholdOk;
    const blocker = firstAdmissionBlocker({
        deterministicInputsReady,
        costInputsComplete,
        quotaOk: input.quotaOk,
        hasEnoughParallelGroups,
        sharedBottleneckFiles,
        selectedModelCount: selectedModels.length,
        expectedModelCount: mutuallyExclusiveGroups.length,
        thresholdOk,
        boundedExperiment
    });
    const decision = !blocker
        ? 'open-team'
        : shouldShrinkInsteadOfSingleAgent(blocker) ? 'downgrade' : 'single-agent';
    const optimizationReason = blocker ?? 'Projected Team execution beats cost/time thresholds with quality parity.';
    return {
        schemaId: 'atm.teamAdmissionProjection.v1',
        decision,
        reason: optimizationReason,
        workerCount: decision === 'open-team' ? Math.min(mutuallyExclusiveGroups.length, input.fanOutCap ?? 0) : 1,
        selectedModels,
        fanOutCap: input.fanOutCap ?? 0,
        quotaProbe: {
            ok: input.quotaOk,
            digest: input.quotaProbeDigest,
            estimatedQueueWaitSeconds: input.estimatedQueueWaitSeconds
        },
        spending: {
            perWorkerCeiling: input.perWorkerSpendingCeiling,
            totalCeiling: input.totalSpendingCeiling,
            stopLossThreshold: input.stopLossThreshold
        },
        downgradeRoute: decision === 'downgrade' ? 'cheaper-model-mix' : 'single-agent',
        projected: {
            fullyLoadedCostRatio: input.fullyLoadedCostRatio,
            timeRatio: input.timeRatio,
            tokenRatio: input.tokenRatio,
            qualityParity: input.qualityParity,
            noWorseRepairResidue: input.noWorseRepairResidue
        },
        promotionEligible,
        boundedExperiment,
        optimizationReason,
        nextExperimentTarget: decision === 'open-team' ? null : nextExperimentTargetFor(blocker)
    };
}
function collapseAdmissionGroups(groups) {
    const byFiles = new Map();
    for (const group of groups) {
        const filesKey = group.files.map(normalizePath).sort().join('|');
        const key = group.mutuallyExclusive ? `${group.capability}:${filesKey}` : `collapsed:${filesKey || group.groupId}`;
        const previous = byFiles.get(key);
        byFiles.set(key, previous
            ? {
                groupId: `${previous.groupId}+${group.groupId}`,
                files: [...new Set([...previous.files, ...group.files].map(normalizePath))].sort(),
                capability: previous.capability === group.capability ? previous.capability : `${previous.capability}+${group.capability}`,
                mutuallyExclusive: previous.mutuallyExclusive && group.mutuallyExclusive
            }
            : { ...group, files: group.files.map(normalizePath).sort() });
    }
    return [...byFiles.values()];
}
function chooseCheapestQualifiedModel(options, capability) {
    return [...options]
        .filter((option) => capability.includes(option.capability) || option.capability === capability)
        .filter((option) => option.dataPolicy === 'private-ok')
        .filter((option) => option.risk !== 'high')
        .sort((left, right) => left.costPerUnit - right.costPerUnit)[0] ?? null;
}
function firstAdmissionBlocker(input) {
    if (!input.hasEnoughParallelGroups)
        return 'Team requires at least two mutually exclusive file groups.';
    if (input.sharedBottleneckFiles.length > 0)
        return `Shared bottleneck blocks the critical path: ${input.sharedBottleneckFiles.join(', ')}.`;
    if (!input.deterministicInputsReady)
        return 'Fan-out cap, quota probe, pricing catalog or TeamRosterFingerprint is not deterministic.';
    if (!input.costInputsComplete)
        return 'Provider usage or subscription allocation is incomplete, so promotion is ineligible.';
    if (!input.quotaOk)
        return 'Provider quota probe failed.';
    if (input.selectedModelCount !== input.expectedModelCount)
        return 'No cheapest capability-qualified provider/model could be selected under policy constraints.';
    if (input.boundedExperiment)
        return 'Unknown workload class is limited to a bounded experiment.';
    if (!input.thresholdOk)
        return 'Projected or actual Team cost/time/quality thresholds no longer hold.';
    return null;
}
function shouldShrinkInsteadOfSingleAgent(reason) {
    return /threshold|quota|provider\/model|policy/i.test(reason);
}
function nextExperimentTargetFor(reason) {
    if (!reason)
        return null;
    return `Reduce fan-out or model mix, then rerun projection: ${reason}`;
}
function normalizePath(filePath) {
    return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
export function digestTeamAdmissionProjection(projection) {
    return `sha256:${createHash('sha256').update(JSON.stringify(projection)).digest('hex')}`;
}
