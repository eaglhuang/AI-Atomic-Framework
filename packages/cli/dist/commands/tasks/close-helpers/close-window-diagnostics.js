// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Close-window diagnostic helpers used by close-orchestrator.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliError, relativePathFrom } from '../../shared.js';
import { normalizeTaskId } from '../task-import-validators.js';
import { readCloseWindowStagedIndexLockReport } from '../close-window-lock.js';
import { normalizeRelativePath } from '../task-file-io-helpers.js';
import { pathMatchesTaskScope } from '../historical-delivery.js';
import { sanitizeTaskDirectionAllowedFiles } from '../../task-direction.js';
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const v of values) {
        if (v && !seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    }
    return out;
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
export function readDeferredForeignStagedFilesForActiveCloseWindow(cwd, taskId) {
    const lock = readCloseWindowStagedIndexLockReport(cwd);
    if (!lock || lock.status !== 'active')
        return [];
    if (lock.taskId !== normalizeTaskId(taskId))
        return [];
    if (!lock.foreignStagedSnapshotPath)
        return [];
    const snapshotPath = path.resolve(cwd, lock.foreignStagedSnapshotPath);
    if (!existsSync(snapshotPath))
        return [];
    try {
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        if (snapshot.schemaId !== 'atm.closeWindowForeignStagedSnapshot.v1')
            return [];
        const files = Array.isArray(snapshot.files) ? snapshot.files : [];
        return [...new Set(files
                .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
                .map((entry) => entry.replace(/\\/g, '/')))];
    }
    catch {
        return [];
    }
}
export function evaluateFrameworkDeliveryWindow(input) {
    const criticalChangedFiles = uniqueStrings(input.criticalChangedFiles.map(normalizeRelativePath).filter(Boolean));
    const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
    const scopedCriticalChangedFiles = criticalChangedFiles.filter((filePath) => declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared)));
    const unscopedCriticalChangedFiles = criticalChangedFiles.filter((filePath) => !scopedCriticalChangedFiles.includes(filePath));
    const checkpointCommand = input.batchId
        ? `node atm.mjs batch checkpoint --actor ${input.actorId} --batch ${input.batchId} --json`
        : `node atm.mjs batch checkpoint --actor ${input.actorId} --json`;
    const historicalCommand = input.batchId
        ? `node atm.mjs batch checkpoint --actor ${input.actorId} --batch ${input.batchId} --delivery-commit <commit> --json`
        : `node atm.mjs batch checkpoint --actor ${input.actorId} --delivery-commit <commit> --json`;
    const normalHistoricalCloseCommand = `node atm.mjs tasks close --task ${input.taskId} --actor ${input.actorId} --status done --historical-delivery <deliveryCommit> --json`;
    const normalDeliveryCommitCommand = `node atm.mjs git commit --actor ${input.actorId} --task ${input.taskId} --message "<delivery message>" --json`;
    // TASK-AAO-0057: scoped diff isolation — unrelated (unscoped) critical changes
    // are advisory and no longer block the governed window; the window is governed
    // by either --from-batch-checkpoint or --historical-delivery covering the
    // scoped diff. Out-of-scope dirty files are surfaced separately as advisory
    // isolation diagnostics by the caller.
    const hasHistoricalDelivery = input.historicalDeliveryRefs.length > 0;
    const hasGovernedDeliveryFlag = input.fromBatchCheckpoint || hasHistoricalDelivery;
    const ok = input.historicalBatchCloseReady === true
        ? hasHistoricalDelivery
        : input.fromBatchCheckpoint
            ? hasGovernedDeliveryFlag && scopedCriticalChangedFiles.length > 0
            : hasHistoricalDelivery;
    return {
        schemaId: 'atm.frameworkDeliveryWindow.v1',
        taskId: input.taskId,
        batchId: input.batchId,
        ok,
        reason: ok
            ? input.historicalBatchCloseReady === true
                ? 'historical-batch-close-ready'
                : input.fromBatchCheckpoint
                    ? 'batch-checkpoint-scoped-framework-critical-diff'
                    : 'historical-delivery-scoped-framework-critical-diff'
            : !hasGovernedDeliveryFlag
                ? 'not-from-batch-checkpoint'
                : input.fromBatchCheckpoint
                    ? 'no-active-framework-critical-diff'
                    : 'historical-delivery-gate',
        criticalChangedFiles,
        scopedCriticalChangedFiles,
        unscopedCriticalChangedFiles,
        declaredFiles,
        historicalDeliveryRefs: input.historicalDeliveryRefs,
        allowedBlockers: input.historicalBatchCloseReady === true
            ? ['active-framework-claim-required', 'git-head-evidence-missing', 'framework-stale-lock-cleanup-required']
            : ['active-framework-claim-required', 'git-head-evidence-missing'],
        requiredCommand: input.fromBatchCheckpoint ? checkpointCommand : normalDeliveryCommitCommand,
        remediation: ok
            ? 'Batch checkpoint is the governed delivery window; commit the scoped deliverables, evidence, task file, and task events together after checkpoint succeeds.'
            : input.fromBatchCheckpoint
                ? `Remove unrelated framework critical diffs or add the real deliverable paths to the task scope before rerunning ${checkpointCommand}. If the scoped delivery already landed, use ${historicalCommand}.`
                : `Normal framework critical tasks close in two phases: first create a governed delivery commit with ${normalDeliveryCommitCommand}; then close with ${normalHistoricalCloseCommand}. Batch checkpoint commands are only for --from-batch-checkpoint closures.`
    };
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
export function loadHistoricalBatchCloseSlice(cwd, taskId, batchRef) {
    const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
    if (!batchPath || !existsSync(batchPath)) {
        throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_FOUND', `Historical batch evidence not found for ${batchRef}.`, {
            exitCode: 1,
            details: { taskId, batchRef, batchPath: batchPath ? relativePathFrom(cwd, batchPath) : null }
        });
    }
    const envelope = JSON.parse(readFileSync(batchPath, 'utf8'));
    const tasks = Array.isArray(envelope.tasks) ? envelope.tasks : [];
    const rawSlice = tasks.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && String(entry.taskId ?? '') === taskId);
    if (!rawSlice) {
        throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_TASK_NOT_FOUND', `Historical batch ${batchRef} does not contain task ${taskId}.`, {
            exitCode: 1,
            details: { taskId, batchRef, batchPath: relativePathFrom(cwd, batchPath) }
        });
    }
    const validatorClaims = Array.isArray(rawSlice.validatorClaims)
        ? rawSlice.validatorClaims.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        : [];
    const validationPassesByKind = (kind) => validatorClaims
        .filter((entry) => entry.kind === kind && entry.satisfied === true)
        .map((entry) => typeof entry.gate === 'string' ? entry.gate.trim() : '')
        .filter(Boolean);
    return {
        batchId: typeof envelope.batchId === 'string' ? envelope.batchId : path.basename(batchPath, '.json'),
        batchPath: relativePathFrom(cwd, batchPath),
        ok: rawSlice.ok === true,
        matchedCommits: Array.isArray(rawSlice.matchedCommits) ? rawSlice.matchedCommits.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : [],
        matchedFiles: Array.isArray(rawSlice.matchedFiles) ? rawSlice.matchedFiles.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : [],
        coverageStatus: rawSlice.coverageStatus === 'complete' || rawSlice.coverageStatus === 'partial' || rawSlice.coverageStatus === 'blocked'
            ? rawSlice.coverageStatus
            : 'blocked',
        okToRecordEvidence: rawSlice.okToRecordEvidence === true,
        okToCloseTask: rawSlice.okToCloseTask === true,
        diagnosticOnly: rawSlice.diagnosticOnly === true,
        missingCoverage: Array.isArray(rawSlice.missingCoverage) ? rawSlice.missingCoverage.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) : [],
        taskSpecificValidationPasses: Array.isArray(rawSlice.taskSpecificValidationPasses)
            ? rawSlice.taskSpecificValidationPasses.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            : validationPassesByKind('taskSpecific'),
        batchWideValidationPasses: Array.isArray(rawSlice.batchWideValidationPasses)
            ? rawSlice.batchWideValidationPasses.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            : validationPassesByKind('batchWide'),
        advisoryValidationPasses: Array.isArray(rawSlice.advisoryValidationPasses)
            ? rawSlice.advisoryValidationPasses.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            : validationPassesByKind('advisory')
    };
}
