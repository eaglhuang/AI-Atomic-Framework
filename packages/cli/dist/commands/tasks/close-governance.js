/**
 * TASK-RFT-0010 — tasks.close.governance atom.
 *
 * Policy Object for `tasks close` admission. Owns:
 *   - close-authority predicate (who can close which task)
 *   - closure-packet trust verdict (is the packet recoverable?)
 *   - blocker-code classification (which code class is the blocker?)
 *   - stale-runner override audit recording
 *   - failed-emergency-use audit recording
 *
 * Behaviour is preserved verbatim — `recordStaleRunnerOverride` and
 * `recordFailedEmergencyUseAttempt` are lifted from the inline body of
 * `packages/cli/src/commands/tasks.ts` with no logic changes. The blocker-code
 * classifier codifies the implicit taxonomy already used by inline `throw new
 * CliError(...)` sites; it does not alter the codes that fly out, only adds a
 * single named choke point so close-time policy can fan out cleanly.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from '../shared.js';
import { appendTaskTransitionEvent } from '../task-ledger.js';
import { emergencyRoot, readEmergencyLease } from '../emergency/leases.js';
import { recordFailedProtectedOverrideAttempt } from '../emergency/protected-override-audit.js';
import { readJsonRecord, taskPathFor } from './task-file-io-helpers.js';
const CLOSE_BLOCKER_CODE_TABLE = [
    { match: (c) => c === 'ATM_CLI_USAGE', blockerClass: 'usage', recoverable: false },
    { match: (c) => c === 'ATM_ACTOR_ID_MISSING', blockerClass: 'identity', recoverable: false },
    { match: (c) => c === 'ATM_TASK_CLOSE_OWNER_MISMATCH', blockerClass: 'authority', recoverable: false },
    { match: (c) => c === 'ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY', blockerClass: 'historical-delivery', recoverable: false },
    { match: (c) => c === 'ATM_TASK_NOT_FOUND', blockerClass: 'lifecycle', recoverable: false },
    { match: (c) => c === 'ATM_TASK_ABANDON_REASON_REQUIRED', blockerClass: 'lifecycle', recoverable: false },
    { match: (c) => c === 'ATM_BATCH_CHECKPOINT_REQUIRED', blockerClass: 'historical-delivery', recoverable: false },
    { match: (c) => c.startsWith('ATM_TASK_CLOSURE_PACKET'), blockerClass: 'closure-packet', recoverable: true },
    { match: (c) => c.startsWith('ATM_TASK_DELIVERABLE_GATE') || c === 'ATM_TASK_CLOSE_DELIVERABLE_GATE_FAILED', blockerClass: 'deliverable-gate', recoverable: false },
    { match: (c) => c.startsWith('ATM_TASK_DEPENDENCY'), blockerClass: 'dependency-gate', recoverable: false },
    { match: (c) => c.startsWith('ATM_TASK_SCOPE_LOCK') || c === 'ATM_TASK_CLOSE_SCOPE_LOCK_VIOLATION', blockerClass: 'scope-lock', recoverable: false },
    { match: (c) => c.startsWith('ATM_TASK_RUNNER_STALE') || c === 'ATM_TASK_CLOSE_RUNNER_STALE', blockerClass: 'runner-stale', recoverable: true },
    { match: (c) => c.startsWith('ATM_EMERGENCY_'), blockerClass: 'emergency-protected', recoverable: false }
];
/**
 * Classify a CliError.code emitted from the close path into a blocker family
 * + recoverability verdict. Unknown codes fall through to `unknown / false`.
 */
export function classifyTaskCloseBlockerCode(cliErrorCode) {
    for (const row of CLOSE_BLOCKER_CODE_TABLE) {
        if (row.match(cliErrorCode)) {
            return {
                cliErrorCode,
                blockerClass: row.blockerClass,
                recoverable: row.recoverable
            };
        }
    }
    return { cliErrorCode, blockerClass: 'unknown', recoverable: false };
}
/**
 * Compute close authority. The operator is allowed to close when their actorId
 * matches the current claim owner (or when no owner is recorded yet). Caller
 * is responsible for throwing the appropriate CliError when `allowed === false`.
 */
