import { classifyRunnerAffectingPaths } from '../../_vendor/core/dist/broker/runner-version-contract.js';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function normalizeRepoPath(filePath) {
    return filePath.replace(/\\/g, '/');
}
function isCloseOwnedDeliveryPath(filePath, closeOwnedDeliveryFiles) {
    const normalized = normalizeRepoPath(filePath);
    return closeOwnedDeliveryFiles.some((owned) => {
        const declared = normalizeRepoPath(owned);
        return normalized === declared || normalized.startsWith(`${declared.replace(/\/$/, '')}/`);
    });
}
export function extractCloseOwnedDeliveryFiles(previewCommitBundle) {
    if (!previewCommitBundle || typeof previewCommitBundle !== 'object' || Array.isArray(previewCommitBundle)) {
        return [];
    }
    const record = previewCommitBundle;
    if (Array.isArray(record.targetDeliveryFiles)) {
        return uniqueSorted(record.targetDeliveryFiles.filter((entry) => typeof entry === 'string'));
    }
    const targetRepo = record.targetRepo;
    if (targetRepo && typeof targetRepo === 'object' && !Array.isArray(targetRepo)) {
        const stageFiles = targetRepo.stageFiles;
        if (Array.isArray(stageFiles)) {
            return uniqueSorted(stageFiles.filter((entry) => (typeof entry === 'string' && !normalizeRepoPath(entry).startsWith('.atm/'))));
        }
    }
    return [];
}
export function applyCloseOwnedNonRunnerDeliveryDirtyAdmission(input) {
    const dirtyGuard = input.preflight.dirtyGuard;
    const admitted = [];
    const remainingScope = [];
    for (const filePath of dirtyGuard.scopeTrackedDirtyFiles) {
        const normalized = normalizeRepoPath(filePath);
        const runnerAffecting = classifyRunnerAffectingPaths([normalized]).runnerAffecting.length > 0;
        if (isCloseOwnedDeliveryPath(normalized, input.closeOwnedDeliveryFiles) && !runnerAffecting) {
            admitted.push(normalized);
        }
        else {
            remainingScope.push(normalized);
        }
    }
    if (admitted.length === 0) {
        return input.preflight;
    }
    const admittedSet = new Set(admitted);
    const remainingBlocking = uniqueSorted(dirtyGuard.blockingTrackedDirtyFiles.filter((filePath) => !admittedSet.has(normalizeRepoPath(filePath))));
    const adjustedDirtyGuard = {
        ...dirtyGuard,
        ok: remainingBlocking.length === 0,
        reason: remainingBlocking.length === 0 ? 'no-blocking-dirty-files' : dirtyGuard.reason,
        blockingTrackedDirtyFiles: remainingBlocking,
        scopeTrackedDirtyFiles: remainingScope,
        advisoryTrackedDirtyFiles: uniqueSorted([...dirtyGuard.advisoryTrackedDirtyFiles, ...admitted])
    };
    const dropScopeBlocker = remainingScope.length === 0;
    const blockers = input.preflight.blockers.filter((entry) => !(dropScopeBlocker && entry.id === 'scopeTrackedDirtyFiles'));
    const operationalBlockers = input.preflight.operationalBlockers.filter((entry) => !(dropScopeBlocker && entry.id === 'scopeTrackedDirtyFiles'));
    return {
        ...input.preflight,
        ok: blockers.length === 0 && adjustedDirtyGuard.ok,
        blockers,
        operationalBlockers,
        scopeTrackedDirtyFiles: remainingScope,
        dirtyGuard: adjustedDirtyGuard
    };
}
