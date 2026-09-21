/** Directory-prefix aware membership: a scope ending in '/' matches by prefix. */
function fileMatchesScope(file, scopePaths) {
    return scopePaths.some((scope) => {
        if (scope === file)
            return true;
        if (scope.endsWith('/') && file.startsWith(scope))
            return true;
        return false;
    });
}
/**
 * Slice a wave diff into per-task evidence. The result is `done` only when every
 * changed file is attributed to exactly one member (append-safe files excepted);
 * otherwise the wave is `needs-review` and callers must not checkpoint any member
 * as done from this evidence.
 */
export function sliceWaveEvidence(input) {
    const appendSafe = new Set((input.appendSafePaths ?? []).map((p) => p.trim()));
    const sliceMap = new Map();
    for (const member of input.members)
        sliceMap.set(member.taskId, []);
    const unattributed = [];
    const ambiguous = [];
    for (const file of input.changedFiles) {
        const owners = input.members
            .filter((m) => fileMatchesScope(file, m.scopePaths))
            .map((m) => m.taskId);
        if (appendSafe.has(file)) {
            // Append-safe files are attributed to every owner, never ambiguous.
            for (const owner of owners)
                sliceMap.get(owner).push(file);
            continue;
        }
        if (owners.length === 0) {
            unattributed.push(file);
        }
        else if (owners.length === 1) {
            sliceMap.get(owners[0]).push(file);
        }
        else {
            ambiguous.push({ file, taskIds: owners });
        }
    }
    const slices = [...sliceMap.entries()].map(([taskId, attributedFiles]) => ({
        taskId,
        attributedFiles
    }));
    const state = unattributed.length === 0 && ambiguous.length === 0 ? 'done' : 'needs-review';
    return {
        schemaId: 'atm.teamWaveEvidence.v1',
        slices,
        unattributed,
        ambiguous,
        state
    };
}
