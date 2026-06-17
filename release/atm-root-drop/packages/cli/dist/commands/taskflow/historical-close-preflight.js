import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { computeMissingValidatorReport } from '../evidence.js';
import { normalizeTaskId } from '../tasks/task-import-validators.js';
import { normalizeRelativePath } from '../tasks/task-file-io-helpers.js';
import { evaluateFrameworkCloseDirtyGuard } from '../tasks/scope-lock-diagnostics.js';
import { inspectHistoricalDelivery } from '../tasks/historical-delivery.js';
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
        restoreChoice: `Do not silently unstage ${foreignTaskId}. Either wait for that agent to commit, or run git restore --staged on only those paths and confirm the other agent can restage their close bundle afterward.`,
        deferCommand: `git restore --staged ${files.map((entry) => JSON.stringify(entry)).join(' ')}`
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
        const unexpected = readStagedFiles(repo.repoRoot).filter((file) => {
            if (expected.has(file))
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
            restoreCommand: `git -C ${JSON.stringify(repo.repoRoot)} restore --staged -- ${unexpected.map((entry) => JSON.stringify(entry)).join(' ')}`
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
                summary: 'If the drift is accidental, restore only the listed in-scope files with a scoped git restore (never broad checkout -- .).',
                requiredCommand: `git restore -- ${input.dirtyGuard.scopeTrackedDirtyFiles.map((entry) => JSON.stringify(entry)).join(' ')}`
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
        code: 'ATM_TASKFLOW_PRECLOSE_FOREIGN_STAGED_TASKS',
        summary: `Git index contains staged governance files for other tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless foreign bundles are deferred or committed separately.`,
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
    if (input.staleEvidence.length === 0)
        return null;
    return {
        id: 'staleEvidence',
        code: 'ATM_TASKFLOW_PRECLOSE_STALE_EVIDENCE',
        summary: 'Required validators are absent, stale, or not command-backed in task evidence.',
        files: [],
        remediationChoices: input.staleEvidence.map((validator) => ({
            id: 'refresh-evidence',
            summary: `Refresh command-backed evidence for ${validator}.`,
            requiredCommand: input.requiredCommand
        })),
        requiredCommand: input.requiredCommand
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
export function extractTaskflowDeclaredFiles(taskDocument) {
    const readList = (key) => {
        const value = taskDocument[key];
        if (!Array.isArray(value))
            return [];
        return value.filter((entry) => typeof entry === 'string');
    };
    return uniqueStrings([
        ...readList('deliverables'),
        ...readList('scopePaths'),
        ...readList('targetAllowedFiles')
    ]);
}
export function buildHistoricalClosePreflight(input) {
    const declaredFiles = extractTaskflowDeclaredFiles(input.taskDocument);
    const expectedCloseBundleFiles = uniqueStrings([
        ...input.previewCommitBundle.targetRepo.stageFiles,
        ...(input.previewCommitBundle.planningRepo.repoRoot ? input.previewCommitBundle.planningRepo.stageFiles : [])
    ]);
    const trackedDirtyFiles = readTrackedDirtyFiles(input.cwd);
    const dirtyGuard = evaluateFrameworkCloseDirtyGuard({
        cwd: input.cwd,
        taskId: input.taskId,
        taskDeclaredFiles: declaredFiles,
        trackedDirtyFiles,
        allowedAdvisoryGovernanceFiles: uniqueStrings([
            ...expectedCloseBundleFiles.filter((filePath) => filePath.startsWith('.atm/')),
            ...(input.historicalDeliveryRefs.length > 0
                ? [`.atm/history/evidence/${input.taskId}.json`]
                : [])
        ])
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
    const staleRequiredCommand = missingReport?.blockingFindings[0]?.requiredCommand ?? null;
    const operationalBlockers = [
        buildScopeDirtyBlocker({ taskId: input.taskId, actorId: input.actorId, dirtyGuard }),
        buildUnexpectedStagedBlocker(unexpectedStagedTasks),
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
        taskId: input.taskId,
        staleEvidence,
        requiredCommand: staleRequiredCommand
    });
    const blockers = staleBlocker ? [...operationalBlockers, staleBlocker] : operationalBlockers;
    return {
        schemaId: 'atm.historicalClosePreflight.v1',
        taskId: input.taskId,
        ok: blockers.length === 0,
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
