import { createHash } from 'node:crypto';
import { createTeamContextManifest } from '../../../../core/dist/team-runtime/context-manifest.js';
import { createTeamContributionManifest, createCleanContextReviewerReceipt } from '../../../../core/dist/team-runtime/contribution-manifest.js';
export function createTeamShadowSchedule(input) {
    const collapsedGroups = collapseNonIndependentGroups(input.workGroups);
    const reservations = collapsedGroups.map((group) => createReservation(input, group));
    const reviewerLane = input.cleanContextReviewer
        ? createReviewerLane(input)
        : null;
    const rosterFingerprint = createRosterFingerprint({
        catalogVersion: input.catalogVersion,
        fanOutCap: input.fanOutCap,
        promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
        quotaProbeDigest: input.quotaProbeDigest,
        reservations,
        reviewerLane,
        collapsed: collapsedGroups.some((group) => group.roles.length > 1)
    });
    return {
        schemaId: 'atm.teamShadowSchedule.v1',
        taskId: input.taskId,
        shadowOnly: true,
        baseCommit: input.baseCommit,
        scopeEpoch: input.scopeEpoch,
        catalogVersion: input.catalogVersion,
        fanOutCap: input.fanOutCap,
        spendingCeiling: input.spendingCeiling,
        quotaProbeDigest: input.quotaProbeDigest,
        reservations,
        rosterFingerprint,
        dagStreamingReadyGroups: reservations
            .filter((reservation) => reservation.dependencies.length === 0)
            .map((reservation) => reservation.groupId),
        reviewerLane,
        workspaceProvider: input.workspaceProvider ?? null
    };
}
export function createShadowContribution(input) {
    const contribution = createTeamContributionManifest({
        taskId: input.taskId,
        role: input.reservation.roles.join('+'),
        workerId: input.reservation.reservationId,
        baseCommit: input.reservation.sealedInputs.baseCommit,
        contextManifestDigest: input.reservation.contextManifest.digest,
        overlay: input.overlay,
        changedFiles: input.changedFiles
    });
    if (!input.reviewerLane)
        return contribution;
    const reviewerReceipt = createCleanContextReviewerReceipt({
        reviewerRole: 'clean-context-reviewer',
        contributionDigest: contribution.overlayDigest,
        reviewerContextDigest: input.reviewerLane.contextManifest.digest
    });
    return { ...contribution, reviewerReceipt };
}
function collapseNonIndependentGroups(groups) {
    const independent = groups.filter((group) => group.independent).map((group) => ({ ...group, roles: [group.role] }));
    const collapsed = groups.filter((group) => !group.independent);
    if (collapsed.length === 0)
        return independent;
    return [
        ...independent,
        {
            groupId: collapsed.map((group) => group.groupId).join('+'),
            role: collapsed.map((group) => group.role).join('+'),
            roles: collapsed.map((group) => group.role),
            independent: false,
            dependencies: [...new Set(collapsed.flatMap((group) => group.dependencies ?? []))],
            allowedFiles: [...new Set(collapsed.flatMap((group) => group.allowedFiles))],
            capability: collapsed.map((group) => group.capability).sort().join('+')
        }
    ];
}
function createReservation(input, group) {
    const model = chooseCheapestModel(input.modelOptions, group.capability);
    const contextManifest = createTeamContextManifest({
        taskId: input.taskId,
        role: group.roles.join('+'),
        baseCommit: input.baseCommit,
        scopeEpoch: input.scopeEpoch,
        allowedFiles: group.allowedFiles,
        acceptanceCriteria: input.acceptanceCriteria,
        requiredDependencies: group.dependencies ?? [],
        promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
        stablePromptPrefix: `${input.taskId}:${group.capability}`
    });
    return {
        reservationId: `res-${sha256(`${group.groupId}:${contextManifest.digest}`).slice(0, 12)}`,
        groupId: group.groupId,
        roles: group.roles,
        dependencies: [...(group.dependencies ?? [])].sort(),
        collapsedExecutor: group.roles.length > 1,
        contextManifest,
        provider: {
            providerId: model.providerId,
            modelId: model.modelId,
            plan: model.plan
        },
        sealedInputs: {
            baseCommit: input.baseCommit,
            scopeEpoch: input.scopeEpoch,
            contextManifestDigest: contextManifest.digest,
            spendingCeiling: input.spendingCeiling
        },
        reversible: true
    };
}
function createReviewerLane(input) {
    return {
        enabled: true,
        cleanContext: true,
        barrierRequired: true,
        contextManifest: createTeamContextManifest({
            taskId: input.taskId,
            role: 'clean-context-reviewer',
            baseCommit: input.baseCommit,
            scopeEpoch: input.scopeEpoch,
            allowedFiles: [],
            acceptanceCriteria: input.acceptanceCriteria,
            requiredDependencies: ['base', 'contribution-manifest', 'diff'],
            promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
            stablePromptPrefix: `${input.taskId}:clean-reviewer`
        })
    };
}
function chooseCheapestModel(options, capability) {
    const qualified = options.filter((option) => option.capability === capability || capability.includes(option.capability));
    const candidates = qualified.length ? qualified : options;
    const selected = [...candidates].sort((left, right) => left.costPerUnit - right.costPerUnit)[0];
    if (!selected)
        throw new Error(`No model option available for capability ${capability}.`);
    return selected;
}
function createRosterFingerprint(input) {
    const executorCollapseDecision = input.reservations.length === 1
        ? 'single-agent'
        : input.collapsed
            ? 'team-collapsed'
            : 'team-expanded';
    const body = {
        roleGraph: [
            ...input.reservations.map((reservation) => reservation.roles.join('+')),
            ...(input.reviewerLane ? ['clean-context-reviewer'] : [])
        ],
        executorCollapseDecision,
        providerModelPlan: input.reservations.map((reservation) => `${reservation.provider.providerId}:${reservation.provider.modelId}:${reservation.provider.plan}`),
        pricingCatalogVersion: input.catalogVersion,
        contextManifestHashes: [
            ...input.reservations.map((reservation) => reservation.contextManifest.digest),
            ...(input.reviewerLane ? [input.reviewerLane.contextManifest.digest] : [])
        ],
        promptCachePolicy: input.promptCachePolicy,
        fanOutCap: input.fanOutCap,
        quotaProbeDigest: input.quotaProbeDigest
    };
    return {
        schemaId: 'atm.teamRosterFingerprint.v1',
        ...body,
        digest: `sha256:${sha256(JSON.stringify(body))}`
    };
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
