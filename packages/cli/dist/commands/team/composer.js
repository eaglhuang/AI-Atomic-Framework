import { createHash } from 'node:crypto';
import { isPathAllowedByScope } from '../work-channels.js';
export function composeTeamContributionManifests(input) {
    const filesByPath = new Map();
    const invalidContributionIds = [];
    for (const contribution of input.contributions) {
        if (contribution.manifest.taskId !== input.taskId
            || contribution.manifest.baseCommit !== input.baseCommit) {
            invalidContributionIds.push(contribution.manifest.contributionId);
            continue;
        }
        const declaredChangedFiles = new Set(contribution.manifest.changedFiles.map(normalizeComposerPath));
        for (const file of contribution.files) {
            const filePath = normalizeComposerPath(file.path);
            if (!declaredChangedFiles.has(filePath)) {
                invalidContributionIds.push(contribution.manifest.contributionId);
                continue;
            }
            const current = filesByPath.get(filePath) ?? [];
            current.push({
                sha256: normalizeSha256(file.sha256),
                contributionId: contribution.manifest.contributionId
            });
            filesByPath.set(filePath, current);
        }
    }
    const conflicts = [];
    const finalFiles = [];
    for (const [filePath, entries] of [...filesByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const hashes = uniqueSorted(entries.map((entry) => entry.sha256));
        const contributionIds = uniqueSorted(entries.map((entry) => entry.contributionId));
        if (hashes.length > 1) {
            conflicts.push({ path: filePath, hashes, contributionIds });
            continue;
        }
        finalFiles.push({ path: filePath, sha256: hashes[0], contributionIds });
    }
    const candidateFiles = uniqueSorted(finalFiles
        .map((file) => file.path)
        .filter((file) => !isPathAllowedByScope(file, input.declaredScope)));
    const scopeExpansion = {
        owner: 'composer',
        required: candidateFiles.length > 0,
        candidateFiles,
        reason: candidateFiles.length > 0
            ? 'Composer found worker output outside the declared scope; workers must not transfer ownership in flight.'
            : null
    };
    const failClosed = conflicts.length > 0 || invalidContributionIds.length > 0 || scopeExpansion.required;
    return {
        schemaId: 'atm.teamContributionComposition.v1',
        taskId: input.taskId,
        baseCommit: input.baseCommit,
        failClosed,
        finalTreeDigest: digestFinalTree(finalFiles, conflicts, invalidContributionIds, scopeExpansion),
        finalTree: { files: finalFiles },
        conflicts,
        scopeExpansion
    };
}
function normalizeComposerPath(filePath) {
    return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeSha256(value) {
    const trimmed = value.trim();
    return trimmed.startsWith('sha256:') ? trimmed : `sha256:${trimmed}`;
}
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function digestFinalTree(files, conflicts, invalidContributionIds, scopeExpansion) {
    return `sha256:${createHash('sha256').update(JSON.stringify({
        files,
        conflicts,
        invalidContributionIds: uniqueSorted(invalidContributionIds),
        scopeExpansion
    })).digest('hex')}`;
}
