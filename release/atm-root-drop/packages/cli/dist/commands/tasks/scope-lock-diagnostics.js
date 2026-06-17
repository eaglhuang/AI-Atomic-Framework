import path from 'node:path';
import { isTaskCloseGovernanceCriticalPath } from '../framework-development.js';
import { relativePathFrom } from '../shared.js';
import { sanitizeTaskDirectionAllowedFiles } from '../task-direction.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
import { pathMatchesTaskScope } from './historical-delivery.js';
import { readCloseWindowStagedIndexLockReport } from './close-window-lock.js';
const dirtyBucketStrategies = [
    {
        id: 'governanceTrackedDirtyFiles',
        includes: (filePath, input) => isTaskCloseGovernanceCriticalPath(filePath, input.taskId)
    },
    {
        id: 'scopeTrackedDirtyFiles',
        includes: (filePath, input) => input.declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared))
    },
    {
        id: 'generatedArtifactFiles',
        includes: (filePath) => isGeneratedArtifactPath(filePath)
    },
    {
        id: 'advisoryTrackedDirtyFiles',
        includes: () => true
    }
];
export function buildCloseScopedDiffIsolation(input) {
    const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
    const allChangedFiles = uniqueStrings(input.frameworkChangedFiles.map(normalizeRelativePath).filter(Boolean));
    const scopedCriticalChangedFiles = [...input.frameworkDeliveryWindow.scopedCriticalChangedFiles];
    const isolatedUnrelatedChanges = [...input.frameworkDeliveryWindow.unscopedCriticalChangedFiles];
    const declaredButUnchanged = declaredFiles.filter((declared) => !allChangedFiles.some((changed) => pathMatchesTaskScope(changed, declared)));
    return {
        schemaId: 'atm.taskCloseScopedDiffIsolation.v1',
        taskId: input.taskId,
        declaredFiles,
        scopedCriticalChangedFiles,
        isolatedUnrelatedChanges,
        declaredButUnchanged,
        summary: summarizeScopeIsolation(scopedCriticalChangedFiles, isolatedUnrelatedChanges, declaredButUnchanged),
        advisoryNote: 'isolatedUnrelatedChanges are framework critical files outside this task scope; they are advisory and do not block close. Address them via their own governed task.',
        remediation: {
            requiredCommand: null,
            safeToAutoStage: false,
            operatorSummary: 'Taskflow close owns governed staging; this atom only classifies scope isolation.'
        }
    };
}
export function evaluateFrameworkCloseDirtyGuard(input) {
    const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
    const trackedDirtyFiles = uniqueStrings(input.trackedDirtyFiles.map(normalizeRelativePath).filter(Boolean));
    const allowedAdvisoryGovernanceFiles = new Set(uniqueStrings((input.allowedAdvisoryGovernanceFiles ?? []).map(normalizeRelativePath).filter(Boolean)));
    const buckets = {
        scopeTrackedDirtyFiles: [],
        governanceTrackedDirtyFiles: [],
        generatedArtifactFiles: [],
        advisoryTrackedDirtyFiles: []
    };
    for (const filePath of trackedDirtyFiles) {
        const strategy = dirtyBucketStrategies.find((entry) => entry.includes(filePath, {
            taskId: input.taskId,
            declaredFiles
        }));
        buckets[strategy?.id ?? 'advisoryTrackedDirtyFiles'].push(filePath);
    }
    const scopeTrackedDirtyFiles = uniqueStrings(buckets.scopeTrackedDirtyFiles);
    const governanceTrackedDirtyFiles = uniqueStrings(buckets.governanceTrackedDirtyFiles.filter((filePath) => !allowedAdvisoryGovernanceFiles.has(filePath)));
    const allowlistedGovernanceTrackedFiles = uniqueStrings(buckets.governanceTrackedDirtyFiles.filter((filePath) => allowedAdvisoryGovernanceFiles.has(filePath)));
    const blockingTrackedDirtyFiles = uniqueStrings([
        ...scopeTrackedDirtyFiles,
        ...governanceTrackedDirtyFiles
    ]);
    const generatedArtifactFiles = uniqueStrings(buckets.generatedArtifactFiles);
    const advisoryTrackedDirtyFiles = uniqueStrings([
        ...allowlistedGovernanceTrackedFiles,
        ...generatedArtifactFiles,
        ...buckets.advisoryTrackedDirtyFiles
    ]);
    const ok = blockingTrackedDirtyFiles.length === 0;
    return {
        schemaId: 'atm.frameworkCloseDirtyGuard.v1',
        taskId: input.taskId,
        ok,
        reason: ok ? 'no-blocking-dirty-files' : 'blocking-dirty-files-present',
        blockingTrackedDirtyFiles,
        scopeTrackedDirtyFiles,
        governanceTrackedDirtyFiles,
        advisoryTrackedDirtyFiles,
        generatedArtifactFiles,
        remediation: {
            requiredCommand: ok ? null : `node atm.mjs git commit --actor <actor> --task ${input.taskId} --message "<delivery message>" --json`,
            safeToAutoStage: false,
            operatorSummary: ok
                ? 'No in-scope or closure-governance tracked dirty files block close.'
                : 'Commit the task-scoped delivery or closure-governance files through the governed delivery lane before closing done. Run taskflow pre-close to classify scope drift versus foreign staged bundles. During taskflow close --write, only the active close task may stage governed bundles while the close-window staged-index lock is held; defer foreign staged files explicitly with --defer-foreign-staged when the other agent can restage afterward.'
        }
    };
}
export function summarizeCloseWindowLockRemediation(input) {
    const lock = readCloseWindowStagedIndexLockReport(input.cwd);
    if (!lock || lock.status !== 'active') {
        return {
            requiredCommand: null,
            safeToAutoStage: false,
            operatorSummary: 'No close-window staged-index lock is active.'
        };
    }
    if (lock.taskId === input.taskId) {
        return {
            requiredCommand: null,
            safeToAutoStage: false,
            operatorSummary: `${input.taskId} currently owns the close-window staged-index lock until taskflow close releases it.`
        };
    }
    return {
        requiredCommand: `node atm.mjs tasks status --task ${lock.taskId} --json`,
        safeToAutoStage: false,
        operatorSummary: `Close-window staged-index lock held by ${lock.taskId} blocks ${input.taskId} from staging governed bundles. Wait for release or inspect the holder with tasks status.`
    };
}
export function attachDirtyGuardToScopedDiffIsolation(isolation, dirtyGuard, ignoredUntrackedFiles) {
    if (!isolation)
        return null;
    return {
        ...isolation,
        blockingTrackedDirtyFiles: dirtyGuard.blockingTrackedDirtyFiles,
        scopeTrackedDirtyFiles: dirtyGuard.scopeTrackedDirtyFiles,
        governanceTrackedDirtyFiles: dirtyGuard.governanceTrackedDirtyFiles,
        advisoryTrackedDirtyFiles: dirtyGuard.advisoryTrackedDirtyFiles,
        generatedArtifactFiles: dirtyGuard.generatedArtifactFiles,
        ignoredUntrackedFiles,
        remediation: dirtyGuard.remediation
    };
}
function summarizeScopeIsolation(scopedCriticalChangedFiles, isolatedUnrelatedChanges, declaredButUnchanged) {
    if (isolatedUnrelatedChanges.length === 0 && declaredButUnchanged.length === 0)
        return 'no-isolation-required';
    if (isolatedUnrelatedChanges.length > 0 && scopedCriticalChangedFiles.length === 0)
        return 'all-critical-changes-isolated-as-advisory';
    return 'mixed-in-scope-and-isolated-changes';
}
function normalizeTaskScopePaths(cwd, values) {
    return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
        const normalized = normalizeRelativePath(entry);
        if (!normalized)
            return '';
        return path.isAbsolute(normalized)
            ? normalizeRelativePath(relativePathFrom(cwd, normalized))
            : normalized;
    }));
}
function isGeneratedArtifactPath(filePath) {
    const normalized = normalizeRelativePath(filePath);
    return normalized.startsWith('release/atm-onefile/')
        || normalized.startsWith('release/atm-root-drop/')
        || normalized.startsWith('packages/cli/dist/')
        || normalized.startsWith('packages/integrations-core/dist/');
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}
