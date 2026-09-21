export function buildGitBoundaryEvidenceEnvelope(input) {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const remoteVirtualActorId = `virtual:git-remote@${input.result.topology.remoteSha}`;
    const slug = `${sanitizeForPath(input.result.topology.remoteRef)}-${shortSha(input.result.topology.headSha) || 'unknown'}`;
    return {
        schemaId: 'atm.gitBoundaryEvidenceEnvelope.v1',
        specVersion: '0.1.0',
        generatedAt,
        actorId: input.actorId,
        remoteVirtualActorId,
        taskId: input.taskId,
        branch: input.result.topology.branch,
        remote: input.result.topology.remote,
        remoteRef: input.result.topology.remoteRef,
        baseCommit: input.result.topology.mergeBaseSha,
        localHead: input.result.topology.headSha,
        remoteHead: input.result.topology.remoteSha,
        targetFiles: dedupeStrings(input.result.local.diff.map((entry) => entry.filePath)),
        conflictKeys: collectConflictKeys(input.result),
        conflictingFiles: [...input.result.conflictingFiles],
        lane: input.result.brokerDecision?.lane ?? null,
        verdict: input.result.brokerDecision?.verdict ?? null,
        outcome: input.result.outcome,
        recommendation: input.result.recommendedNextStep,
        diagnostics: input.result.diagnostics.map((entry) => `${entry.code}:${entry.filePath || '-'}`),
        artifactPaths: [
            `.atm/history/evidence/git-boundary-runs/${slug}.json`,
            `.atm/history/evidence/git-boundary-runs/${slug}.md`
        ]
    };
}
function collectConflictKeys(result) {
    const output = [];
    appendSideConflictKeys(output, 'local', result.local.bridged);
    appendSideConflictKeys(output, 'remote', result.remote.bridged);
    return output.sort((left, right) => `${left.side}:${left.filePath}:${left.scope}:${left.key}`.localeCompare(`${right.side}:${right.filePath}:${right.scope}:${right.key}`));
}
function appendSideConflictKeys(output, side, entries) {
    for (const entry of entries) {
        for (const key of entry.conflictKeys) {
            output.push(toConflictKeyRecord(side, entry.filePath, key));
        }
    }
}
function toConflictKeyRecord(side, filePath, key) {
    return {
        side,
        filePath,
        scope: key.scope,
        key: key.key
    };
}
function dedupeStrings(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function sanitizeForPath(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}
function shortSha(value) {
    return /^[a-f0-9]{7,}$/i.test(value) ? value.slice(0, 12) : '';
}
