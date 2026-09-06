import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hasReconciliationEntitlement } from '../../_vendor/core/dist/broker/terminal-history-entitlement.js';
export const ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE = 'ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE';
function normalizeRelativePath(filePath) {
    return filePath.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}
export function classifyProtectedGovernanceStatePath(filePath) {
    const normalized = normalizeRelativePath(filePath);
    let match = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
    if (match)
        return { pathClass: 'task-ledger', ownerTaskId: match[1]?.toUpperCase() ?? null };
    match = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
    if (match)
        return { pathClass: 'task-event', ownerTaskId: match[1]?.toUpperCase() ?? null };
    match = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:[.-][^/]*)?\.json$/i);
    if (match)
        return { pathClass: 'task-evidence', ownerTaskId: match[1]?.toUpperCase() ?? null };
    return null;
}
function listDiffNames(cwd, args, env) {
    try {
        return execFileSync('git', [...args, '-z'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env
        }).split('\0').map(normalizeRelativePath).filter(Boolean);
    }
    catch {
        return [];
    }
}
export function inspectProtectedGovernanceStateDestructiveChanges(input) {
    const commitFileSet = input.commitFiles
        ? new Set(input.commitFiles.map(normalizeRelativePath))
        : null;
    const authorizedGeneratedResidueDeletions = new Set((input.authorizedGeneratedResidueDeletions ?? []).map(normalizeRelativePath));
    const deleted = new Set([
        ...listDiffNames(input.cwd, ['diff', '--cached', '--name-only', '--diff-filter=D'], input.env),
        ...listDiffNames(input.cwd, ['diff', '--name-only', '--diff-filter=D'], input.env)
    ]);
    const violations = [];
    for (const filePath of [...deleted].sort()) {
        if (commitFileSet && !commitFileSet.has(normalizeRelativePath(filePath)))
            continue;
        const classification = classifyProtectedGovernanceStatePath(filePath);
        if (!classification)
            continue;
        if (authorizedGeneratedResidueDeletions.has(normalizeRelativePath(filePath)) ||
            isEntitledGeneratedResidueDeletion(input.cwd, input.taskId, filePath))
            continue;
        violations.push({
            path: filePath,
            pathClass: classification.pathClass,
            ownerTaskId: classification.ownerTaskId,
            operation: 'delete',
            recovery: `Restore the protected governance state path, then use the ATM lifecycle or reconcile command for ${classification.ownerTaskId ?? input.taskId}.`
        });
    }
    return {
        schemaId: 'atm.protectedGovernanceStateReport.v1',
        ok: violations.length === 0,
        code: violations.length > 0 ? ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE : null,
        summary: violations.length > 0
            ? `Protected governance state destructive write detected: ${violations.map((entry) => `${entry.pathClass}:${entry.path}`).join(', ')}.`
            : null,
        violations
    };
}
/**
 * Generated bundle-manifests are disposable close byproducts. A live writer
 * admitted for that exact history path may converge the deletion; every other
 * protected history deletion stays fail-closed.
 */
function isEntitledGeneratedResidueDeletion(cwd, writerWorkItemId, filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!/^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/i.test(normalized))
        return false;
    const isLiveTask = (taskId) => isLiveLedgerTask(cwd, taskId);
    return listEntitlementWriterIds(cwd, writerWorkItemId).some((candidateId) => hasReconciliationEntitlement(cwd, {
        writerWorkItemId: candidateId,
        candidateFile: normalized,
        isLiveTask
    }));
}
/**
 * A live successor card may hold the residue in its own lock, or a linked
 * framework-temp claim may be the admitted writer. Entitlement still comes
 * from that writer's lock; this only enumerates who to ask.
 */
function listEntitlementWriterIds(cwd, writerWorkItemId) {
    const ids = [writerWorkItemId];
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot))
        return ids;
    for (const name of readdirSync(lockRoot)) {
        if (!/^ATM-FRAMEWORK-TEMP-.*\.lock\.json$/i.test(name))
            continue;
        try {
            const lock = JSON.parse(readFileSync(path.join(lockRoot, name), 'utf8'));
            if (lock.released === true || lock.status === 'released')
                continue;
            const linked = typeof lock.linkedTaskId === 'string' ? lock.linkedTaskId.trim() : '';
            if (linked !== writerWorkItemId)
                continue;
            const workItemId = typeof lock.workItemId === 'string' && lock.workItemId.trim()
                ? lock.workItemId.trim()
                : name.replace(/\.lock\.json$/i, '');
            if (workItemId && !ids.includes(workItemId))
                ids.push(workItemId);
        }
        catch {
            continue;
        }
    }
    return ids;
}
function isLiveLedgerTask(cwd, taskId) {
    const ledgerPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(ledgerPath))
        return false;
    try {
        const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
        const status = typeof ledger.status === 'string' ? ledger.status.trim().toLowerCase() : '';
        if (status === 'done' || status === 'abandoned' || status === 'blocked')
            return false;
        const claim = ledger.claim && typeof ledger.claim === 'object' && !Array.isArray(ledger.claim)
            ? ledger.claim
            : null;
        const claimState = typeof claim?.state === 'string' ? claim.state.trim().toLowerCase() : '';
        return status === 'running' || status === 'open' || claimState === 'active' || claimState === 'handoff';
    }
    catch {
        return false;
    }
}
