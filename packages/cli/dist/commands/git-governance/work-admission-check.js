import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { frameworkTempPublicationCapabilityCovers, resolveFrameworkTempPublicationCapability, } from '../framework-development/framework-temp-publication-capability.js';
import { checkWorkAdmissionTicket, createWorkAdmissionCoverageReceipt, issueWorkAdmissionTicket } from '../../_vendor/core/dist/broker/work-admission-ticket.js';
/**
 * Boundary adapter for the single claim-issued authority.  It deliberately
 * owns no policy: callers supply the observed operation/files and receive the
 * authority decision plus an attributable coverage receipt.
 */
export function evaluateWorkAdmissionGate(input) {
    const ticket = resolveWorkAdmissionTicket(input);
    const decision = checkWorkAdmissionTicket({
        ticket,
        taskId: input.taskId,
        actorId: input.actorId,
        laneSessionId: input.laneSessionId,
        claimGeneration: input.claimGeneration,
        files: input.files,
        operation: input.operation,
        now: input.now
    });
    if (!decision.ok || !ticket)
        return { decision, receipt: null };
    const receipt = createWorkAdmissionCoverageReceipt({
        ticket,
        operation: input.operation,
        path: input.files[0] ?? '.',
        observedContent: input.observedContent ?? JSON.stringify({ operation: input.operation, files: [...input.files].sort() }),
        producingAtmCommand: input.producingAtmCommand,
        now: input.now
    });
    return { decision, receipt };
}
function issueFrameworkTempAdmissionTicket(input) {
    const now = input.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    const capability = resolveFrameworkTempPublicationCapability({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        now: nowMs,
    });
    if (!capability || !frameworkTempPublicationCapabilityCovers(capability, input.files))
        return null;
    const remainingSeconds = Math.max(1, Math.floor((Date.parse(capability.heartbeatAt) + capability.ttlSeconds * 1000 - nowMs) / 1000));
    return issueWorkAdmissionTicket({
        taskId: capability.taskId,
        actorId: capability.actorId,
        laneSessionId: capability.laneSessionId,
        claimGeneration: `framework-lock:${capability.heartbeatAt}`,
        allowedFiles: capability.allowedFiles,
        runnerSelection: { runnerKind: 'frozen', runnerRef: 'framework-mode-lock', selectedAt: now },
        now,
        ttlSeconds: remainingSeconds
    });
}
export function resolveWorkAdmissionTicket(input) {
    return readWorkAdmissionTicket(input.cwd, input.taskId)
        ?? issueLegacyActiveTaskAdmissionTicket(input)
        ?? issueFrameworkTempAdmissionTicket(input);
}
function issueLegacyActiveTaskAdmissionTicket(input) {
    const task = readTaskDocument(input.cwd, input.taskId);
    const claim = task?.claim;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim))
        return null;
    const record = claim;
    if (String(record.state ?? '').trim().toLowerCase() !== 'active')
        return null;
    const actorId = typeof record.actorId === 'string' ? record.actorId.trim() : '';
    const claimGeneration = typeof record.leaseId === 'string' ? record.leaseId.trim() : '';
    if (!actorId || actorId !== input.actorId || !claimGeneration)
        return null;
    const allowedFiles = resolveLegacyTaskAdmissionFiles(input.cwd, task, input.taskId);
    if (allowedFiles.length === 0)
        return null;
    const lane = record.laneSession && typeof record.laneSession === 'object'
        ? record.laneSession
        : null;
    const laneSessionId = typeof lane?.laneSessionId === 'string'
        ? lane.laneSessionId
        : (typeof lane?.laneId === 'string' ? lane.laneId : null);
    return issueWorkAdmissionTicket({
        taskId: input.taskId,
        actorId,
        laneSessionId,
        claimGeneration,
        allowedFiles,
        runnerSelection: {
            runnerKind: 'frozen',
            runnerRef: 'legacy-active-claim',
            selectedAt: input.now ?? new Date().toISOString()
        },
        now: input.now,
        ttlSeconds: positiveInteger(record.ttlSeconds, 3600)
    });
}
/**
 * Normal boundary entrypoint.  Claim identity comes from the ledger sealed by
 * the claim path, so commit/close/push callers cannot invent a parallel actor
 * or lane interpretation.
 */