export function computeTaskCloseAuthority(input) {
    if (!input.actorId) {
        return { allowed: false, reason: 'missing-actor' };
    }
    if (!input.currentOwner) {
        return { allowed: true, reason: 'no-current-owner' };
    }
    if (input.currentOwner === input.actorId) {
        return { allowed: true, reason: 'owner-match' };
    }
    return { allowed: false, reason: 'owner-mismatch' };
}
export function evaluateClosurePacketTrust(input) {
    if (!input.packetPresent) {
        return { trusted: false, verdict: 'rejected-missing' };
    }
    if (!input.packetSchemaIdMatches) {
        return { trusted: false, verdict: 'rejected-schema-mismatch' };
    }
    if (!input.packetValid) {
        return input.repairAvailable
            ? { trusted: false, verdict: 'recoverable-repair' }
            : { trusted: false, verdict: 'rejected-invalid' };
    }
    return { trusted: true, verdict: 'trusted' };
}
export async function recordStaleRunnerOverride(input) {
    const taskPath = taskPathFor(input.cwd, input.taskId);
    if (!existsSync(taskPath))
        return null;
    const taskDocument = readJsonRecord(taskPath);
    const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
    appendTaskTransitionEvent({
        cwd: input.cwd,
        taskId: input.taskId,
        action: 'allow-stale-runner',
        actorId: input.actorId,
        sessionId: null,
        fromStatus: previousStatus,
        toStatus: previousStatus,
        taskPath,
        taskDocument,
        command: input.command
    });
    return true;
}
// ---------------------------------------------------------------------------
// CliError helpers
// ---------------------------------------------------------------------------
export function isCliErrorWithCode(error, codePrefix) {
    return error instanceof CliError && typeof error.code === 'string' && error.code.startsWith(codePrefix);
}
export function recordFailedEmergencyUseAttempt(input) {
    const auditPath = recordFailedProtectedOverrideAttempt({
        cwd: input.cwd,
        leaseId: input.leaseId,
        permission: input.permission,
        surface: input.surface,
        taskId: input.taskId,
        actorId: input.actorId,
        reason: input.reason,
        command: input.command,
        flags: input.flags,
        failureCode: input.failureCode
    });
    if (!input.leaseId)
        return auditPath;
    try {
        const lease = readEmergencyLease(input.cwd, input.leaseId);
        if (lease.status !== 'active')
            return auditPath;
        if (lease.permission !== input.permission)
            return auditPath;
        if (lease.taskId && lease.taskId !== input.taskId)
            return auditPath;
        if (input.actorId && lease.actorId !== input.actorId)
            return auditPath;
        const usedCount = typeof lease.usedCount === 'number' ? lease.usedCount : Number(lease.usedCount ?? 0);
        if (!Number.isFinite(usedCount) || usedCount >= lease.maxUses)
            return auditPath;
        if (Date.parse(lease.expiresAt) <= Date.now())
            return auditPath;
        const usedAt = new Date().toISOString();
        const usePath = path.join(emergencyRoot(input.cwd), 'uses', `${usedAt.replace(/[:.]/g, '-')}-${lease.leaseId}.json`);
        mkdirSync(path.dirname(usePath), { recursive: true });
        writeFileSync(usePath, `${JSON.stringify({
            schemaId: 'atm.emergencyMaintenanceUse.v1',
            leaseId: lease.leaseId,
            taskId: input.taskId,
            actorId: input.actorId,
            permission: input.permission,
            surface: input.surface,
            usedAt,
            reason: input.reason,
            command: input.command,
            result: 'failed',
            before: {
                leaseStatus: lease.status,
                usedCount
            },
            after: {
                leaseStatus: lease.status,
                usedCount,
                failureCode: input.failureCode
            },
            touchedFiles: []
        }, null, 2)}\n`, 'utf8');
        return relativePathFrom(input.cwd, usePath);
    }
    catch {
        return auditPath;
    }
}
