import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/dist/index.js';
import { classifyForeignGeneratedResidue } from '../../../../core/dist/broker/foreign-generated-residue-disposition.js';
import { isRunnerBuildOutputPath } from '../../../../core/dist/broker/runner-build-output-inventory.js';
import { issueWorkAdmissionTicket } from '../../../../core/dist/broker/work-admission-ticket.js';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { upsertActorWorkSession } from '../actor-session.js';
import { CliError, relativePathFrom, resolveValue } from '../shared.js';
import { findActiveTaskQueue, writeTaskDirectionLock } from '../task-direction.js';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.js';
import { createClaimRecord, isLiveActiveClaim } from './task-ledger-readers.js';
import { readLatestGitHeadReceiptTaskId } from '../git-head-evidence.js';
/**
 * Restores only a released runtime direction lock that still belongs to a
 * live renewal.  The caller has already verified actor/lane ownership; this
 * boundary additionally refuses expired or non-active claims.
 */
export function restoreReleasedDirectionLockForRenewal(input) {
    if (!isLiveActiveClaim(input.claim, input.nowIso)) {
        return { status: 'not-needed', directionLock: null };
    }
    const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
    if (!existsSync(lockPath))
        return { status: 'not-needed', directionLock: null };
    let outerLock;
    try {
        outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    }
    catch {
        return { status: 'not-needed', directionLock: null };
    }
    if (outerLock.released !== true && outerLock.status !== 'released') {
        return { status: 'not-needed', directionLock: null };
    }
    const priorDirectionLock = outerLock.taskDirectionLock;
    if (!priorDirectionLock || typeof priorDirectionLock !== 'object' || Array.isArray(priorDirectionLock)) {
        return { status: 'not-needed', directionLock: null };
    }
    const prior = priorDirectionLock;
    const allowedFiles = Array.from(new Set([
        ...input.claim.files,
        ...(Array.isArray(prior.allowedFiles) ? prior.allowedFiles.filter((value) => typeof value === 'string') : [])
    ]));
    const directionLock = writeTaskDirectionLock({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        queue: findActiveTaskQueue(input.cwd, undefined, { taskId: input.taskId }),
        allowedFiles,
        planningReadOnlyPaths: Array.isArray(prior.planningReadOnlyPaths) ? prior.planningReadOnlyPaths.filter((value) => typeof value === 'string') : [],
        planningMirrorPaths: Array.isArray(prior.planningMirrorPaths) ? prior.planningMirrorPaths.filter((value) => typeof value === 'string') : [],
        allowPlanningMirror: prior.allowPlanningMirror === true,
        prompt: input.taskId,
        sessionId: typeof input.taskDocument.startedBySessionId === 'string' ? input.taskDocument.startedBySessionId : null
    });
    input.taskDocument.taskDirectionLock = directionLock;
    return { status: 'restored', directionLock };
}
export async function completeTaskClaimWithWorkAdmission(input) {
    const claim = {
        ...createClaimRecord({
            taskId: input.taskId,
            actorId: input.actorId,
            files: input.files,
            ttlSeconds: input.ttlSeconds,
            timestamp: input.nowIso
        }),
        intent: input.claimIntent,
        laneSession: input.laneSession.envelope
    };
    const ticket = input.claimIntent === 'write'
        ? issueWorkAdmissionTicket({
            taskId: input.taskId,
            actorId: input.actorId,
            laneSessionId: input.laneSession.session.laneId,
            claimGeneration: String(claim.leaseId),
            allowedFiles: resolveTaskWorkAdmissionFiles(input.taskDocument, input.files, input.cwd),
            requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
            runnerSelection: {
                runnerKind: 'frozen',
                runnerRef: 'release/atm-onefile/atm.mjs',
                selectedAt: input.nowIso
            },
            elevatedRisk: assessElevatedRisk(input.taskDocument),
            deferredForeignResidue: collectDeferredForeignGeneratedResidue(input.cwd, input.taskId),
            now: input.nowIso,
            ttlSeconds: input.ttlSeconds
        })
        : null;
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: input.cwd });
    try {
        const startedAt = Date.now();
        await resolveValue(adapter.stores.lockStore.acquireLock(input.taskRef, input.files, input.actorId));
        input.phases.push({ phase: 'lock-acquire', durationMs: Date.now() - startedAt });
    }
    catch (error) {
        if (errorCode(error) === 'ATM_LOCK_CONFLICT') {
            throw new CliError('ATM_LOCK_CONFLICT', `Task ${input.taskId} has an active conflicting lock.`, {
                exitCode: 1,
                details: errorDetails(error)
            });
        }
        throw error;
    }
    input.taskDocument.claim = claim;
    input.taskDocument.owner = input.actorId;
    input.taskDocument.startedAt = String(input.taskDocument.startedAt ?? input.nowIso);
    input.taskDocument.startedByActor = String(input.taskDocument.startedByActor ?? input.actorId);
    if (ticket) {
        input.taskDocument.workAdmissionTicket = ticket;
        input.taskDocument.workAdmission = {
            ...(readRecord(input.taskDocument.workAdmission) ?? {}),
            recoveryMode: ticket.recovery.requestedMode,
            resolvedRecoveryMode: ticket.recovery.resolvedMode,
            policyDigest: ticket.recovery.policyDigest
        };
    }
    const sessionRecord = upsertActorWorkSession({
        cwd: input.cwd,
        actorId: input.actorId,
        taskId: input.taskId,
        claimLeaseId: String(claim.leaseId),
        status: 'active',
        taskPath: relativePathFrom(input.cwd, input.taskPath),
        timestamp: input.nowIso,
        guidanceSessionId: input.laneSession.session.laneId
    });
    input.taskDocument.startedBySessionId = sessionRecord.session.sessionId;
    input.taskDocument.status = 'running';
    const directionStartedAt = Date.now();
    const directionLock = writeTaskDirectionLock({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        queue: findActiveTaskQueue(input.cwd),
        batchId: null,
        scopeKey: null,
        allowedFiles: input.files,
        planningReadOnlyPaths: input.planningReadOnlyPaths,
        planningMirrorPaths: input.planningMirrorPaths,
        allowPlanningMirror: input.allowPlanningMirror,
        prompt: input.taskId,
        sessionId: sessionRecord.session.sessionId,
        laneSession: input.laneSession.envelope
    });
    input.phases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionStartedAt });
    input.taskDocument.taskDirectionLock = directionLock;
    const transitionStartedAt = Date.now();
    const transitionPath = writeTaskDocumentWithTransition({
        cwd: input.cwd,
        taskPath: input.taskPath,
        taskId: input.taskId,
        taskDocument: input.taskDocument,
        action: 'claim',
        actorId: input.actorId,
        sessionId: sessionRecord.session.sessionId,
        previousStatus: input.previousStatus
    });
    input.phases.push({ phase: 'task-transition-write', durationMs: Date.now() - transitionStartedAt });
    return { claim, ticket, session: sessionRecord.session, transitionPath, taskDirectionLock: directionLock };
}
/** Rebinds a claim ticket whenever a governed renew changes its validity window. */
export function resealWorkAdmissionTicketForRenewal(input) {
    const laneSession = readRecord(input.claim.laneSession);
    const laneSessionId = laneSession?.laneSessionId ?? laneSession?.laneId;
    const ticket = issueWorkAdmissionTicket({
        taskId: input.taskId,
        actorId: input.actorId,
        laneSessionId: typeof laneSessionId === 'string' ? laneSessionId : null,
        claimGeneration: String(input.claim.leaseId),
        allowedFiles: resolveTaskWorkAdmissionFiles(input.taskDocument, [], input.cwd),
        requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
        runnerSelection: {
            runnerKind: 'frozen',
            runnerRef: 'release/atm-onefile/atm.mjs',
            selectedAt: input.nowIso
        },
        elevatedRisk: assessElevatedRisk(input.taskDocument),
        deferredForeignResidue: collectDeferredForeignGeneratedResidue(input.cwd, input.taskId),
        now: input.nowIso,
        ttlSeconds: input.claim.ttlSeconds
    });
    input.taskDocument.workAdmissionTicket = ticket;
    input.taskDocument.workAdmission = {
        ...(readRecord(input.taskDocument.workAdmission) ?? {}),
        recoveryMode: ticket.recovery.requestedMode,
        resolvedRecoveryMode: ticket.recovery.resolvedMode,
        policyDigest: ticket.recovery.policyDigest
    };
    return ticket;
}
function collectDeferredForeignGeneratedResidue(cwd, candidateTaskId) {
    const result = spawnSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0)
        return [];
    return String(result.stdout ?? '').split(/\r?\n/)
        .map((entry) => entry.replace(/\\/g, '/').trim())
        .filter((entry) => entry.startsWith('artifacts/generated/'))
        .flatMap((entry) => {
        const absolute = path.join(cwd, entry);
        if (!existsSync(absolute))
            return [];
        const content = readFileSync(absolute, 'utf8');
        const producerTaskId = readProducerTaskId(content);
        const disposition = classifyForeignGeneratedResidue({
            path: entry,
            content,
            candidateTaskId,
            producerDeclaresPath: producerTaskId ? producerDeclaresArtifactPath(cwd, producerTaskId, entry) : false,
            runnerInventoryMember: isRunnerBuildOutputPath(entry)
        });
        return disposition.state === 'deferred' && disposition.provenance ? [disposition.provenance] : [];
    });
}
function readProducerTaskId(content) {
    try {
        const parsed = JSON.parse(content);
        return typeof parsed.taskId === 'string' && parsed.taskId.trim() ? parsed.taskId.trim() : null;
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
        const task = JSON.parse(readFileSync(taskPath, 'utf8'));
        const values = [...(Array.isArray(task.scopePaths) ? task.scopePaths : []), ...(Array.isArray(task.deliverables) ? task.deliverables : [])];
        return values.some((entry) => String(entry).replace(/\\/g, '/') === artifactPath);
    }
    catch {
        return false;
    }
}
export function resolveTaskWorkAdmissionFiles(taskDocument, fallback, cwd) {
    const directionLock = readRecord(taskDocument.taskDirectionLock);
    const declaredFiles = Array.isArray(directionLock?.allowedFiles)
        ? directionLock.allowedFiles.map(String)
        : Array.isArray(taskDocument.scopePaths)
            ? taskDocument.scopePaths.map(String)
            : fallback;
    const taskId = normalizeTaskId(taskDocument.workItemId ?? taskDocument.taskId);
    return taskId
        ? [...new Set([...declaredFiles, ...taskLifecycleArtifactPaths(taskId, cwd)])]
        : declaredFiles;
}
function taskLifecycleArtifactPaths(taskId, cwd) {
    return [
        ...(cwd && readLatestGitHeadReceiptTaskId(cwd) === taskId ? ['.atm/history/evidence/git-head.jsonl'] : []),
        `.atm/history/evidence/${taskId}.*`,
        `.atm/history/task-events/${taskId}/**`,
        `.atm/history/tasks/${taskId}.json`
    ];
}
function normalizeTaskId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readRequestedRecoveryMode(taskDocument) {
    const admission = readRecord(taskDocument.workAdmission);
    const value = String(admission?.recoveryMode ?? 'auto').trim().toLowerCase();
    return value === 'enabled' || value === 'disabled' ? value : 'auto';
}
function assessElevatedRisk(taskDocument) {
    const paths = resolveTaskWorkAdmissionFiles(taskDocument, []);
    return {
        complex: paths.length > 12,
        destructiveCapability: false,
        sharedSurface: paths.some((entry) => entry.startsWith('packages/core/') || entry.startsWith('schemas/') || entry.startsWith('docs/governance/')),
        workerEvidence: 'trusted'
    };
}
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function errorCode(error) {
    return error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : null;
}
function errorDetails(error) {
    const details = error && typeof error === 'object' ? error.details : null;
    return details && typeof details === 'object' && !Array.isArray(details) ? details : {};
}
