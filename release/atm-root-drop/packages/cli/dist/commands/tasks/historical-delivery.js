import { execFileSync } from 'node:child_process';
import { isTaskCloseGovernanceCriticalPath } from '../framework-development.js';
import { isTaskDirectionPathCandidate } from '../task-direction.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
const EMPTY_HISTORICAL_DELIVERY_BUCKETS = {
    taskMatchedFiles: [],
    governanceFiles: [],
    allowedRunnerOutputFiles: [],
    outOfScopeSourceFiles: [],
    ignoredFiles: []
};
export function categorizeHistoricalCommitFiles(input) {
    const taskMatchedFiles = [];
    const governanceFiles = [];
    const allowedRunnerOutputFiles = [];
    const outOfScopeSourceFiles = [];
    const ignoredFiles = [];
    for (const filePath of input.changedFiles) {
        const normalized = normalizeRelativePath(filePath);
        if (!normalized)
            continue;
        if (normalized.startsWith('.atm/')) {
            if (isTaskCloseGovernanceCriticalPath(normalized, input.taskId)) {
                governanceFiles.push(normalized);
            }
            else {
                ignoredFiles.push(normalized);
            }
            continue;
        }
        const inScope = input.declaredFiles.some((declared) => pathMatchesTaskScope(normalized, declared));
        if (inScope && isRealDeliverablePath(normalized)) {
            taskMatchedFiles.push(normalized);
            continue;
        }
        if (isDeclaredRunnerOutputPath(normalized, input.declaredFiles)) {
            allowedRunnerOutputFiles.push(normalized);
            continue;
        }
        if (isRealDeliverablePath(normalized) || normalized.startsWith('release/')) {
            outOfScopeSourceFiles.push(normalized);
            continue;
        }
        ignoredFiles.push(normalized);
    }
    return {
        taskMatchedFiles: uniqueStrings(taskMatchedFiles),
        governanceFiles: uniqueStrings(governanceFiles),
        allowedRunnerOutputFiles: uniqueStrings(allowedRunnerOutputFiles),
        outOfScopeSourceFiles: uniqueStrings(outOfScopeSourceFiles),
        ignoredFiles: uniqueStrings(ignoredFiles)
    };
}
export function inspectHistoricalDelivery(input) {
    const requestedRef = input.requestedRef.trim();
    if (!requestedRef) {
        return {
            requestedRef,
            commitSha: null,
            ok: false,
            reason: 'empty-ref',
            changedFiles: [],
            deliverableFiles: [],
            fileBuckets: EMPTY_HISTORICAL_DELIVERY_BUCKETS,
            waiverApplied: false
        };
    }
    const commitSha = readGitScalar(input.cwd, ['rev-parse', '--verify', `${requestedRef}^{commit}`]);
    if (!commitSha) {
        return {
            requestedRef,
            commitSha: null,
            ok: false,
            reason: 'commit-not-found',
            changedFiles: [],
            deliverableFiles: [],
            fileBuckets: EMPTY_HISTORICAL_DELIVERY_BUCKETS,
            waiverApplied: false
        };
    }
    const changedFiles = readGitNameOnly(input.cwd, ['show', '--pretty=format:', '--name-only', commitSha, '--']);
    const fileBuckets = categorizeHistoricalCommitFiles({
        taskId: input.taskId,
        changedFiles,
        declaredFiles: input.declaredFiles
    });
    const deliverableFiles = input.enforceDeclaredScope
        ? uniqueStrings([
            ...fileBuckets.taskMatchedFiles,
            ...fileBuckets.allowedRunnerOutputFiles
        ])
        : changedFiles.filter((filePath) => isDeliverableGateCandidate(filePath, input.declaredFiles));
    const hasTaskDeliverable = fileBuckets.taskMatchedFiles.length > 0 || fileBuckets.allowedRunnerOutputFiles.length > 0;
    const hasOutOfScope = fileBuckets.outOfScopeSourceFiles.length > 0;
    const waiverReason = input.waiverReason?.trim() ?? '';
    let ok = hasTaskDeliverable;
    let reason = 'no-scoped-deliverable-files';
    let waiverApplied = false;
    if (!hasTaskDeliverable) {
        ok = false;
        reason = 'no-scoped-deliverable-files';
    }
    else if (hasOutOfScope && !input.waiverOutOfScopeDelivery) {
        ok = false;
        reason = 'out-of-scope-source-files-present';
    }
    else if (hasOutOfScope && input.waiverOutOfScopeDelivery && !waiverReason) {
        ok = false;
        reason = 'out-of-scope-waiver-reason-required';
    }
    else if (hasOutOfScope && input.waiverOutOfScopeDelivery) {
        ok = true;
        reason = 'scoped-deliverable-with-waived-out-of-scope';
        waiverApplied = true;
    }
    else {
        ok = true;
        reason = 'scoped-deliverable-files-present';
    }
    return {
        requestedRef,
        commitSha,
        ok,
        reason,
        changedFiles,
        deliverableFiles,
        fileBuckets,
        waiverApplied
    };
}
export function buildHistoricalDeliveryProvenance(report, waiverReason) {
    if (!report?.commitSha)
        return null;
    return {
        schemaId: 'atm.historicalDeliveryProvenance.v1',
        deliveryCommitSha: report.commitSha,
        taskMatchedFiles: [...report.fileBuckets.taskMatchedFiles],
        governanceFiles: [...report.fileBuckets.governanceFiles],
        allowedRunnerOutputFiles: [...report.fileBuckets.allowedRunnerOutputFiles],
        outOfScopeSourceFiles: [...report.fileBuckets.outOfScopeSourceFiles],
        waivedOutOfScopeFiles: report.waiverApplied ? [...report.fileBuckets.outOfScopeSourceFiles] : [],
        waiverReason: report.waiverApplied ? (waiverReason?.trim() || null) : null
    };
}
export function pathMatchesTaskScope(filePath, scope) {
    const file = normalizeRelativePath(filePath).toLowerCase();
    const candidate = normalizeRelativePath(scope).toLowerCase();
    if (!candidate)
        return false;
    if (candidate.includes('*')) {
        const escaped = candidate
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
            .replace(/\*/g, '[^/]*')
            .replace(/__ATM_DOUBLE_STAR__/g, '.*');
        return new RegExp(`^${escaped}$`).test(file);
    }
    if (file === candidate)
        return true;
    if (candidate.endsWith('/'))
        return file.startsWith(candidate);
    return file.startsWith(`${candidate}/`);
}
export function isDeliverableGateCandidate(filePath, declaredFiles) {
    return isRealDeliverablePath(filePath) || isDeclaredRunnerOutputPath(filePath, declaredFiles);
}
function isRealDeliverablePath(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized)
        return false;
    if (normalized.startsWith('.atm/'))
        return false;
    if (normalized.startsWith('.git/'))
        return false;
    if (/^(node_modules|dist|build|coverage|release|scratch|temp|tmp|\.atm-temp)\//.test(normalized))
        return false;
    return isTaskDirectionPathCandidate(normalized);
}
function isDeclaredRunnerOutputPath(filePath, declaredFiles) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized)
        return false;
    if (normalized.startsWith('.atm/') || normalized.startsWith('.git/'))
        return false;
    if (!normalized.startsWith('release/atm-onefile/') && !normalized.startsWith('release/atm-root-drop/'))
        return false;
    return declaredFiles.some((declared) => pathMatchesTaskScope(normalized, declared));
}
function readGitScalar(cwd, args) {
    try {
        return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null;
    }
    catch {
        return null;
    }
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
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
