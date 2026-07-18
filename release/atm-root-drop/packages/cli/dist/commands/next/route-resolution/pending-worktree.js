import { spawnSync } from 'node:child_process';
import { looksLikeTaskArtifact } from '../match-and-sort.js';
import { CliError, quoteCliValue } from '../../shared.js';
import { buildAllowedFilesForTask, readActiveTaskDirectionLocks } from '../../task-direction.js';
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
    const outsideScope = (entry) => !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);
    const isAdvisoryOutsideScopePath = (entry) => isAdvisoryPendingTaskArtifactPath(entry)
        || foreignDirectionLocks.some((lock) => isPathAllowedByScope(entry, lock.allowedFiles));
    const advisoryTrackedFiles = stagedOrTracked
        .filter(outsideScope)
        .filter(isAdvisoryOutsideScopePath);
    const stagedExpansion = stagedOrTracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    const untrackedExpansion = untracked
        .filter(outsideScope)
        .filter((entry) => !isAdvisoryOutsideScopePath(entry))
        .filter((entry) => looksLikeTaskArtifact(entry, input.task));
    if (stagedExpansion.length > 0) {
        throw new CliError('ATM_TASK_SCOPE_EXPANSION_REQUIRED', `Task ${input.task.workItemId} has staged or modified deliverable-like files outside targetWork.allowedFiles; update the task scope/deliverables instead of editing runtime locks.`, {
            exitCode: 1,
            details: {
                taskId: input.task.workItemId,
                outsideAllowedFiles: stagedExpansion,
                advisoryTrackedFiles,
                ignoredUntrackedFiles: untrackedExpansion,
                allowedFiles,
                requiredAction: 'Add these real deliverables to the task card frontmatter scope/deliverables (then re-import) or run `node atm.mjs tasks scope --add <paths>`; do not edit runtime locks.',
                notAllowed: 'Do not edit .atm/runtime/locks/** or task direction lock JSON to bypass this scope mismatch.'
            }
        });
    }
    return {
        schemaId: 'atm.taskArtifactScopeDiagnostic.v1',
        ignoredUntrackedFiles: untrackedExpansion,
        advisoryTrackedFiles
    };
}
function isAdvisoryPendingTaskArtifactPath(filePath) {
    const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
    if (!normalized)
        return false;
    return normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json'
        || normalized.startsWith('release/atm-root-drop/')
        || normalized.startsWith('release/atm-onefile/');
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
export function buildNonPlaybookRouteHints(cwd, prompt) {
    return {
        playbookState: 'absent',
        structuredOutputHint: {
            schemaId: 'atm.nextStructuredOutputHint.v1',
            hasPlaybook: false,
            treatCliJsonAs: 'structured-tool-guidance',
            followNextActionField: 'evidence.nextAction.command'
        },
        ignoredArtifactForceAddHints: buildIgnoredArtifactForceAddHints(cwd),
        promptWorktreeHint: buildPromptWorktreeHint(cwd, prompt)
    };
}
