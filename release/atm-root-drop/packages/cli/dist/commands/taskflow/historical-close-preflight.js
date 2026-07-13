import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { computeMissingValidatorReport } from '../evidence.js';
import { ATM_INDEX_FOREIGN_ACTIVE_STAGED } from '../git-index-ownership.js';
import { readActiveTaskDirectionLocks } from '../task-direction.js';
import { normalizeTaskId } from '../tasks/task-import-validators.js';
import { normalizeRelativePath } from '../tasks/task-file-io-helpers.js';
import { evaluateFrameworkCloseDirtyGuard } from '../tasks/scope-lock-diagnostics.js';
import { evaluatePlanningMirrorDirtyFiles } from '../tasks/planning-mirror-close-diagnostics.js';
import { inspectHistoricalDelivery } from '../tasks/historical-delivery.js';
import { isPathAllowedByScope } from '../work-channels.js';
import { resolveTaskflowDeclaredFiles, resolveTaskflowEffectiveDeliverables } from './task-scope.js';
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}
function extractGovernanceTaskId(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized.startsWith('.atm/history/'))
        return null;
    const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/);
    if (tasksMatch)
        return normalizeTaskId(tasksMatch[1]);
    const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/);
    if (evidenceMatch)
        return normalizeTaskId(evidenceMatch[1]);
    const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//);
    if (eventMatch)
        return normalizeTaskId(eventMatch[1]);
    return null;
}
function isSameTaskAdvisoryStagedFile(taskId, filePath) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    const bundleManifest = `.atm/history/evidence/${normalizedTaskId}.bundle-manifest.json`.toLowerCase();
    const closurePacket = `.atm/history/evidence/${normalizedTaskId}.closure-packet.json`.toLowerCase();
    if (normalized === bundleManifest || normalized === closurePacket) {
        return true;
    }
    const foreignSnapshotPattern = new RegExp(`^\\.atm/runtime/snapshots/(?:close-window-)?foreign-staged-${normalizedTaskId.toLowerCase()}-\\d+\\.json$`);
    if (foreignSnapshotPattern.test(normalized)) {
        return true;
    }
    const governanceDirtyPattern = new RegExp(`^\\.atm/runtime/snapshots/close-window-governance-dirty-[^.]+-\\.atm__history__evidence__${normalizedTaskId.toLowerCase()}(?:\\.[^.]+)?\\.json\\.json$`);
    return governanceDirtyPattern.test(normalized);
}
function readTrackedDirtyFiles(repoRoot) {
    try {
        const output = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        return uniqueStrings(output.split(/\r?\n/));
    }
    catch {
        return [];
    }
}
function readStagedFiles(repoRoot) {
    try {
        const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        return uniqueStrings(output.split(/\r?\n/));
    }
    catch {
        return [];
    }
}
function listForeignActiveFiles(cwd, taskId, files) {
    const normalizedTaskId = normalizeTaskId(taskId);
    const foreignLocks = readActiveTaskDirectionLocks(cwd).filter((lock) => lock.taskId !== normalizedTaskId && lock.status === 'active');
    return uniqueStrings(files.filter((filePath) => foreignLocks.some((lock) => isPathAllowedByScope(filePath, lock.allowedFiles))));
}
function existingBundleFiles(repoRoot, stageFiles) {
    if (!repoRoot)
        return [];
    return uniqueStrings(stageFiles.filter((file) => existsSync(path.resolve(repoRoot, file))));
}
function buildUnexpectedStagedTasks(input) {
    const expected = new Set([
        ...existingBundleFiles(input.targetRepoRoot, input.previewCommitBundle.targetRepo.stageFiles),
        ...existingBundleFiles(input.planningRepoRoot, input.previewCommitBundle.planningRepo.stageFiles)
    ]);
    const stagedFiles = uniqueStrings([
        ...readStagedFiles(input.targetRepoRoot),
        ...(input.planningRepoRoot ? readStagedFiles(input.planningRepoRoot) : [])
    ]);
    const unexpected = stagedFiles.filter((file) => !expected.has(file));
    const grouped = new Map();
    for (const filePath of unexpected) {
        const foreignTaskId = extractGovernanceTaskId(filePath);
        if (!foreignTaskId || foreignTaskId === normalizeTaskId(input.taskId))
            continue;
        const bucket = grouped.get(foreignTaskId) ?? [];
        bucket.push(filePath);
        grouped.set(foreignTaskId, bucket);
    }
    return [...grouped.entries()].map(([foreignTaskId, files]) => ({
        taskId: foreignTaskId,
        stagedFiles: uniqueStrings(files),
        restoreChoice: `Do not silently unstage ${foreignTaskId}. Wait for the owner, request a Broker index lane, or use an explicit ATM stage-override lease if the human approved disrupting another active agent.`,
        deferCommand: `node atm.mjs git lease stage-override --task ${input.taskId} --actor <actor-id> --paths ${files.map((entry) => JSON.stringify(entry)).join(',')} --reason "<human-approved reason>" --json`
    }));
}
function buildUnexpectedNonBundleStagedFiles(input) {
    const repos = [
        {
            repoRoot: input.targetRepoRoot,
            repoKind: 'target',
            stageFiles: input.previewCommitBundle.targetRepo.stageFiles
        },
        ...(input.planningRepoRoot
            ? [{
                    repoRoot: input.planningRepoRoot,
                    repoKind: 'planning',
                    stageFiles: input.previewCommitBundle.planningRepo.stageFiles
                }]
            : [])
    ];
    const reports = [];
    for (const repo of repos) {
        const expected = new Set(existingBundleFiles(repo.repoRoot, repo.stageFiles));
        const stagedFiles = readStagedFiles(repo.repoRoot);
        const deferredForeignFiles = listForeignActiveFiles(input.targetRepoRoot, input.taskId, stagedFiles);
        const unexpected = stagedFiles.filter((file) => {
            if (expected.has(file))
                return false;
            if (isSameTaskAdvisoryStagedFile(input.taskId, file))
                return false;
            if (deferredForeignFiles.includes(file))
                return false;
            const foreignTaskId = extractGovernanceTaskId(file);
            return !foreignTaskId || foreignTaskId === normalizeTaskId(input.taskId);
        });
        if (unexpected.length === 0)
            continue;
        reports.push({
            repoRoot: repo.repoRoot,
            repoKind: repo.repoKind,
            stagedFiles: uniqueStrings(unexpected),
            restoreCommand: `node atm.mjs git lease stage-override --task ${input.taskId} --actor <actor-id> --paths ${unexpected.map((entry) => JSON.stringify(entry)).join(',')} --reason "<human-approved reason>" --json`,
            deferredForeignFiles
        });
    }
    return reports;
}
function buildUnexpectedNonBundleStagedBlocker(reports) {
    if (reports.length === 0)
        return null;
    const files = uniqueStrings(reports.flatMap((entry) => entry.stagedFiles));
    return {
        id: 'unexpectedStagedNonBundleFiles',
        code: 'ATM_TASKFLOW_PRECLOSE_UNEXPECTED_STAGED_FILES',
        summary: `Git index contains staged files outside the close bundle (${files.join(', ')}). taskflow close --write will fail with INDEX_NOT_ISOLATED until they are unstaged or committed separately.`,
        files,
        remediationChoices: reports.map((entry) => ({
            id: 'restore-accidental-staged',
            summary: `Unstage unrelated files in the ${entry.repoKind} repo only; do not use broad git reset.`,
            requiredCommand: entry.restoreCommand
        })),
        requiredCommand: reports[0]?.restoreCommand ?? null
    };
}
function buildIncorrectPlanningMirrorBlocker(input) {
    if (input.dirtyGuard.incorrectPlanningMirrorPreEditFiles.length === 0)
        return null;
    return {
        id: 'incorrectPlanningMirrorPreEdit',
        code: 'ATM_TASKFLOW_PRECLOSE_PLANNING_MIRROR_PREEDIT_INVALID',
        summary: 'Planning mirror edits do not match the governed closeback result; incorrect pre-edits remain blockers.',
        files: input.dirtyGuard.incorrectPlanningMirrorPreEditFiles,
        remediationChoices: [
            {
                id: 'restore-accidental-drift',
                summary: 'Restore the planning card frontmatter to the active claim state, then rerun taskflow close --dry-run.',
                requiredCommand: input.dirtyGuard.remediation.requiredCommand
            }
        ],
        requiredCommand: input.dirtyGuard.remediation.requiredCommand
    };
}
function buildScopeDirtyBlocker(input) {
    if (input.dirtyGuard.scopeTrackedDirtyFiles.length === 0)
        return null;
    return {
        id: 'scopeTrackedDirtyFiles',
        code: 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY',
        summary: 'In-scope delivery files are modified but not committed; close --write needs a governed delivery commit first.',
        files: input.dirtyGuard.scopeTrackedDirtyFiles,
        remediationChoices: [
            {
                id: 'commit-scoped-delivery',
                summary: 'Commit only task-scoped delivery files through the governed git commit lane.',
                requiredCommand: input.dirtyGuard.remediation.requiredCommand
            },
            {
                id: 'restore-accidental-drift',
                summary: 'If the drift is accidental, do not run raw git restore; request an explicit ATM destructive-override lease before any worktree mutation.',
                requiredCommand: `node atm.mjs git lease destructive-override --task ${input.taskId} --actor ${input.actorId} --paths ${input.dirtyGuard.scopeTrackedDirtyFiles.map((entry) => JSON.stringify(entry)).join(',')} --reason "<human-approved reason>" --json`
            }
        ],
        requiredCommand: input.dirtyGuard.remediation.requiredCommand
    };
}
function buildUnexpectedStagedBlocker(unexpectedStagedTasks) {
    if (unexpectedStagedTasks.length === 0)
        return null;
    const taskIds = unexpectedStagedTasks.map((entry) => entry.taskId);
    const files = uniqueStrings(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
    return {
        id: 'unexpectedStagedTasks',
        code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
        summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
        files,
        taskIds,
        remediationChoices: unexpectedStagedTasks.map((entry) => ({
            id: 'defer-foreign-staged',
            summary: entry.restoreChoice,
            requiredCommand: entry.deferCommand
        })),
        requiredCommand: unexpectedStagedTasks[0]?.deferCommand ?? null
    };
}
function buildMixedDeliveryBlocker(input) {
    if (!input.report || !input.historicalRef)
        return null;
    if (input.report.reason !== 'out-of-scope-source-files-present' && input.report.reason !== 'out-of-scope-waiver-reason-required') {
        return null;
    }
    const missingLease = input.report.reason === 'out-of-scope-waiver-reason-required';
    return {
        id: missingLease ? 'missingApprovalLease' : 'mixedDeliveryCommit',
        code: missingLease
            ? 'ATM_TASKFLOW_PRECLOSE_MISSING_APPROVAL_LEASE'
            : 'ATM_TASKFLOW_PRECLOSE_MIXED_DELIVERY_COMMIT',
        summary: missingLease
            ? `Historical delivery ${input.historicalRef} requires --waiver-out-of-scope-delivery with a non-empty --reason before close --write.`
            : `Historical delivery ${input.historicalRef} includes out-of-scope source files from other tasks.`,
        files: input.report.fileBuckets.outOfScopeSourceFiles,
        remediationChoices: [
            {
                id: 'request-waiver',
                summary: 'Request explicit waiver approval with a durable reason, then rerun pre-close and close --write.',
                requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${JSON.stringify(input.actorId)} --historical-delivery ${input.historicalRef} --waiver-out-of-scope-delivery --reason "<reason>" --write --json`
            }
        ],
        requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${JSON.stringify(input.actorId)} --historical-delivery ${input.historicalRef} --waiver-out-of-scope-delivery --reason "<reason>" --write --json`
    };
}
function buildStaleEvidenceBlocker(input) {
    if (input.findings.length === 0)
        return null;
    return {
        id: 'staleEvidence',
        code: 'ATM_TASKFLOW_PRECLOSE_STALE_EVIDENCE',
        summary: 'Required validators are absent, stale, or not command-backed in task evidence.',
        files: [],
        remediationChoices: input.findings.map((finding) => ({
            id: 'refresh-evidence',
            summary: `Refresh command-backed evidence for ${finding.validator}.`,
            requiredCommand: finding.requiredCommand
        })),
        requiredCommand: input.findings[0]?.requiredCommand ?? null
    };
}
function buildWriteRollbackSummary(taskId) {
    return {
        schemaId: 'atm.historicalCloseWriteRollbackSummary.v1',
        summary: 'taskflow close --write is not atomic: backend close may mark the ledger done before governed commits land. If commit fails after write begins, verify ledger state and finish or roll back through governed commands only.',
        operatorWarnings: [
            'Do not hand-edit .atm/history/tasks/*.json to force done or released.',
            'Do not silently unstage another agent staged close bundle; defer foreign staged files explicitly and confirm they can restage afterward.',
            'Do not use broad git checkout --, git restore ., or git clean to remediate dirty files.',
            'Use node atm.mjs git commit for target governance files; planning mirror commits may use git -C with ATM trailers in the message body.'
        ],
        verificationCommands: [
            `node atm.mjs tasks status --task ${taskId} --json`,
            `node atm.mjs taskflow pre-close --task ${taskId} --actor <actor> --json`,
            `git status --short`,
            `git diff --cached --name-only`
        ]
    };
}
export function extractTaskflowDeclaredFiles(cwd, taskId, taskDocument) {
    return uniqueStrings([...resolveTaskflowDeclaredFiles(cwd, taskId, taskDocument)]);
}
function extractTaskflowDeliverableFiles(cwd, taskId, taskDocument) {
    return uniqueStrings([...resolveTaskflowEffectiveDeliverables(cwd, taskId, taskDocument)]);
}
export function buildHistoricalClosePreflight(input) {
    const declaredFiles = extractTaskflowDeclaredFiles(input.cwd, input.taskId, input.taskDocument);
    const deliverableFiles = extractTaskflowDeliverableFiles(input.cwd, input.taskId, input.taskDocument);
    const expectedCloseBundleFiles = uniqueStrings([
        ...input.previewCommitBundle.targetRepo.stageFiles,
        ...(input.previewCommitBundle.planningRepo.repoRoot ? input.previewCommitBundle.planningRepo.stageFiles : [])
    ]);
    const trackedDirtyFiles = readTrackedDirtyFiles(input.cwd);
    const foreignActiveDirtyFiles = listForeignActiveFiles(input.cwd, input.taskId, trackedDirtyFiles);
    const planningMirrorRelativePath = input.previewCommitBundle.planningRepo.stageFiles[0] ?? null;
    const planningMirrorDirty = evaluatePlanningMirrorDirtyFiles({
        planningRepoRoot: input.previewCommitBundle.planningRepo.repoRoot,
        planningMirrorRelativePath,
        trackedDirtyFiles: input.previewCommitBundle.planningRepo.repoRoot
            ? readTrackedDirtyFiles(input.previewCommitBundle.planningRepo.repoRoot)
            : [],
        actorId: input.actorId,
        historicalDeliveryRef: input.historicalDeliveryRefs[0] ?? null
    });
    const historicalDeliveredFiles = uniqueStrings(input.historicalDeliveryRefs.flatMap((ref) => inspectHistoricalDelivery({
        cwd: input.cwd,
        taskId: input.taskId,
        requestedRef: ref,
        declaredFiles,
        enforceDeclaredScope: true,
        waiverOutOfScopeDelivery: false,
        waiverReason: null
    }).deliverableFiles));
    const dirtyGuard = evaluateFrameworkCloseDirtyGuard({
        cwd: input.cwd,
        taskId: input.taskId,
        taskDeclaredFiles: declaredFiles,
        taskDeliverableFiles: deliverableFiles,
        trackedDirtyFiles,
        historicalDeliveredFiles,
        allowedAdvisoryGovernanceFiles: uniqueStrings([
            ...expectedCloseBundleFiles.filter((filePath) => filePath.startsWith('.atm/')),
            ...(input.historicalDeliveryRefs.length > 0
                ? [`.atm/history/evidence/${input.taskId}.json`]
                : [])
        ]),
        allowedAdvisoryDirtyFiles: foreignActiveDirtyFiles,
        correctPlanningMirrorPreEditFiles: planningMirrorDirty.correctPlanningMirrorPreEditFiles,
        incorrectPlanningMirrorPreEditFiles: planningMirrorDirty.incorrectPlanningMirrorPreEditFiles
    });
    const unexpectedStagedTasks = buildUnexpectedStagedTasks({
        taskId: input.taskId,
        targetRepoRoot: input.cwd,
        planningRepoRoot: input.previewCommitBundle.planningRepo.repoRoot,
        previewCommitBundle: input.previewCommitBundle
    });
    const unexpectedNonBundleStaged = buildUnexpectedNonBundleStagedFiles({
        taskId: input.taskId,
        targetRepoRoot: input.cwd,
        planningRepoRoot: input.previewCommitBundle.planningRepo.repoRoot,
        previewCommitBundle: input.previewCommitBundle
    });
    const historicalRef = input.historicalDeliveryRefs[0] ?? null;
    const mixedDeliveryCommit = historicalRef
        ? inspectHistoricalDelivery({
            cwd: input.cwd,
            taskId: input.taskId,
            requestedRef: historicalRef,
            declaredFiles,
            enforceDeclaredScope: true,
            waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery,
            waiverReason: input.waiverReason
        })
        : null;
    const missingApprovalLease = mixedDeliveryCommit?.reason === 'out-of-scope-waiver-reason-required';
    const missingReport = input.actorId
        ? computeMissingValidatorReport(input.cwd, input.taskId, input.actorId)
        : null;
    const staleEvidence = missingReport
        ? missingReport.blockingFindings
            .filter((entry) => entry.category === 'stale' || entry.category === 'absent' || entry.category === 'failed-run' || entry.category === 'diagnostic-only')
            .map((entry) => entry.validator)
        : [];
    const operationalBlockers = [
        buildScopeDirtyBlocker({ taskId: input.taskId, actorId: input.actorId, dirtyGuard }),
        buildIncorrectPlanningMirrorBlocker({ taskId: input.taskId, actorId: input.actorId, dirtyGuard }),
        buildUnexpectedNonBundleStagedBlocker(unexpectedNonBundleStaged),
        buildMixedDeliveryBlocker({
            taskId: input.taskId,
            actorId: input.actorId,
            historicalRef,
            report: mixedDeliveryCommit,
            waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery,
            waiverReason: input.waiverReason
        })
    ].filter((entry) => entry !== null);
    const staleBlocker = buildStaleEvidenceBlocker({
        findings: missingReport?.blockingFindings.filter((entry) => entry.category === 'stale' || entry.category === 'absent' || entry.category === 'failed-run' || entry.category === 'diagnostic-only') ?? []
    });
    const blockers = staleBlocker ? [...operationalBlockers, staleBlocker] : operationalBlockers;
    return {
        schemaId: 'atm.historicalClosePreflight.v1',
        taskId: input.taskId,
        ok: blockers.length === 0 && dirtyGuard.ok,
        blockers,
        operationalBlockers,
        scopeTrackedDirtyFiles: dirtyGuard.scopeTrackedDirtyFiles,
        unexpectedStagedTasks,
        unexpectedNonBundleStaged,
        mixedDeliveryCommit,
        staleEvidence,
        missingApprovalLease,
        dirtyGuard,
        writeRollbackSummary: buildWriteRollbackSummary(input.taskId)
    };
}
export function preflightBlockersToWriteReadinessBlockers(preflight) {
    return preflight.blockers.map((blocker) => ({
        code: blocker.code,
        summary: blocker.summary,
        requiredCommand: blocker.requiredCommand
    }));
}
