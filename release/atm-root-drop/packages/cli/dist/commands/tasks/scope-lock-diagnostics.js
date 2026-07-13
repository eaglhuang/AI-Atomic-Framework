import path from 'node:path';
import { isTaskCloseGovernanceCriticalPath } from '../framework-development.js';
import { relativePathFrom } from '../shared.js';
import { sanitizeTaskDirectionAllowedFiles } from '../task-direction.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
import { pathMatchesTaskScope } from './historical-delivery.js';
import { readCloseWindowStagedIndexLockReport } from './close-window-lock.js';
function isHistoricalDeliveredFile(filePath, deliverableFiles, historicalDeliveredFiles) {
    return deliverableFiles.some((declared) => pathMatchesTaskScope(filePath, declared)
        && historicalDeliveredFiles.some((historical) => pathMatchesTaskScope(historical, declared)));
}
const dirtyBucketStrategies = [
    {
        id: 'regenerableArtifactFiles',
        includes: (filePath, input) => isSameTaskRegenerableArtifact(filePath, input.taskId)
    },
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
    const deliverableFiles = normalizeTaskScopePaths(input.cwd, input.taskDeliverableFiles ?? []);
    const trackedDirtyFiles = uniqueStrings(input.trackedDirtyFiles.map(normalizeRelativePath).filter(Boolean));
    const historicalDeliveredFiles = uniqueStrings((input.historicalDeliveredFiles ?? []).map(normalizeRelativePath).filter(Boolean));
    const allowedAdvisoryGovernanceFiles = new Set(uniqueStrings((input.allowedAdvisoryGovernanceFiles ?? []).map(normalizeRelativePath).filter(Boolean)));
    const allowedAdvisoryDirtyFiles = new Set(uniqueStrings((input.allowedAdvisoryDirtyFiles ?? []).map(normalizeRelativePath).filter(Boolean)));
    const buckets = {
        scopeTrackedDirtyFiles: [],
        governanceTrackedDirtyFiles: [],
        regenerableArtifactFiles: [],
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
    const historicalCloseback = historicalDeliveredFiles.length > 0;
    const scopeTrackedDirtyFiles = uniqueStrings(buckets.scopeTrackedDirtyFiles.filter((filePath) => {
        if (allowedAdvisoryDirtyFiles.has(filePath)) {
            return false;
        }
        if (!historicalCloseback)
            return true;
        const matchesDeliverable = deliverableFiles.some((declared) => pathMatchesTaskScope(filePath, declared));
        if (!matchesDeliverable) {
            return false;
        }
        return !isHistoricalDeliveredFile(filePath, deliverableFiles, historicalDeliveredFiles);
    }));
    const historicalAdvisoryScopeTrackedFiles = historicalCloseback
        ? uniqueStrings(buckets.scopeTrackedDirtyFiles.filter((filePath) => !scopeTrackedDirtyFiles.includes(filePath)))
        : [];
    const governanceTrackedDirtyFiles = uniqueStrings(buckets.governanceTrackedDirtyFiles.filter((filePath) => !allowedAdvisoryGovernanceFiles.has(filePath) && !allowedAdvisoryDirtyFiles.has(filePath)));
    const allowlistedGovernanceTrackedFiles = uniqueStrings(buckets.governanceTrackedDirtyFiles.filter((filePath) => allowedAdvisoryGovernanceFiles.has(filePath) || allowedAdvisoryDirtyFiles.has(filePath)));
    const foreignActiveDirtyFiles = uniqueStrings(trackedDirtyFiles.filter((filePath) => allowedAdvisoryDirtyFiles.has(filePath)));
    const correctPlanningMirrorPreEditFiles = uniqueStrings(input.correctPlanningMirrorPreEditFiles ?? []);
    const incorrectPlanningMirrorPreEditFiles = uniqueStrings(input.incorrectPlanningMirrorPreEditFiles ?? []);
    const regenerableArtifactFiles = uniqueStrings(buckets.regenerableArtifactFiles);
    const blockingTrackedDirtyFiles = uniqueStrings([
        ...scopeTrackedDirtyFiles,
        ...governanceTrackedDirtyFiles,
        ...incorrectPlanningMirrorPreEditFiles
    ]);
    const generatedArtifactFiles = uniqueStrings(buckets.generatedArtifactFiles);
    const advisoryTrackedDirtyFiles = uniqueStrings([
        ...historicalAdvisoryScopeTrackedFiles,
        ...allowlistedGovernanceTrackedFiles,
        ...foreignActiveDirtyFiles,
        ...regenerableArtifactFiles,
        ...correctPlanningMirrorPreEditFiles,
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
        regenerableArtifactFiles,
        correctPlanningMirrorPreEditFiles,
        incorrectPlanningMirrorPreEditFiles,
        advisoryTrackedDirtyFiles,
        foreignActiveDirtyFiles,
        generatedArtifactFiles,
        remediation: {
            requiredCommand: ok ? null : `node atm.mjs git commit --actor <actor> --task ${input.taskId} --message "<delivery message>" --auto-stage --json`,
            safeToAutoStage: false,
            operatorSummary: ok
                ? 'No in-scope or closure-governance tracked dirty files block close. Same-task regenerable artifacts (bundle manifests, closure packets) and correct planning-mirror pre-edits are close-owned transient state until the final governed bundle lands.'
                : incorrectPlanningMirrorPreEditFiles.length > 0
                    ? 'Planning mirror edits do not match the governed closeback result. Restore the card or align frontmatter with taskflow close --dry-run before closing done.'
                    : 'Commit the task-scoped delivery or closure-governance files through the governed delivery lane before closing done. Same-task regenerable artifacts are advisory because taskflow close regenerates them; protected evidence and task ledgers still block close. Run taskflow pre-close to classify scope drift versus foreign staged bundles. During taskflow close --write, only the active close task may stage governed bundles while the close-window staged-index lock is held; defer foreign staged files explicitly with --defer-foreign-staged when the other agent can restage afterward.'
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
function isSameTaskRegenerableArtifact(filePath, taskId) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    const bundleManifest = `.atm/history/evidence/${taskId}.bundle-manifest.json`.toLowerCase();
    const closurePacket = `.atm/history/evidence/${taskId}.closure-packet.json`.toLowerCase();
    return normalized === bundleManifest || normalized === closurePacket;
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}
