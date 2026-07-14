import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitMessage } from './commit-messages.js';
import { expandDirectoryDeliverableDeclarations } from '../tasks/historical-delivery.js';
import { loadTaskDocumentOrThrow } from '../tasks/public-surface.js';
import { assertCloseWindowStagingAllowed } from '../tasks/close-window-lock.js';
import { validateStrictPathHeuristic } from '../tasks/task-import-validators.js';
import { listOptionalEvidenceBundleGovernanceArtifacts } from './closeback-orchestration.js';
import { resolveTaskflowDeclaredFiles, resolveTaskflowEffectiveDeliverables } from './task-scope.js';
import { listTaskOwnedProtectedOverrideAuditFiles, resolveActorGitIdentityForCommit, runAtmGit } from '../git-governance.js';
import { resolvePlanningPathFromStored } from '../planning-repo-root.js';
import { CliError, quoteCliValue } from '../shared.js';
import { isPathAllowedByScope } from '../work-channels.js';
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function normalizeTaskflowRelativePath(filePath) {
    return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeRepoRelativePath(repoRoot, filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
    return path.relative(repoRoot, resolved).replace(/\\/g, '/');
}
function listExistingFilesRecursively(root, relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    if (!existsSync(directory))
        return [];
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
        const absolutePath = path.join(root, relativePath);
        if (entry.isDirectory()) {
            files.push(...listExistingFilesRecursively(root, relativePath));
        }
        else if (entry.isFile()) {
            files.push(normalizeRepoRelativePath(root, absolutePath));
        }
    }
    return files;
}
function listCurrentTaskGovernanceFiles(root, taskId) {
    const taskFiles = [
        `.atm/history/tasks/${taskId}.json`,
        `.atm/history/evidence/${taskId}.json`,
        `.atm/history/evidence/${taskId}.closure-packet.json`
    ].filter((filePath) => existsSync(path.join(root, filePath)));
    const taskEvents = listExistingFilesRecursively(root, `.atm/history/task-events/${taskId}`);
    const handoffHistory = listExistingFilesRecursively(root, `.atm/history/handoff/${taskId}`);
    return uniqueSorted([...taskFiles, ...taskEvents, ...handoffHistory]);
}
function tryGitScalar(cwd, args) {
    try {
        return execFileSync('git', [...args], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim() || null;
    }
    catch {
        return null;
    }
}
function runGitOrThrow(cwd, args) {
    execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
function runGitWithEnv(cwd, args, env) {
    execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env
    });
}
function readGitRoot(startPath) {
    const probe = existsSync(startPath) && statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const root = tryGitScalar(probe, ['rev-parse', '--show-toplevel']);
    return root ? path.resolve(root) : null;
}
function sha256Text(value) {
    return createHash('sha256').update(value).digest('hex');
}
function extractTaskStringList(taskDocument, key) {
    const value = taskDocument[key];
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '').filter(Boolean)
        : [];
}
function isCanonicalTaskflowDeliverableCandidate(value) {
    const normalized = value.trim().replace(/\\/g, '/');
    if (!normalized)
        return false;
    if (normalized.startsWith('.atm/'))
        return false;
    if (/[\\/]$/.test(normalized))
        return false;
    if (validateStrictPathHeuristic(normalized))
        return false;
    return true;
}
function extractTaskflowDeliverables(taskDocument) {
    const explicit = uniqueSorted(extractTaskStringList(taskDocument, 'deliverables').filter(isCanonicalTaskflowDeliverableCandidate));
    if (explicit.length > 0)
        return explicit;
    const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
    return uniqueSorted(scopePaths.filter(isCanonicalTaskflowDeliverableCandidate));
}
function sourcePlanPathOf(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const planPath = source.planPath;
    return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}
