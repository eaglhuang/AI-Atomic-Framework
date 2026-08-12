// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { looksLikeTaskArtifact } from '../match-and-sort.js';
import { parseJsonText, quoteCliValue } from '../../shared.js';
import { buildAllowedFilesForTask, readActiveTaskDirectionLocks } from '../../task-direction.js';
import { readFrameworkTempLockProjection } from '../../framework-development/framework-temp-lock-projection.js';
import { isRunnerBuildOutputPath } from '../../../../../core/dist/broker/runner-build-output-inventory.js';
import { classifyForeignGeneratedResidue } from '../../../../../core/dist/broker/foreign-generated-residue-disposition.js';
import { isPathAllowedByScope } from '../../work-channels.js';
import { normalizeOptionalTaskPath } from '../intent-normalizers.js';
import { uniqueSorted } from '../view-projections.js';
import { extractPathLikeStringsFromText } from './artifact-scope.js';
/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
export function checkPendingTaskArtifactScopeExpansion(input) {
    const allowedFiles = buildAllowedFilesForTask(input.task);
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(input.cwd);
    const foreignDirectionLocks = readActiveTaskDirectionLocks(input.cwd)
        .filter((lock) => lock.taskId !== input.task.workItemId);
    const foreignFrameworkLocks = readFrameworkTempLockProjection(input.cwd)
        .filter((lock) => lock.workItemId !== input.task.workItemId);
    const liveFrameworkLocks = foreignFrameworkLocks.filter((lock) => lock.disposition === 'foreign-live');
    const staleFrameworkLocks = foreignFrameworkLocks.filter((lock) => lock.disposition === 'stale-recovery-input');
    const outsideScope = (entry) => !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);
    const deferredForeignResidue = stagedOrTracked.flatMap((entry) => deferredGeneratedResidue(input.cwd, input.task.workItemId, entry));
    const deferredPaths = new Set(deferredForeignResidue.map((entry) => entry.path));
    const isAdvisoryOutsideScopePath = (entry) => deferredPaths.has(entry)
        || isAdvisoryPendingTaskArtifactPath(entry)
        || foreignDirectionLocks.some((lock) => isPathAllowedByScope(entry, lock.allowedFiles))
        || liveFrameworkLocks.some((lock) => isPathAllowedByScope(entry, lock.files));
    const isStaleRecoveryInputPath = (entry) => staleFrameworkLocks.some((lock) => isPathAllowedByScope(entry, lock.files));
    const advisoryTrackedFiles = stagedOrTracked
        .filter(outsideScope)
        .filter(isAdvisoryOutsideScopePath);
    const staleRecoveryInputFiles = stagedOrTracked
        .filter(outsideScope)
        .filter(isStaleRecoveryInputPath);
    const trackedForeignWip = stagedOrTracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry) && !isStaleRecoveryInputPath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    const untrackedExpansion = untracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    return {
        schemaId: 'atm.taskArtifactScopeDiagnostic.v1',
        ignoredUntrackedFiles: untrackedExpansion,
        advisoryTrackedFiles: uniqueSorted([...advisoryTrackedFiles, ...trackedForeignWip]),
        staleRecoveryInputFiles,
        deferredForeignResidue
    };
}
function deferredGeneratedResidue(cwd, candidateTaskId, entry) {
    const normalized = normalizeOptionalTaskPath(entry)?.replace(/\\/g, '/') ?? '';
    if (!normalized.startsWith('artifacts/generated/'))
        return [];
    const absolute = path.join(cwd, normalized);
    if (!existsSync(absolute))
        return [];
    const content = readFileSync(absolute, 'utf8');
    const producerTaskId = readGeneratedArtifactProducerTaskId(content);
    const disposition = classifyForeignGeneratedResidue({
        path: normalized,
        content,
        candidateTaskId,
        producerDeclaresPath: producerTaskId ? producerDeclaresArtifactPath(cwd, producerTaskId, normalized) : false,
        runnerInventoryMember: isRunnerBuildOutputPath(normalized)
    });
    return disposition.state === 'deferred' && disposition.provenance ? [disposition.provenance] : [];
}
function readGeneratedArtifactProducerTaskId(content) {
    try {
        const value = JSON.parse(content);
        return typeof value.taskId === 'string' && value.taskId.trim() ? value.taskId.trim() : null;
    }
    catch {
        return null;
    }
}
function producerDeclaresArtifactPath(cwd, taskId, artifactPath) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return false;
    try {
        const task = parseJsonText(readFileSync(taskPath, 'utf8'));
        const values = [...(Array.isArray(task.scopePaths) ? task.scopePaths : []), ...(Array.isArray(task.deliverables) ? task.deliverables : [])];
        return values.some((value) => String(value).replace(/\\/g, '/') === artifactPath);
    }
    catch {
        return false;
    }
}
function isAdvisoryPendingTaskArtifactPath(filePath) {
    const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
    if (!normalized)
        return false;
    return normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json'
        || isRunnerBuildOutputPath(normalized);
}
function listPendingGitFilesByKind(cwd) {
    const collect = (args) => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (result.status !== 0)
            return [];
        return result.stdout
            .split(/\r?\n/)
            .map((entry) => normalizeOptionalTaskPath(entry))
            .filter((entry) => Boolean(entry));
    };
    const staged = [
        ...collect(['diff', '--name-only', '--cached']),
        ...collect(['diff', '--name-only'])
    ];
    const untracked = collect(['ls-files', '--others', '--exclude-standard']);
    return {
        stagedOrTracked: uniqueSorted(staged),
        untracked: uniqueSorted(untracked)
    };
}
function listPendingGitFiles(cwd) {
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
    return uniqueSorted([...stagedOrTracked, ...untracked]);
}
function listIgnoredArtifactCandidates(cwd) {
    const artifactRoots = ['artifacts', 'reports', 'atomic_workbench/evidence', 'atomic_workbench/reports'];
    const result = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...artifactRoots], {
        cwd,
        encoding: 'utf8'
    });
    if (result.status !== 0)
        return [];
    return uniqueSorted(result.stdout
        .split(/\r?\n/)
        .map((entry) => normalizeOptionalTaskPath(entry))
        .filter((entry) => Boolean(entry)));
}
function isPromptGeneratedArtifactPath(filePath) {
    const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
    if (!normalized)
        return false;
    return normalized.startsWith('artifacts/')
        || normalized.startsWith('reports/')
        || normalized.startsWith('atomic_workbench/evidence/')
        || normalized.startsWith('atomic_workbench/reports/');
}
function buildPromptWorktreeHint(cwd, prompt) {
    const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
    const ignoredArtifacts = listIgnoredArtifactCandidates(cwd);
    const promptPathHints = extractPathLikeStringsFromText(prompt);
    const promptMatchedFiles = new Set();
    const atmManagedFiles = new Set();
    const generatedArtifactFiles = new Set();
    const releaseMirrorFiles = new Set();
    const unrelatedTrackedFiles = new Set();
    const unrelatedUntrackedFiles = new Set();
    const matchesPromptHint = (filePath) => promptPathHints.some((hint) => filePath === hint
        || filePath.startsWith(`${hint}/`)
        || hint.startsWith(`${filePath}/`));
    const classify = (filePath, tracked) => {
        if (matchesPromptHint(filePath)) {
            promptMatchedFiles.add(filePath);
            return;
        }
        if (filePath.startsWith('.atm/')) {
            atmManagedFiles.add(filePath);
            return;
        }
        if (filePath.startsWith('release/')) {
            releaseMirrorFiles.add(filePath);
            return;
        }
        if (isPromptGeneratedArtifactPath(filePath)) {
            generatedArtifactFiles.add(filePath);
            return;
        }
        (tracked ? unrelatedTrackedFiles : unrelatedUntrackedFiles).add(filePath);
    };
    stagedOrTracked.forEach((filePath) => classify(filePath, true));
    untracked.forEach((filePath) => classify(filePath, false));
    return {
        schemaId: 'atm.promptWorktreeHint.v1',
        promptPathHints,
        promptMatchedFiles: uniqueSorted([...promptMatchedFiles]),
        atmManagedFiles: uniqueSorted([...atmManagedFiles]),
        generatedArtifactFiles: uniqueSorted([...generatedArtifactFiles]),
        releaseMirrorFiles: uniqueSorted([...releaseMirrorFiles]),
        unrelatedTrackedFiles: uniqueSorted([...unrelatedTrackedFiles]),
        unrelatedUntrackedFiles: uniqueSorted([...unrelatedUntrackedFiles]),
        ignoredArtifactCount: ignoredArtifacts.length,
        note: 'No task scope is active yet. Prompt-matched files are only hints; every other dirty bucket stays advisory until ATM selects a governed route or task.'
    };
}
function buildIgnoredArtifactForceAddHints(cwd) {
    return listIgnoredArtifactCandidates(cwd).map((filePath) => ({
        path: filePath,
        requiredCommand: `git add -f -- ${quoteCliValue(filePath)}`,
        reason: 'This path is currently hidden by .gitignore; use force-add only if it is the intended deliverable for the selected route.'
    }));
}
export function buildNonPlaybookRouteHints(cwd, prompt, options = {}) {
    const includeWorktreeDetails = options.includeWorktreeDetails !== false;
    return {
        playbookState: 'absent',
        structuredOutputHint: {
            schemaId: 'atm.nextStructuredOutputHint.v1',
            hasPlaybook: false,
            treatCliJsonAs: 'structured-tool-guidance',
            followNextActionField: 'evidence.nextAction.command'
        },
        ignoredArtifactForceAddHints: includeWorktreeDetails ? buildIgnoredArtifactForceAddHints(cwd) : [],
        promptWorktreeHint: includeWorktreeDetails
            ? buildPromptWorktreeHint(cwd, prompt)
            : {
                schemaId: 'atm.promptWorktreeHint.v1',
                status: 'deferred',
                promptPathHints: extractPathLikeStringsFromText(prompt),
                promptMatchedFiles: [],
                atmManagedFiles: [],
                generatedArtifactFiles: [],
                releaseMirrorFiles: [],
                unrelatedTrackedFiles: [],
                unrelatedUntrackedFiles: [],
                ignoredArtifactCount: 0,
                note: 'Unscoped guidance defers live-worktree enumeration; task-scoped next performs exact admission when work is selected.',
                diagnosticCommand: 'node atm.mjs next --prompt "<task-or-path-scoped prompt>" --json'
            }
    };
}
