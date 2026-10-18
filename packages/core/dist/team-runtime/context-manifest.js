import { createHash } from 'node:crypto';
export function createTeamContextManifest(input) {
    const stablePromptPrefixHash = input.stablePromptPrefix
        ? `sha256:${sha256(input.stablePromptPrefix)}`
        : null;
    const body = {
        taskId: input.taskId,
        role: input.role,
        baseCommit: input.baseCommit,
        scopeEpoch: input.scopeEpoch,
        allowedFiles: [...input.allowedFiles].sort(),
        acceptanceCriteria: [...input.acceptanceCriteria],
        requiredDependencies: [...(input.requiredDependencies ?? [])].sort(),
        promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
        stablePromptPrefixHash
    };
    const digest = `sha256:${sha256(JSON.stringify(body))}`;
    return {
        schemaId: 'atm.teamContextManifest.v1',
        manifestId: `ctx-${digest.slice(7, 19)}`,
        ...body,
        digest
    };
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
