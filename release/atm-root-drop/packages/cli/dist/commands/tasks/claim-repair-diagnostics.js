import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/dist/index.js';
import { resolveActorWorkSession, updateActorWorkSessionState } from '../actor-session.js';
import { CliError, resolveValue } from '../shared.js';
import { diagnoseTaskDirectionLockAllowedFiles } from '../task-direction.js';
import { isClaimExpired, parseClaimRecord } from './task-ledger-readers.js';
const CLOSEOUT_OWNER_RULE = 'Only the active lifecycle owner (claim.actorId with a valid lease and work session) may mutate deliverables or run taskflow close --write. Other agents remain read-only until handoff, release, or governed repair-claim clears stale drift.';
function normalizeTaskStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
function quoteCommandValue(value) {
    return /^[A-Za-z0-9._:/\\-]+$/.test(value)
        ? value
        : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
export function buildRepairClaimCommand(input) {
    const parts = ['node', 'atm.mjs', 'tasks', 'repair-claim', '--task', quoteCommandValue(input.taskId), '--actor', quoteCommandValue(input.actorId)];
    if (input.write) {
        parts.push('--write');
    }
    if (input.reason) {
        parts.push('--reason', quoteCommandValue(input.reason));
    }
    parts.push('--json');
    return parts.join(' ');
}
function readGovernanceLock(cwd, taskId) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    if (!existsSync(lockPath))
        return null;
    try {
        return JSON.parse(readFileSync(lockPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function isLockReleased(lock) {
    if (!lock)
        return true;
    return lock.released === true || lock.status === 'released';
}
function readLockActorId(lock) {
    if (!lock)
        return null;
    const embedded = lock.taskDirectionLock;
    if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) {
        const actorId = embedded.actorId;
        if (typeof actorId === 'string' && actorId.trim())
            return actorId.trim();
    }
    const lockedBy = lock.lockedBy ?? lock.actorId;
    return typeof lockedBy === 'string' && lockedBy.trim() ? lockedBy.trim() : null;
}
export function diagnoseClaimRepairState(cwd, taskId, actorId) {
    const root = path.resolve(cwd);
    const nowIso = new Date().toISOString();
    const taskPath = path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`);
    const taskDocument = existsSync(taskPath)
        ? JSON.parse(readFileSync(taskPath, 'utf8'))
        : null;
    const status = taskDocument ? normalizeTaskStatus(taskDocument.status) : null;
    const claim = parseClaimRecord(taskDocument?.claim);
    const governanceLock = readGovernanceLock(root, taskId);
    const lockReleased = isLockReleased(governanceLock);
    const lockActorId = readLockActorId(governanceLock);
    const sidecarPath = path.join(root, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
    const activeSession = resolveActorWorkSession(root, { taskId, includeNonActive: false });
    const directionDiag = diagnoseTaskDirectionLockAllowedFiles(root, taskId);
    const ownerActorId = typeof taskDocument?.owner === 'string' ? taskDocument.owner : null;
    const issues = [];
    const hasValidActiveClaim = claim?.state === 'active' && !isClaimExpired(claim, nowIso);
    if (hasValidActiveClaim) {
        issues.push({
            kind: 'valid-active-claim',
            severity: 'blocking',
            summary: `Task ${taskId} has a valid active claim owned by ${claim.actorId}.`,
            details: {
                actorId: claim.actorId,
                leaseId: claim.leaseId,
                heartbeatAt: claim.heartbeatAt,
                ttlSeconds: claim.ttlSeconds
            }
        });
    }
    if (claim && claim.state === 'active' && isClaimExpired(claim, nowIso)) {
        issues.push({
            kind: 'expired-claim',
            severity: 'repairable',
            summary: `Claim lease ${claim.leaseId} expired for actor ${claim.actorId}.`,
            details: {
                actorId: claim.actorId,
                leaseId: claim.leaseId,
                heartbeatAt: claim.heartbeatAt,
                ttlSeconds: claim.ttlSeconds
            }
        });
    }
    if ((status === 'running' || status === 'review') && !hasValidActiveClaim) {
        issues.push({
            kind: 'stale-running-without-claim',
            severity: 'repairable',
            summary: `Task status is ${status} but no valid active claim exists.`,
            details: { status, claimState: claim?.state ?? null }
        });
    }
    if (claim?.state === 'released' && (status === 'running' || status === 'review')) {
        issues.push({
            kind: 'stale-claim-released',
            severity: 'repairable',
            summary: `Task status is ${status} while claim state is released.`,
            details: { status, claimState: claim.state }
        });
    }
    if (governanceLock && !lockReleased && !hasValidActiveClaim) {
        issues.push({
            kind: 'dangling-governance-lock',
            severity: 'repairable',
            summary: `Governance lock exists without a valid active claim.`,
            details: {
                lockActorId,
                claimState: claim?.state ?? null
            }
        });
    }
    if (existsSync(sidecarPath) && (!governanceLock || lockReleased)) {
        issues.push({
            kind: 'dangling-direction-sidecar',
            severity: 'repairable',
            summary: 'Direction-lock sidecar exists without an active governance lock.',
            details: { sidecarPath: `.atm/runtime/task-direction-locks/${taskId}.json` }
        });
    }
    if (claim && governanceLock && !lockReleased && lockActorId && claim.actorId !== lockActorId) {
        issues.push({
            kind: 'conflicting-lock-actor',
            severity: 'repairable',
            summary: `Claim actor ${claim.actorId} does not match lock actor ${lockActorId}.`,
            details: {
                claimActorId: claim.actorId,
                lockActorId
            }
        });
    }
    if (activeSession?.status === 'active') {
        if (!claim || claim.state !== 'active') {
            issues.push({
                kind: 'orphaned-active-session',
                severity: 'repairable',
                summary: `Active work session ${activeSession.sessionId} exists without an active claim.`,
                details: {
                    sessionId: activeSession.sessionId,
                    sessionActorId: activeSession.actorId
                }
            });
        }
        else if (activeSession.claimLeaseId && activeSession.claimLeaseId !== claim.leaseId) {
            issues.push({
                kind: 'conflicting-session-lease',
                severity: 'repairable',
                summary: `Active session lease ${activeSession.claimLeaseId} does not match claim lease ${claim.leaseId}.`,
                details: {
                    sessionId: activeSession.sessionId,
                    sessionLeaseId: activeSession.claimLeaseId,
                    claimLeaseId: claim.leaseId
                }
            });
        }
    }
    if (directionDiag.mismatches.length > 0 && !hasValidActiveClaim) {
        issues.push({
            kind: 'conflicting-lock-actor',
            severity: 'repairable',
            summary: 'Direction-lock allowedFiles drift detected between governance lock and claim.files.',
            details: {
                mismatches: directionDiag.mismatches
            }
        });
    }
    const blocked = issues.some((entry) => entry.severity === 'blocking');
    const repairable = !blocked && issues.some((entry) => entry.severity === 'repairable');
    const resolvedActor = actorId?.trim() || '<actor>';
    const writeCommand = repairable
        ? buildRepairClaimCommand({ taskId, actorId: resolvedActor, write: true, reason: '<why repair is required>' })
        : null;
    return {
        schemaId: 'atm.claimRepairDiagnosis.v1',
        taskId,
        status,
        claim,
        issues,
        repairable,
        blocked,
        lifecycleOwner: {
            ownerActorId,
            claimActorId: claim?.actorId ?? null,
            sessionActorId: activeSession?.actorId ?? null,
            lockActorId,
            closeoutOwnerRule: CLOSEOUT_OWNER_RULE
        },
        writeCommand
    };
}
export async function applyClaimRepairWrite(input) {
    if (input.diagnosis.blocked) {
        throw new CliError('ATM_TASK_REPAIR_CLAIM_BLOCKED', `Task ${input.taskId} has a valid active claim; repair-claim cannot mask live concurrency.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                issues: input.diagnosis.issues,
                requiredCommand: `node atm.mjs tasks status --task ${input.taskId} --json`
            }
        });
    }
    if (!input.diagnosis.repairable) {
        throw new CliError('ATM_TASK_REPAIR_CLAIM_NOT_NEEDED', `Task ${input.taskId} has no repairable claim drift.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                issues: input.diagnosis.issues
            }
        });
    }
    const root = path.resolve(input.cwd);
    const nowIso = new Date().toISOString();
    const taskDocument = { ...input.taskDocument };
    const beforeClaim = parseClaimRecord(taskDocument.claim);
    const beforeStatus = normalizeTaskStatus(taskDocument.status);
    const repairActions = [];
    const issueKinds = new Set(input.diagnosis.issues.map((entry) => entry.kind));
    if (issueKinds.has('expired-claim') && beforeClaim) {
        taskDocument.claim = {
            ...beforeClaim,
            state: 'released',
            reason: input.reason,
            heartbeatAt: nowIso
        };
        repairActions.push('released-expired-claim');
    }
    if (issueKinds.has('stale-running-without-claim') || issueKinds.has('stale-claim-released')) {
        if (beforeStatus === 'running' || beforeStatus === 'review') {
            taskDocument.status = 'ready';
            repairActions.push('reset-status-to-ready');
        }
        if (beforeClaim?.state === 'active' && issueKinds.has('stale-running-without-claim')) {
            taskDocument.claim = {
                ...beforeClaim,
                state: 'released',
                reason: input.reason,
                heartbeatAt: nowIso
            };
            repairActions.push('released-stale-active-claim');
        }
        if (typeof taskDocument.owner === 'string') {
            delete taskDocument.owner;
            repairActions.push('cleared-stale-owner');
        }
        if (taskDocument.taskDirectionLock) {
            delete taskDocument.taskDirectionLock;
            repairActions.push('cleared-embedded-direction-lock');
        }
    }
    const governanceLock = readGovernanceLock(root, input.taskId);
    const lockPath = path.join(root, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
    const sidecarPath = path.join(root, '.atm', 'runtime', 'task-direction-locks', `${input.taskId}.json`);
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
    if (issueKinds.has('dangling-governance-lock') && governanceLock && !isLockReleased(governanceLock)) {
        try {
            await resolveValue(adapter.stores.lockStore.releaseLock(input.taskId, input.actorId));
        }
        catch {
            writeFileSync(lockPath, `${JSON.stringify({
                ...governanceLock,
                released: true,
                status: 'released',
                releasedAt: nowIso,
                releasedBy: input.actorId,
                releaseReason: input.reason
            }, null, 2)}\n`, 'utf8');
        }
        repairActions.push('released-dangling-governance-lock');
    }
    if (issueKinds.has('dangling-direction-sidecar') && existsSync(sidecarPath)) {
        rmSync(sidecarPath, { force: true });
        repairActions.push('removed-direction-sidecar');
    }
    const activeSession = resolveActorWorkSession(root, { taskId: input.taskId, includeNonActive: false });
    if (activeSession && (issueKinds.has('orphaned-active-session') || issueKinds.has('conflicting-session-lease'))) {
        updateActorWorkSessionState({
            cwd: root,
            actorId: activeSession.actorId,
            taskId: input.taskId,
            status: 'released',
            reason: input.reason,
            timestamp: nowIso
        });
        repairActions.push('released-orphaned-session');
    }
    const reportPath = path.join(root, '.atm', 'history', 'reports', 'claim-repair', `${nowIso.replace(/[:.]/g, '-')}-${input.taskId}.json`);
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify({
        schemaId: 'atm.claimRepairReport.v1',
        generatedAt: nowIso,
        taskId: input.taskId,
        actorId: input.actorId,
        reason: input.reason,
        before: {
            status: beforeStatus,
            claim: beforeClaim
        },
        after: {
            status: normalizeTaskStatus(taskDocument.status),
            claim: parseClaimRecord(taskDocument.claim)
        },
        repairActions,
        issues: input.diagnosis.issues
    }, null, 2)}\n`, 'utf8');
    repairActions.push(`wrote-report:${path.relative(root, reportPath).replace(/\\/g, '/')}`);
    return {
        before: {
            status: beforeStatus,
            claim: beforeClaim
        },
        after: {
            status: normalizeTaskStatus(taskDocument.status),
            claim: parseClaimRecord(taskDocument.claim)
        },
        repairActions,
        taskDocument
    };
}
