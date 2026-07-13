import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { relativePathFrom } from '../shared.js';
import { sanitizeTaskDirectionAllowedFiles } from '../task-direction.js';
import { extractTaskCloseDeclaredFiles } from './close-helpers/close-artifact-staging.js';
import { detectHistoricalDeliveryCommit, pathMatchesTaskScope } from './historical-delivery.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
export function resolveTaskClaimIntent(input) {
    const declaredFiles = normalizeTaskScopePaths(input.cwd, extractTaskCloseDeclaredFiles(input.taskDocument, input.cwd, input.taskId));
    const source = input.taskDocument.source && typeof input.taskDocument.source === 'object' && !Array.isArray(input.taskDocument.source)
        ? input.taskDocument.source
        : {};
    const planPath = typeof source.planPath === 'string' ? normalizeRelativePath(source.planPath) : '';
    const inScopeSourceFiles = declaredFiles.filter((filePath) => !filePath.startsWith('.atm/') && filePath !== planPath);
    const dirtyFiles = uniqueStrings([
        ...readGitNameOnly(input.cwd, ['diff', '--name-only', '--cached']),
        ...readGitNameOnly(input.cwd, ['diff', '--name-only']),
        ...readGitNameOnly(input.cwd, ['ls-files', '-o', '--exclude-standard'])
    ]).filter((filePath) => inScopeSourceFiles.some((declared) => pathMatchesTaskScope(filePath, declared)));
    const declaredDeliverableFiles = extractStringList(input.taskDocument.deliverables)
        .map(normalizeRelativePath)
        .filter((filePath) => Boolean(filePath) && !filePath.startsWith('.atm/'));
    const deliverablesTrackedInHead = declaredDeliverableFiles.filter((filePath) => isTaskClaimDeliverableTrackedInHead(input.cwd, filePath));
    const missingDeliverables = declaredDeliverableFiles.filter((filePath) => !deliverablesTrackedInHead.includes(filePath));
    const deliveryEvidence = declaredDeliverableFiles.length > 0
        ? detectHistoricalDeliveryCommit({
            cwd: input.cwd,
            taskId: input.taskId,
            declaredFiles: declaredDeliverableFiles,
            planningRepoRoot: input.cwd,
            planningRelativePath: planPath || null
        })
        : { ref: null, commitSha: null, source: null };
    const hasScopedDeliveryEvidence = Boolean(deliveryEvidence.commitSha);
    if (!input.autoIntent) {
        return {
            requestedClaimIntent: input.requestedClaimIntent,
            resolvedClaimIntent: input.requestedClaimIntent,
            autoIntent: false,
            explicitClaimIntent: input.explicitClaimIntent,
            reason: input.explicitClaimIntent ? 'explicit-claim-intent' : 'default-write-claim-intent',
            dirtyInScopeFiles: dirtyFiles,
            declaredDeliverableFiles,
            deliverablesTrackedInHead,
            missingDeliverables
        };
    }
    const resolvedClaimIntent = dirtyFiles.length > 0
        ? 'write'
        : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0 && hasScopedDeliveryEvidence
            ? 'closeout-only'
            : 'write';
    return {
        requestedClaimIntent: input.requestedClaimIntent,
        resolvedClaimIntent,
        autoIntent: true,
        explicitClaimIntent: false,
        reason: dirtyFiles.length > 0
            ? deliverablesTrackedInHead.length > 0
                ? 'dirty-in-scope-source-overrides-closeout'
                : 'dirty-in-scope-source'
            : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0 && hasScopedDeliveryEvidence
                ? 'deliverables-already-in-head'
                : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0
                    ? 'delivery-evidence-not-found'
                    : 'deliverables-not-yet-landed',
        dirtyInScopeFiles: dirtyFiles,
        declaredDeliverableFiles,
        deliverablesTrackedInHead,
        missingDeliverables
    };
}
function isTaskClaimDeliverableTrackedInHead(cwd, filePath) {
    if (!filePath || /[*?[\]{}]/.test(filePath))
        return false;
    try {
        execFileSync('git', ['-C', cwd, 'cat-file', '-e', `HEAD:${filePath}`], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
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
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
function readGitNameOnly(cwd, args) {
    try {
        const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
    }
    catch {
        return [];
    }
}