function taskflowPathMatches(filePath, declaredPath) {
    return isPathAllowedByScope(filePath, [declaredPath]);
}
function buildScopeAmendmentProposal(input) {
    const candidateFiles = uniqueSorted(input.candidateFiles);
    if (candidateFiles.length === 0) {
        return {
            required: false,
            candidateFiles,
            reason: null,
            remediationCommand: null,
            humanReviewRequired: false,
            notes: []
        };
    }
    const planPath = sourcePlanPathOf(input.taskDocument);
    const remediationCommand = planPath
        ? `node atm.mjs tasks import --from ${quoteCliValue(planPath)} --write --force --json`
        : `node atm.mjs tasks scope add --task ${input.taskId} --actor ${input.actorId ?? '<actor>'} --add ${candidateFiles.join(',')} --json`;
    return {
        required: true,
        candidateFiles,
        reason: input.reason ?? 'Dirty files overlap the task scope but are not justified by deliverables and targetAllowedFiles.',
        remediationCommand,
        humanReviewRequired: true,
        notes: [
            'Do not restore, checkout, clean, or delete another agent active work to satisfy closeout.',
            'Repair the governed task metadata or direction lock, rerun taskflow close --dry-run, then close through taskflow close --write.',
            'The CLI-computed bundle remains authoritative; LLM review may flag omissions but must not append files ad hoc.'
        ]
    };
}
function getDirtyFiles(cwd) {
    const output = tryGitScalar(cwd, ['status', '--porcelain', '-uall']) ?? '';
    const files = [];
    for (const line of output.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let filePart = line.slice(2).trim();
        if (filePart.startsWith('"') && filePart.endsWith('"')) {
            try {
                filePart = JSON.parse(filePart);
            }
            catch {
                filePart = filePart.slice(1, -1);
            }
        }
        if (line.startsWith('R ')) {
            const parts = filePart.split(' -> ');
            if (parts[1])
                filePart = parts[1].trim();
        }
        files.push(filePart.replace(/\\/g, '/'));
    }
    return [...new Set(files.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function getHistoricalCommittedFiles(cwd, refs) {
    const files = [];
    for (const ref of refs) {
        if (!ref)
            continue;
        const commitSha = tryGitScalar(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
        if (!commitSha)
            continue;
        const output = tryGitScalar(cwd, ['show', '--pretty=format:', '--name-only', commitSha, '--']) ?? '';
        for (const line of output.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed)
                files.push(trimmed.replace(/\\/g, '/'));
        }
    }
    return [...new Set(files)];
}
export function readStagedFiles(repoRoot) {
    const output = tryGitScalar(repoRoot, ['diff', '--cached', '--name-only']) ?? '';
    return uniqueSorted(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}
function existingBundleFiles(repo) {
    if (!repo.repoRoot)
        return [];
    return uniqueSorted(repo.stageFiles.filter((file) => existsSync(path.resolve(repo.repoRoot ?? '', file))));
}
function isSameRepoBundle(bundle) {
    if (!bundle.targetRepo.repoRoot || !bundle.planningRepo.repoRoot)
        return false;
    return path.resolve(bundle.targetRepo.repoRoot) === path.resolve(bundle.planningRepo.repoRoot);
}
function buildSharedRepoBundle(repoRoot, stageFiles) {
    return {
        repoRoot,
        stageFiles: uniqueSorted(stageFiles),
        commitMessage: '',
        commitCommand: '',
        commitSha: null,
        status: 'uncomputed'
    };
}
function buildIndexIsolation(repo, stagedFiles) {
    const expectedStageFiles = existingBundleFiles(repo);
    const expected = new Set(expectedStageFiles);
    const preStagedFiles = uniqueSorted(stagedFiles);
    const unexpectedStagedFiles = preStagedFiles.filter((file) => !expected.has(file));
    return {
        verified: unexpectedStagedFiles.length === 0,
        expectedStageFiles,
        preStagedFiles,
        unexpectedStagedFiles
    };
}
function verifyRepoIndexIsolation(repo, phase, strict = true) {
    if (!repo.repoRoot)
        return repo;
    const isolation = buildIndexIsolation(repo, readStagedFiles(repo.repoRoot));
    const nextRepo = { ...repo, indexIsolation: isolation };
    if (strict && !isolation.verified) {
        const restoreCommand = isolation.unexpectedStagedFiles.length > 0
            ? `node atm.mjs git lease stage-override --task <task-id> --actor <actor-id> --paths ${isolation.unexpectedStagedFiles.map((entry) => JSON.stringify(entry)).join(',')} --reason "<human-approved reason>" --json`
            : null;
        throw new CliError('ATM_TASKFLOW_CLOSE_INDEX_NOT_ISOLATED', `taskflow close ${phase} index isolation failed; unexpected staged files would be included in the governed commit.`, {
            exitCode: 1,
            details: {
                repoRoot: repo.repoRoot,
                phase,
                indexIsolation: isolation,
                restoreCommand,
                remediation: restoreCommand
                    ? `Unstage unrelated files, then rerun taskflow close: ${restoreCommand}`
                    : 'Unstage unrelated files or commit them separately, then rerun taskflow close.'
            }
        });
    }
    return nextRepo;
}
function commitCommandFor(input) {
    if (!input.repoRoot)
        return '';
    if (input.repoKind === 'target') {
        return `node atm.mjs git commit --cwd ${quoteCliValue(input.repoRoot)} --actor ${quoteCliValue(input.actorId ?? '<actor>')} --task ${input.taskId} --message ${quoteCliValue(input.commitMessage)} --auto-stage --json`;
    }
    const messageParts = [
        input.commitMessage,
        '',
        `ATM-Actor: ${input.actorId ?? '<actor>'}`,
        `ATM-Task: ${input.taskId}`,
        'ATM-Surface: taskflow-close-planning-bundle'
    ];
    return `git -C ${quoteCliValue(input.repoRoot)} commit -m ${quoteCliValue(messageParts.join('\n'))}`;
}
function extractBackendStageFiles(backendResult) {
    const evidence = backendResult?.evidence;
    if (!evidence)
        return [];
    const files = [];
    for (const key of ['taskPath', 'closurePacketPath', 'transitionPath']) {
        const value = evidence[key];
        if (typeof value === 'string' && value.trim())
            files.push(value);
    }
    const allowedFiles = evidence.closeCommitWindowAllowedFiles;
    if (Array.isArray(allowedFiles)) {
        files.push(...allowedFiles.filter((value) => typeof value === 'string'));
    }
    return files;
}
function resolveHistoricalBatchPath(cwd, batchRef) {
    const trimmed = batchRef.trim();
    if (!trimmed)
        return null;
    if (path.isAbsolute(trimmed))
        return trimmed;
    if (trimmed.includes('/') || trimmed.includes('\\'))
        return path.resolve(cwd, trimmed);
    return path.join(cwd, '.atm', 'history', 'evidence', 'historical-batches', trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`);
}
function resolveExistingHistoricalBatchStageFile(cwd, batchRef) {
    if (!batchRef)
        return null;
    const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
    if (!batchPath || !existsSync(batchPath))
        return null;
    return normalizeRepoRelativePath(cwd, batchPath);
}
function resolvePlanningPath(cwd, planningMirrorPath) {
    return resolvePlanningPathFromStored(cwd, planningMirrorPath);
}
export function isDeferrableGovernanceDirtyFile(filePath, taskId) {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (normalized === '.atm/history/evidence/git-head.jsonl')
        return true;
    // Foreign-task bundle-manifest dirt must never be restored away during another
    // task's close window; only the active task's own manifest is safe to defer.
    if (!taskId)
        return false;
    const taskLower = taskId.trim().toLowerCase();
    if (!taskLower)
        return false;
    return normalized === `.atm/history/evidence/${taskLower}.bundle-manifest.json`;
}
function listUnstagedDirtyFiles(repoRoot) {
    const output = tryGitScalar(repoRoot, ['diff', '--name-only']) ?? '';
    return uniqueSorted(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}
export function deferGovernanceDirtyFiles(repoRoot, requested, taskId) {
    const report = {
        schemaId: 'atm.deferredGovernanceDirty.v1',
        requested,
        files: [],
        restored: false,
        skippedMissingSnapshots: []
    };
    if (!requested)
        return report;
    const candidates = listUnstagedDirtyFiles(repoRoot).filter((file) => isDeferrableGovernanceDirtyFile(file, taskId));
    if (candidates.length === 0) {
        report.restored = true;
        return report;
    }
    const snapshotRoot = path.join(repoRoot, '.atm', 'runtime', 'snapshots');
    mkdirSync(snapshotRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const file of candidates) {
        const absolutePath = path.join(repoRoot, file);
        const content = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
        const snapshotPath = path.join(snapshotRoot, `close-window-governance-dirty-${timestamp}-${file.replace(/[\\/]/g, '__')}.json`);
        writeFileSync(snapshotPath, `${JSON.stringify({
            schemaId: 'atm.closeWindowGovernanceDirtySnapshot.v1',
            file,
            originalSha256: sha256Text(content),
            content,
            createdAt: new Date().toISOString(),
            restoredAt: null
        }, null, 2)}\n`, 'utf8');
        runGitOrThrow(repoRoot, ['restore', '--worktree', '--', file]);
        report.files.push({
            file,
            snapshotPath: normalizeRepoRelativePath(repoRoot, snapshotPath),
            originalSha256: sha256Text(content),
            restoredAt: null
        });
    }
    return report;
}
export function restoreDeferredGovernanceDirtyFiles(repoRoot, report) {
    if (report.restored || report.files.length === 0) {
        return { ...report, restored: true, skippedMissingSnapshots: report.skippedMissingSnapshots ?? [] };
    }
    const restoredAt = new Date().toISOString();
    const skippedMissingSnapshots = [];
    const files = report.files.map((entry) => {
        const snapshotPath = path.join(repoRoot, entry.snapshotPath);
        if (!existsSync(snapshotPath)) {
            skippedMissingSnapshots.push(entry.snapshotPath);
            return {
                ...entry,
                skipReason: 'snapshot-missing'
            };
        }
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        const file = typeof snapshot.file === 'string' ? snapshot.file : entry.file;
        const content = typeof snapshot.content === 'string' ? snapshot.content : '';
        const absolutePath = path.join(repoRoot, file);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content, 'utf8');
        writeFileSync(snapshotPath, `${JSON.stringify({ ...snapshot, restoredAt }, null, 2)}\n`, 'utf8');
        return { ...entry, restoredAt, skipReason: null };
    });
    return {
        ...report,
        files,
        restored: true,
        skippedMissingSnapshots
    };
}
export function buildTaskflowCommitBundle(input) {
    const targetRepoRoot = path.resolve(input.cwd);
    let taskDocument = {};
    try {
        const loaded = loadTaskDocumentOrThrow(targetRepoRoot, input.taskId);
        taskDocument = loaded.taskDocument;
    }
    catch {
        // fail closed later
    }
    const deliverables = extractTaskflowDeliverables(taskDocument);
    const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
    const targetAllowedFiles = extractTaskStringList(taskDocument, 'targetAllowedFiles');
    const effectiveRuntimeDeliverables = [...resolveTaskflowEffectiveDeliverables(targetRepoRoot, input.taskId, taskDocument)];
    const dirtyFiles = getDirtyFiles(targetRepoRoot);
    const historicalCommitted = getHistoricalCommittedFiles(targetRepoRoot, input.historicalDeliveryRefs ?? []);
    const historicalCloseback = historicalCommitted.length > 0;
    let allowed = uniqueSorted([
        ...targetAllowedFiles,
        ...resolveTaskflowDeclaredFiles(targetRepoRoot, input.taskId, taskDocument)
            .filter((entry) => !entry.startsWith('.atm/'))
    ]);
    if (allowed.length === 0) {
        allowed = scopePaths;
    }
    const targetDeliveryFiles = [];
    const historicalBatchStageFile = resolveExistingHistoricalBatchStageFile(targetRepoRoot, input.historicalBatchRef);
    const backendGovernanceFiles = [
        ...listCurrentTaskGovernanceFiles(targetRepoRoot, input.taskId),
        ...listOptionalEvidenceBundleGovernanceArtifacts(targetRepoRoot, input.taskId),
        ...(input.backendResult ? extractBackendStageFiles(input.backendResult) : []),
        // ATM-BUG-2026-07-07-052 (OPT-14): this task's own protected-override-audit
        // events were never part of any close bundle and would sit as untracked
        // evidence forever (or previously, get deleted as "auto-clean-safe"
        // residue by the git commit wrapper). Stage them here so `emergency audit
        // --task <id>` keeps finding evidence that actually landed in version
        // control.
        ...listTaskOwnedProtectedOverrideAuditFiles(targetRepoRoot, input.taskId)
    ];
    const targetGovernanceFiles = uniqueSorted([
        ...(historicalBatchStageFile ? [historicalBatchStageFile] : []),
        ...backendGovernanceFiles
    ]);
    const excludedDirtyFiles = [];
    const excludedReasons = {};
    const scopeAmendmentCandidateFiles = [];
    let metadataFailClosed = false;
    let failClosedReason = null;
    if (deliverables.length === 0) {
        metadataFailClosed = true;
        failClosedReason = 'Task metadata error: "deliverables" list is empty or missing.';
    }
    const directoryExpansion = expandDirectoryDeliverableDeclarations(targetRepoRoot, deliverables);
    if (!directoryExpansion.ok) {
        metadataFailClosed = true;
        failClosedReason = directoryExpansion.failClosedReason;
    }
    const effectiveDeliverables = uniqueSorted([
        ...(directoryExpansion.ok ? directoryExpansion.effectiveDeliverables : deliverables),
        ...effectiveRuntimeDeliverables
    ]);
    for (const del of effectiveDeliverables) {
        const isAllowed = allowed.some((all) => taskflowPathMatches(del, all));
        if (!isAllowed) {
            metadataFailClosed = true;
            failClosedReason = `Task metadata error: declared deliverable "${del}" falls outside active direction lock / targetAllowedFiles.`;
        }
    }
    const hasPlanningFile = effectiveDeliverables.some((del) => del.startsWith('docs/tasks/') || del.endsWith('.task.md'));
    const hasTargetFile = effectiveDeliverables.some((del) => !del.startsWith('docs/tasks/') && !del.endsWith('.task.md'));
    if (!input.planningAuthorityDeliveryOk && hasPlanningFile && hasTargetFile) {
        metadataFailClosed = true;
        failClosedReason = 'Task metadata error: deliverables contain mixed planning-path and target-path declarations.';
    }
    for (const file of dirtyFiles) {
        if (file.startsWith('.atm/'))
            continue;
        const inScope = scopePaths.some((sp) => taskflowPathMatches(file, sp));
        const isDeclared = effectiveDeliverables.some((del) => taskflowPathMatches(file, del));
        const isExplicitlyDeclaredFile = effectiveDeliverables.some((del) => normalizeTaskflowRelativePath(del) === file);
        const isAllowed = allowed.some((all) => taskflowPathMatches(file, all));
        if (historicalCloseback && isTaskflowScratchBackupFile(file) && !isExplicitlyDeclaredFile) {
            excludedDirtyFiles.push(file);
            excludedReasons[file] = inScope
                ? 'scratch/backup file inside broad scope; excluded as advisory residue during historical closeback'
                : 'scratch/backup file outside task scope; excluded from governed bundle and must be left untouched';
        }
        else if (isDeclared && isAllowed) {
            targetDeliveryFiles.push(file);
        }
        else {
            excludedDirtyFiles.push(file);
            if (inScope) {
                if (historicalCloseback) {
                    excludedReasons[file] = 'inside scope but outside declared deliverables; excluded as advisory residue during historical closeback';
                }
                else {
                    scopeAmendmentCandidateFiles.push(file);
                    metadataFailClosed = true;
                    failClosedReason = `Scope amendment required: dirty file "${file}" is inside task scope but is not declared in deliverables and targetAllowedFiles.`;
                    excludedReasons[file] = 'inside scope but not declared/allowed (fail-closed trigger)';
                }
            }
            else {
                excludedReasons[file] = 'outside task scope; excluded from governed bundle and must be left untouched';
            }
        }
    }
    const scopeAmendment = buildScopeAmendmentProposal({
        taskId: input.taskId,
        actorId: input.actorId,
        taskDocument,
        candidateFiles: scopeAmendmentCandidateFiles,
        reason: failClosedReason
    });
    const finalDeliveryFiles = targetDeliveryFiles.filter((file) => !historicalCommitted.some((h) => taskflowPathMatches(file, h)));
    const targetStageFiles = uniqueSorted([
        ...finalDeliveryFiles,
        ...targetGovernanceFiles
    ]);
    const planning = resolvePlanningPath(targetRepoRoot, input.planningMirrorPath);
    const planningStageFiles = planning.repoRoot && planning.relativePath
        ? uniqueSorted([
            planning.relativePath,
            ...(input.extraPlanningStageFiles ?? []),
            ...(input.rosterIndexPath
                ? [normalizeRepoRelativePath(planning.repoRoot, path.isAbsolute(input.rosterIndexPath)
                        ? input.rosterIndexPath
                        : path.resolve(planning.repoRoot, input.rosterIndexPath))]
                : [])
        ])
        : [];
    const targetMessage = buildTaskflowCommitMessage('target', { taskId: input.taskId });
    const planningMessage = buildTaskflowCommitMessage('planning', { taskId: input.taskId });
    const failClosed = metadataFailClosed || targetStageFiles.length === 0 || !planning.repoRoot || planningStageFiles.length === 0;
    return {
        schemaId: 'atm.taskflowGovernedCommitBundle.v1',
        taskId: input.taskId,
        actorId: input.actorId,
        targetRepo: {
            repoRoot: targetRepoRoot,
            stageFiles: targetStageFiles,
            commitMessage: targetMessage,
            commitCommand: commitCommandFor({
                repoRoot: targetRepoRoot,
                taskId: input.taskId,
                actorId: input.actorId,
                commitMessage: targetMessage,
                repoKind: 'target'
            }),
            commitSha: null,
            status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
            reason: failClosedReason || (targetStageFiles.length > 0 ? null : 'target close artifact paths could not be computed')
        },
        planningRepo: {
            repoRoot: planning.repoRoot,
            stageFiles: planningStageFiles,
            commitMessage: planningMessage,
            commitCommand: commitCommandFor({
                repoRoot: planning.repoRoot,
                taskId: input.taskId,
                actorId: input.actorId,
                commitMessage: planningMessage,
                repoKind: 'planning'
            }),
            commitSha: null,
            status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
            reason: planning.reason
        },
        commitMode: input.commitMode,
        failClosed,
        recoveryCommand: null,
        targetDeliveryFiles: finalDeliveryFiles,
        targetGovernanceFiles,
        planningFiles: planningStageFiles,
        excludedDirtyFiles,
        excludedReasons,
        scopeAmendment
    };
}
function isTaskflowScratchBackupFile(file) {
    const normalized = normalizeTaskflowRelativePath(file).toLowerCase();
    return normalized.endsWith('.bak')
        || normalized.endsWith('.backup')
        || normalized.endsWith('.orig')
        || normalized.endsWith('.tmp')
        || normalized.includes('/.tmp/')
        || normalized.includes('/tmp/');
}
export function assertCommitBundleReady(bundle) {
    if (bundle.failClosed || !bundle.targetRepo.repoRoot || !bundle.planningRepo.repoRoot) {
        throw new CliError('ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE', 'taskflow close cannot compute the dual-repo governed commit bundle.', {
            exitCode: 1,
            details: { governedCommitBundle: bundle }
        });
    }
}
function stageRepoBundle(repo, taskId) {
    if (repo.repoRoot && taskId) {
        assertCloseWindowStagingAllowed({
            cwd: repo.repoRoot,
            taskId,
            operation: 'taskflow close bundle staging'
        });
    }
    if (!repo.repoRoot || repo.stageFiles.length === 0) {
        return { ...repo, status: 'uncomputed' };
    }
    const existingFiles = existingBundleFiles(repo);
    if (existingFiles.length === 0) {
        return {
            ...repo,
            stageFiles: existingFiles,
            status: 'skipped',
            reason: 'no existing bundle files to stage',
            indexIsolation: buildIndexIsolation(repo, readStagedFiles(repo.repoRoot))
        };
    }
    runGitOrThrow(repo.repoRoot, ['add', '-A', '-f', '--', ...existingFiles]);
    return { ...repo, stageFiles: existingFiles, status: 'staged' };
}
async function commitTaskflowBundle(input) {
    const targetStageFiles = existingBundleFiles(input.bundle.targetRepo);
    const targetPreStagedFiles = input.bundle.targetRepo.repoRoot ? readStagedFiles(input.bundle.targetRepo.repoRoot) : [];
    const targetForeignStagedFiles = targetPreStagedFiles.filter((file) => !targetStageFiles.includes(file));
    if (input.bundle.targetRepo.repoRoot && targetForeignStagedFiles.length > 0) {
        runGitOrThrow(input.bundle.targetRepo.repoRoot, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...targetForeignStagedFiles]);
    }
    commitRepoWithTemporaryIndex({
        repoRoot: input.bundle.targetRepo.repoRoot ?? '',
        stageFiles: targetStageFiles,
        args: ['commit', '-m', input.bundle.targetRepo.commitMessage],
        actorId: input.actorId,
        taskId: input.taskId
    });
    const targetCommitSha = input.bundle.targetRepo.repoRoot
        ? tryGitScalar(input.bundle.targetRepo.repoRoot, ['rev-parse', '--verify', 'HEAD'])
        : null;
    if (input.bundle.targetRepo.repoRoot && targetForeignStagedFiles.length > 0) {
        runGitOrThrow(input.bundle.targetRepo.repoRoot, ['add', '-A', '-f', '--', ...targetForeignStagedFiles]);
    }
    let targetRepo = {
        ...input.bundle.targetRepo,
        commitSha: targetCommitSha,
        status: 'committed'
    };
    let planningRepo = input.bundle.planningRepo;
    try {
        if (!planningRepo.repoRoot) {
            throw new Error('planning repo root missing');
        }
        const planningStageFiles = existingBundleFiles(planningRepo);
        const planningPreStagedFiles = readStagedFiles(planningRepo.repoRoot);
        const planningForeignStagedFiles = planningPreStagedFiles.filter((file) => !planningStageFiles.includes(file));
        if (planningForeignStagedFiles.length > 0) {
            runGitOrThrow(planningRepo.repoRoot, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...planningForeignStagedFiles]);
        }
        const planningMessage = [
            planningRepo.commitMessage,
            '',
            `ATM-Actor: ${input.actorId}`,
            `ATM-Task: ${input.taskId}`,
            'ATM-Surface: taskflow-close-planning-bundle'
        ].join('\n');
        commitRepoWithTemporaryIndex({
            repoRoot: planningRepo.repoRoot,
            stageFiles: planningStageFiles,
            args: ['commit', '-m', planningMessage],
            actorId: input.actorId,
            taskId: input.taskId
        });
        if (planningForeignStagedFiles.length > 0) {
            runGitOrThrow(planningRepo.repoRoot, ['add', '-A', '-f', '--', ...planningForeignStagedFiles]);
        }
        planningRepo = {
            ...planningRepo,
            commitSha: tryGitScalar(planningRepo.repoRoot, ['rev-parse', '--verify', 'HEAD']),
            status: 'committed'
        };
    }
    catch (error) {
        planningRepo = {
            ...planningRepo,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error)
        };
        targetRepo = { ...targetRepo, status: 'committed' };
        return {
            ...input.bundle,
            targetRepo,
            planningRepo,
            failClosed: true,
            recoveryCommand: 'Planning repo commit failed after target repo governance commit succeeded. Inspect planning repo status and reconcile manually.'
        };
    }
    return {
        ...input.bundle,
        targetRepo,
        planningRepo,
        failClosed: false,
        recoveryCommand: null
    };
}
function commitRepoWithTemporaryIndex(input) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-taskflow-commit-index-'));
    const tempIndexFile = path.join(tempDir, 'index');
    // ATM-BUG-2026-07-07-046: resolve the same actor-scoped author/committer identity
    // `node atm.mjs git commit` would use, instead of silently falling back to
    // whatever host git config happens to be configured for this repo. Missing
    // identity is non-fatal here (unlike the `git commit` wrapper) so existing
    // closes for actors without a registered identity keep working unchanged.
    const identity = input.actorId ? resolveActorGitIdentityForCommit(input.repoRoot, input.actorId) : null;
    const env = {
        ...process.env,
        GIT_INDEX_FILE: tempIndexFile,
        ...(input.actorId ? { ATM_COMMIT_ACTOR_ID: input.actorId } : {}),
        ...(input.taskId ? { ATM_COMMIT_TASK_ID: input.taskId } : {}),
        ...(identity?.gitName ? { GIT_AUTHOR_NAME: identity.gitName, GIT_COMMITTER_NAME: identity.gitName } : {}),
        ...(identity?.gitEmail ? { GIT_AUTHOR_EMAIL: identity.gitEmail, GIT_COMMITTER_EMAIL: identity.gitEmail } : {})
    };
    try {
        // Build the commit from a clean HEAD-based temporary index so prior staged
        // residue in the live index cannot leak into a governed close bundle.
        runGitWithEnv(input.repoRoot, ['read-tree', 'HEAD'], env);
        if (input.stageFiles.length > 0) {
            runGitWithEnv(input.repoRoot, ['add', '-A', '-f', '--', ...input.stageFiles], env);
        }
        runGitWithEnv(input.repoRoot, input.args, env);
        if (input.stageFiles.length > 0) {
            // ATM-BUG-2026-07-07-049: the temp index never touches the live index, so
            // any pre-existing (possibly stale) live-index entries for these paths
            // would otherwise survive the commit as a phantom `git diff --cached`
            // residue. Reset just these paths in the live index to the newly
            // committed HEAD tree; unrelated staged files are left untouched.
            runGitOrThrow(input.repoRoot, ['reset', '--quiet', '--', ...input.stageFiles]);
        }
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
export async function commitTaskflowDeliveryFiles(input) {
    const repoRoot = input.bundle.targetRepo.repoRoot;
    const stageFiles = uniqueSorted(input.bundle.targetDeliveryFiles);
    if (!repoRoot || stageFiles.length === 0) {
        return null;
    }
    const deliveryBundle = {
        repoRoot,
        stageFiles,
        commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
        commitCommand: commitCommandFor({
            repoRoot,
            actorId: input.actorId,
            taskId: input.taskId,
            commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
            repoKind: 'target'
        }),
        commitSha: null,
        status: 'uncomputed'
    };
    const preflight = verifyRepoIndexIsolation(deliveryBundle, 'pre-stage');
    const staged = verifyRepoIndexIsolation(stageRepoBundle(preflight, input.taskId), 'post-stage');
    if (staged.status !== 'staged') {
        return null;
    }
    const targetResult = await runAtmGit([
        'commit',
        '--cwd', repoRoot,
        '--actor', input.actorId,
        '--task', input.taskId,
        '--message', deliveryBundle.commitMessage,
        ...(input.deferForeignStaged ? ['--defer-foreign-staged'] : []),
        '--json'
    ]);
    const commitSha = String(targetResult.evidence?.commitSha ?? '') || null;
    return {
        repoRoot,
        stageFiles: staged.stageFiles,
        commitMessage: deliveryBundle.commitMessage,
        commitSha,
        status: 'committed'
    };
}
export async function finalizeTaskflowCommitBundle(input) {
    assertCommitBundleReady(input.bundle);
    const strictIsolation = input.bundle.commitMode === 'stage-only';
    const sharedRepoMode = isSameRepoBundle(input.bundle);
    if (sharedRepoMode) {
        const repoRoot = input.bundle.targetRepo.repoRoot;
        const sharedRepo = buildSharedRepoBundle(repoRoot, [
            ...input.bundle.targetRepo.stageFiles,
            ...input.bundle.planningRepo.stageFiles
        ]);
        const preflightShared = verifyRepoIndexIsolation(sharedRepo, 'pre-stage', strictIsolation);
        if (input.bundle.commitMode === 'stage-only') {
            const stagedShared = verifyRepoIndexIsolation(stageRepoBundle(preflightShared, input.taskId), 'post-stage', true);
            return {
                ...input.bundle,
                targetRepo: {
                    ...input.bundle.targetRepo,
                    status: stagedShared.status,
                    indexIsolation: stagedShared.indexIsolation
                },
                planningRepo: {
                    ...input.bundle.planningRepo,
                    status: stagedShared.status,
                    indexIsolation: stagedShared.indexIsolation
                }
            };
        }
        const sharedStageFiles = existingBundleFiles(preflightShared);
        const preStagedFiles = readStagedFiles(repoRoot);
        const sharedExpected = new Set(sharedStageFiles);
        const foreignStagedFiles = preStagedFiles.filter((file) => !sharedExpected.has(file));
        if (foreignStagedFiles.length > 0) {
            runGitOrThrow(repoRoot, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...foreignStagedFiles]);
        }
        const sharedMessage = [
            input.bundle.targetRepo.commitMessage,
            '',
            `ATM-Actor: ${input.actorId}`,
            `ATM-Task: ${input.taskId}`,
            'ATM-Surface: taskflow-close-shared-repo-bundle',
            `ATM-Planning-Commit-Message: ${input.bundle.planningRepo.commitMessage}`
        ].join('\n');
        commitRepoWithTemporaryIndex({
            repoRoot,
            stageFiles: sharedStageFiles,
            args: ['commit', '-m', sharedMessage],
            actorId: input.actorId,
            taskId: input.taskId
        });
        const commitSha = tryGitScalar(repoRoot, ['rev-parse', '--verify', 'HEAD']);
        if (foreignStagedFiles.length > 0) {
            runGitOrThrow(repoRoot, ['add', '-A', '-f', '--', ...foreignStagedFiles]);
        }
        return {
            ...input.bundle,
            targetRepo: {
                ...input.bundle.targetRepo,
                commitSha,
                status: 'committed',
                indexIsolation: preflightShared.indexIsolation
            },
            planningRepo: {
                ...input.bundle.planningRepo,
                commitSha,
                status: 'committed',
                indexIsolation: preflightShared.indexIsolation
            },
            failClosed: false,
            recoveryCommand: null
        };
    }
    const preflightTarget = verifyRepoIndexIsolation(input.bundle.targetRepo, 'pre-stage', strictIsolation);
    const preflightPlanning = verifyRepoIndexIsolation(input.bundle.planningRepo, 'pre-stage', strictIsolation);
    if (input.bundle.commitMode === 'stage-only') {
        const stagedTarget = verifyRepoIndexIsolation(stageRepoBundle(preflightTarget, input.taskId), 'post-stage', true);
        const stagedPlanning = verifyRepoIndexIsolation(stageRepoBundle(preflightPlanning, input.taskId), 'post-stage', true);
        return {
            ...input.bundle,
            targetRepo: stagedTarget,
            planningRepo: stagedPlanning
        };
    }
    const bundle = {
        ...input.bundle,
        targetRepo: preflightTarget,
        planningRepo: preflightPlanning
    };
    return commitTaskflowBundle({
        bundle,
        actorId: input.actorId,
        taskId: input.taskId
    });
}
