import { createHash } from 'node:crypto';
export function createTeamContributionManifest(input) {
    const overlayDigest = `sha256:${sha256(JSON.stringify(input.overlay))}`;
    const contributionId = `contrib-${sha256(`${input.taskId}:${input.role}:${overlayDigest}`).slice(0, 12)}`;
    return {
        schemaId: 'atm.teamContributionManifest.v1',
        contributionId,
        taskId: input.taskId,
        role: input.role,
        workerId: input.workerId,
        baseCommit: input.baseCommit,
        contextManifestDigest: input.contextManifestDigest,
        overlayDigest,
        changedFiles: [...input.changedFiles].sort(),
        validatorReceipts: [...(input.validatorReceipts ?? [])],
        reviewerReceipt: input.reviewerReceipt ?? null
    };
}
export function createCleanContextReviewerReceipt(input) {
    const readSet = ['base', 'contribution-manifest', 'diff', 'required-dependencies', 'acceptance-criteria', 'reviewer-context-manifest'];
    return {
        schemaId: 'atm.teamReviewerReceipt.v1',
        reviewerRole: input.reviewerRole,
        cleanContext: true,
        readSet,
        receiptDigest: `sha256:${sha256(`${input.reviewerRole}:${input.contributionDigest}:${input.reviewerContextDigest}:${readSet.join('|')}`)}`
    };
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