export function evaluateTaskWorkAdmissionGate(input) {
    const task = readTaskAdmissionContext(input.cwd, input.taskId);
    const persistedTicket = readWorkAdmissionTicket(input.cwd, input.taskId);
    const terminalRepairTicket = persistedTicket?.origin === 'repair-closure' ? persistedTicket : null;
    const frameworkTemp = task ? null : resolveFrameworkTempPublicationCapability({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: null,
        now: input.now ? Date.parse(input.now) : undefined,
    });
    return evaluateWorkAdmissionGate({
        ...input,
        // A terminal repair ticket is a complete identity.  In particular, its
        // deliberate null lane must not fall back to the released claim's lane.
        actorId: terminalRepairTicket ? terminalRepairTicket.actorId : (task?.actorId ?? frameworkTemp?.actorId ?? ''),
        laneSessionId: terminalRepairTicket ? terminalRepairTicket.laneSessionId : (task?.laneSessionId ?? frameworkTemp?.laneSessionId ?? null),
        claimGeneration: terminalRepairTicket
            ? terminalRepairTicket.claimGeneration
            : (task?.claimGeneration ?? (frameworkTemp?.heartbeatAt ? `framework-lock:${frameworkTemp.heartbeatAt}` : null))
    });
}
/**
 * Creates the one durable authority that bridges a closure-packet repair to
 * its follow-up governed commit.  Terminal repairs intentionally do not
 * resurrect a released claim; the persisted ticket is the bounded authority.
 */
export function issueRepairClosureAdmissionTicket(input) {
    const task = readTaskDocument(input.cwd, input.taskId);
    const now = input.now ?? new Date().toISOString();
    return issueWorkAdmissionTicket({
        taskId: input.taskId,
        origin: 'repair-closure',
        actorId: input.actorId,
        laneSessionId: input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null,
        claimGeneration: `repair-closure:${now}`,
        allowedFiles: resolveLegacyTaskAdmissionFiles(input.cwd, task ?? {}, input.taskId),
        runnerSelection: { runnerKind: 'frozen', runnerRef: 'repair-closure', selectedAt: now },
        now
    });
}
export function readWorkAdmissionTicket(cwd, taskId) {
    const task = readTaskDocument(cwd, taskId);
    return task && isTicket(task.workAdmissionTicket) ? task.workAdmissionTicket : null;
}
function readTaskAdmissionContext(cwd, taskId) {
    const task = readTaskDocument(cwd, taskId);
    const claim = task?.claim;
    if (!claim || typeof claim !== 'object')
        return null;
    const record = claim;
    const lane = record.laneSession && typeof record.laneSession === 'object'
        ? record.laneSession
        : null;
    return {
        actorId: typeof record.actorId === 'string' ? record.actorId : '',
        laneSessionId: typeof lane?.laneSessionId === 'string' ? lane.laneSessionId : (typeof lane?.laneId === 'string' ? lane.laneId : null),
        claimGeneration: typeof record.leaseId === 'string' ? record.leaseId : null
    };
}
function readTaskDocument(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return null;
    try {
        return JSON.parse(readFileSync(taskPath, 'utf8'));
    }
    catch {
        return null;
    }
}
function resolveLegacyTaskAdmissionFiles(cwd, task, taskId) {
    const directionLock = task.taskDirectionLock && typeof task.taskDirectionLock === 'object' && !Array.isArray(task.taskDirectionLock)
        ? task.taskDirectionLock
        : null;
    const claim = task.claim && typeof task.claim === 'object' && !Array.isArray(task.claim)
        ? task.claim
        : null;
    const declaredFiles = Array.isArray(directionLock?.allowedFiles)
        ? directionLock.allowedFiles.map(String)
        : Array.isArray(task.scopePaths)
            ? task.scopePaths.map(String)
            : Array.isArray(task.deliverables)
                ? task.deliverables.map(String)
                : Array.isArray(claim?.files)
                    ? claim.files.map(String)
                    : [];
    return [...new Set([
            ...declaredFiles.map((entry) => entry.trim()).filter(Boolean),
            ...resolveTaskOwnedProtectedOverrideAuditPaths(cwd, taskId),
            '.atm/history/evidence/git-head.jsonl',
            `.atm/history/evidence/${taskId}.*`,
            `.atm/history/task-events/${taskId}/**`,
            `.atm/history/tasks/${taskId}.json`
        ])];
}
/**
 * A terminal closeback can include protected-override receipts created for the
 * same task before its claim was released.  Admit only concrete receipts whose
 * payload names that task; never grant the shared audit directory by wildcard.
 */
function resolveTaskOwnedProtectedOverrideAuditPaths(cwd, taskId) {
    const directory = path.join(cwd, '.atm', 'history', 'protected-override-audit');
    if (!existsSync(directory))
        return [];
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name);
        try {
            const payload = JSON.parse(readFileSync(absolutePath, 'utf8'));
            return payload.taskId === taskId
                ? [`.atm/history/protected-override-audit/${entry.name}`]
                : [];
        }
        catch {
            return [];
        }
    });
}
function isTicket(value) {
    return Boolean(value && typeof value === 'object'
        && value.schemaId === 'atm.workAdmissionTicket.v1');
}
function positiveInteger(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}
