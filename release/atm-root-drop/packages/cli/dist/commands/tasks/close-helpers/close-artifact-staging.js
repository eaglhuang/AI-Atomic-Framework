// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Close-artifact staging cluster: extract declared/deliverable files, evaluate
// the task deliverable gate, stage close artifacts through git, and expose the
// canonical delivery-principle text.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relativePathFrom } from '../../shared.js';
import { normalizeRelativePath } from '../task-file-io-helpers.js';
import { pathMatchesTaskScope, isDeliverableGateCandidate, inspectHistoricalDelivery } from '../historical-delivery.js';
import { sanitizeTaskDirectionAllowedFiles } from '../../task-direction.js';
import { isTaskCloseGovernanceCriticalPath } from '../../framework-development/critical-path-gate.js';
import { listCommittedFilesSinceClaim as delegatedListCommittedFilesSinceClaim } from '../task-git-helpers.js';
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
function extractStringList(value) {
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
        : [];
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
function readRuntimeTaskDirectionLock(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    if (!existsSync(lockPath))
        return {};
    try {
        const outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
        const embeddedLock = outerLock.taskDirectionLock;
        return embeddedLock && typeof embeddedLock === 'object' && !Array.isArray(embeddedLock)
            ? embeddedLock
            : {};
    }
    catch {
        return {};
    }
}
function extractTaskCloseClaimScopeFiles(taskDocument, cwd, taskId) {
    const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
        ? taskDocument.taskDirectionLock
        : {};
    const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : {};
    const runtimeLock = cwd && taskId ? readRuntimeTaskDirectionLock(cwd, taskId) : {};
    return uniqueStrings([
        ...extractStringList(taskDirectionLock.allowedFiles),
        ...extractStringList(runtimeLock.allowedFiles),
        ...extractStringList(claim.files)
    ]);
}
// Re-declared here (imported from task-import-validators would create surface churn).
function extractTaskDeclaredFilesLocal(taskDocument) {
    const scope = Array.isArray(taskDocument.scopePaths) ? taskDocument.scopePaths : [];
    const deliverables = Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : [];
    const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
        ? taskDocument.claim.files
        : undefined;
    const claimFiles = Array.isArray(claim) ? claim : [];
    const values = [...scope, ...deliverables, ...claimFiles]
        .map((entry) => typeof entry === 'string' ? entry.trim() : '')
        .filter(Boolean);
    return [...new Set(values)];
}
export function extractTaskCloseDeclaredFiles(taskDocument, cwd, taskId, options = {}) {
    const claimScopedFiles = extractTaskCloseClaimScopeFiles(taskDocument, cwd, taskId);
    if (options.checkpointScoped) {
        return claimScopedFiles;
    }
    return uniqueStrings([
        ...claimScopedFiles,
        ...extractStringList(taskDocument.targetAllowedFiles),
        ...extractTaskDeclaredFilesLocal(taskDocument)
    ]);
}
export function extractTaskDeliverableFiles(taskDocument) {
    return extractStringList(taskDocument.deliverables);
}
export function taskDeliveryPrincipleText() {
    return 'The goal is to deliver the requested task content, not to close task cards. done is only the record after real deliverables and validators exist.';
}
function isDeliverableDiffRequired(taskDocument) {
    const mode = String(taskDocument.deliverableMode ?? taskDocument.deliverable_mode ?? '').toLowerCase();
    if (mode === 'ledger-only')
        return false;
    const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
        ? taskDocument.source
        : {};
    const importedFromPlan = typeof source.planPath === 'string' && source.planPath.trim().length > 0;
    if (importedFromPlan)
        return true;
    const haystack = [
        taskDocument.title,
        taskDocument.type,
        taskDocument.kind,
        taskDocument.category,
        ...(Array.isArray(taskDocument.tags) ? taskDocument.tags : []),
        ...(Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : []),
        ...(Array.isArray(taskDocument.acceptance) ? taskDocument.acceptance : [])
    ].filter((entry) => typeof entry === 'string').join('\n').toLowerCase();
    return /\b(code|pipeline|data|runner|script|report|artifact|manifest|bundle|adapter|checker|builder|job|jsonl|python|typescript|reviewer)\b/.test(haystack)
        || /資料|管線|腳本|執行器|報告|產物|審核表|清單|候選|白名單|黑名單|人物|關係/.test(haystack);
}
function listChangedFilesForDeliverableGate(cwd, claim, taskId = null) {
    const files = new Set();
    let gitAvailable = false;
    let allowedSet = null;
    if (taskId) {
        const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
        if (existsSync(taskPath)) {
            try {
                const taskDoc = JSON.parse(readFileSync(taskPath, 'utf8'));
                const allowedFiles = extractTaskCloseDeclaredFiles(taskDoc);
                if (allowedFiles.length > 0) {
                    allowedSet = new Set(normalizeTaskScopePaths(cwd, allowedFiles));
                }
            }
            catch {
                // Ignore read/parse errors
            }
        }
    }
    for (const args of [
        ['-C', cwd, 'diff', '--name-only', '--cached'],
        ['-C', cwd, 'diff', '--name-only'],
        ['-C', cwd, 'ls-files', '-o', '--exclude-standard']
    ]) {
        try {
            const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            gitAvailable = true;
            const isUntrackedCmd = args.includes('ls-files');
            for (const line of output.split(/\r?\n/)) {
                const normalized = normalizeRelativePath(line);
                if (normalized) {
                    if (isUntrackedCmd && allowedSet) {
                        const isDeliverable = allowedSet.has(normalized)
                            || isTaskCloseGovernanceCriticalPath(normalized, taskId || '');
                        if (!isDeliverable) {
                            continue;
                        }
                    }
                    files.add(normalized);
                }
            }
        }
        catch {
            // Sandboxed or non-git hosts use a declared-file existence fallback.
        }
    }
    const committedSinceClaim = delegatedListCommittedFilesSinceClaim(cwd, claim);
    if (committedSinceClaim.gitAvailable)
        gitAvailable = true;
    for (const filePath of committedSinceClaim.files) {
        files.add(filePath);
    }
    return { files: [...files].sort((left, right) => left.localeCompare(right)), gitAvailable };
}
export function evaluateTaskDeliverableGate(input) {
    const required = isDeliverableDiffRequired(input.taskDocument);
    const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
    const changedFileReport = listChangedFilesForDeliverableGate(input.cwd, input.claim, input.taskId);
    const changedFiles = (changedFileReport.gitAvailable
        ? changedFileReport.files
        : uniqueStrings([
            ...changedFileReport.files,
            ...declaredFiles.filter((filePath) => existsSync(path.resolve(input.cwd, filePath)))
        ]));
    const deliverableFiles = changedFiles.filter((filePath) => isDeliverableGateCandidate(filePath, declaredFiles));
    const enforceDeclaredScope = declaredFiles.some((filePath) => !filePath.startsWith('.atm/') && filePath !== normalizeRelativePath(input.taskDocument.source?.planPath ?? ''));
    const scopedDeliverables = enforceDeclaredScope
        ? deliverableFiles.filter((filePath) => declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared)))
        : deliverableFiles;
    const historicalBatchCloseReady = input.historicalBatchCloseReadySlice ?? null;
    const historicalDeliveryRefs = historicalBatchCloseReady
        ? (input.historicalDeliveryRefs ?? []).filter((ref) => !historicalBatchCloseReady.matchedCommits.includes(ref))
        : (input.historicalDeliveryRefs ?? []);
    const historicalDeliveries = historicalDeliveryRefs.map((ref) => inspectHistoricalDelivery({
        cwd: input.historicalDeliveryRepo ?? input.cwd,
        taskId: input.taskId,
        requestedRef: ref,
        declaredFiles,
        enforceDeclaredScope,
        waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
        waiverReason: input.waiverReason ?? null
    }));
    const historicalDeliveryErrors = historicalDeliveries.filter((entry) => !entry.ok);
    const historicalDeliverableFiles = uniqueStrings([
        ...historicalDeliveries.flatMap((entry) => entry.deliverableFiles),
        ...(historicalBatchCloseReady?.matchedFiles ?? [])
    ]);
    const allDeliverableFiles = uniqueStrings([...scopedDeliverables, ...historicalDeliverableFiles]);
    const ok = !required || (allDeliverableFiles.length > 0 && historicalDeliveryErrors.length === 0);
    const reason = required
        ? ok
            ? scopedDeliverables.length > 0
                ? 'real-deliverable-diff-present'
                : 'historical-delivery-diff-present'
            : historicalDeliveryErrors.length > 0
                ? 'historical-delivery-invalid'
                : 'missing-real-deliverable-diff'
        : 'task-does-not-require-real-deliverable-diff';
    return {
        schemaId: 'atm.taskDeliverableGate.v1',
        generatedAt: new Date().toISOString(),
        taskId: input.taskId,
        deliveryPrinciple: taskDeliveryPrincipleText(),
        required,
        ok,
        reason,
        changedFiles,
        deliverableFiles: allDeliverableFiles,
        declaredFiles,
        historicalDeliveries,
        historicalBatchCloseReady,
        notAllowedAsCompletion: [
            'only changing .atm/history task JSON, evidence JSON, task-events, runtime locks, or queue state',
            'text-only evidence without a real deliverable file diff',
            'replaying old close commits or cherry-picking prior ledger-only closure without a scoped delivery commit',
            'closing a batch queue item before implementing the current task deliverables'
        ],
        remediation: ok
            ? 'Deliverable diff found; continue with validators and closure evidence.'
            : 'Implement the deliverables described by the task, stage or leave the real file changes visible, then rerun tasks close --status done. If the deliverable already landed in an earlier commit, pass --historical-delivery <commit> so ATM can verify the scoped non-.atm files. If the historical commit also contains unrelated source files, pass --waiver-out-of-scope-delivery with --reason. If the task is not delivered yet, close review instead of done.',
        requiredCommand: ok ? null : `node atm.mjs tasks close --task ${input.taskId} --actor <actor> --status review --reason "awaiting real deliverable diff" --json`
    };
}
export function stageTaskCloseArtifacts(cwd, files) {
    const normalizedFiles = uniqueStrings(files.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean));
    if (normalizedFiles.length === 0)
        return;
    execFileSync('git', ['add', '--', ...normalizedFiles], {
        cwd,
        stdio: ['ignore', 'ignore', 'pipe']
    });
}
export function existingTaskCloseArtifacts(cwd, files) {
    return uniqueStrings(files
        .map((entry) => typeof entry === 'string' ? entry.trim() : '')
        .filter((entry) => entry && existsSync(path.resolve(cwd, entry))));
}
