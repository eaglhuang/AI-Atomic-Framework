import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRuntimeIdentityDefault, writeRuntimeIdentityDefault } from './actor-registry.js';
import { relativePathFrom } from './shared.js';
export const runtimeSessionsRootRelativePath = '.atm/runtime/sessions';
export function readActorWorkSession(cwd, sessionId) {
    const absolutePath = sessionPathFor(path.resolve(cwd), sessionId);
    return readSessionFile(absolutePath);
}
export function listActorWorkSessions(cwd) {
    const root = path.resolve(cwd);
    const absoluteRoot = path.join(root, runtimeSessionsRootRelativePath);
    if (!existsSync(absoluteRoot))
        return [];
    return readdirSync(absoluteRoot)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readSessionFile(path.join(absoluteRoot, entry)))
        .filter((entry) => entry !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
export function resolveActorWorkSession(cwd, criteria) {
    const root = path.resolve(cwd);
    const explicitSessionId = normalizeOptionalString(criteria.sessionId);
    if (explicitSessionId) {
        return readActorWorkSession(root, explicitSessionId);
    }
    const actorId = normalizeOptionalString(criteria.actorId);
    const taskId = normalizeOptionalString(criteria.taskId);
    const claimLeaseId = normalizeOptionalString(criteria.claimLeaseId);
    if (!actorId && !taskId && !claimLeaseId) {
        const defaultIdentity = readRuntimeIdentityDefault(root);
        const activeSessionId = normalizeOptionalString(defaultIdentity?.activeSessionId);
        return activeSessionId ? readActorWorkSession(root, activeSessionId) : null;
    }
    const sessions = listActorWorkSessions(root).filter((session) => {
        if (!criteria.includeNonActive && session.status !== 'active')
            return false;
        if (actorId && session.actorId !== actorId)
            return false;
        if (taskId && session.taskId !== taskId)
            return false;
        if (claimLeaseId && session.claimLeaseId !== claimLeaseId)
            return false;
        return true;
    });
    return sessions[0] ?? null;
}
export function upsertActorWorkSession(input) {
    const cwd = path.resolve(input.cwd);
    const nowIso = input.timestamp ?? new Date().toISOString();
    const status = input.status ?? 'active';
    const existing = resolveActorWorkSession(cwd, {
        sessionId: input.sessionId ?? null,
        actorId: input.actorId,
        taskId: input.taskId,
        claimLeaseId: input.claimLeaseId ?? null,
        includeNonActive: true
    });
    const defaultIdentity = readRuntimeIdentityDefault(cwd);
    const sessionId = normalizeOptionalString(input.sessionId)
        ?? existing?.sessionId
        ?? createActorWorkSessionId(cwd, input.actorId, input.taskId, nowIso);
    const session = {
        schemaId: 'atm.actorWorkSession.v1',
        specVersion: '0.1.0',
        sessionId,
        actorId: input.actorId,
        taskId: input.taskId,
        claimLeaseId: normalizeOptionalString(input.claimLeaseId) ?? existing?.claimLeaseId ?? null,
        status,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        heartbeatAt: nowIso,
        taskPath: normalizeOptionalString(input.taskPath) ?? existing?.taskPath ?? null,
        sourcePrompt: normalizeOptionalString(input.sourcePrompt) ?? existing?.sourcePrompt ?? null,
        batchId: normalizeOptionalString(input.batchId) ?? existing?.batchId ?? null,
        guidanceSessionId: normalizeOptionalString(input.guidanceSessionId) ?? existing?.guidanceSessionId ?? null,
        editor: normalizeOptionalString(input.editor) ?? existing?.editor ?? defaultIdentity?.editor ?? null,
        gitName: normalizeOptionalString(input.gitName) ?? existing?.gitName ?? defaultIdentity?.gitName ?? null,
        gitEmail: normalizeOptionalString(input.gitEmail) ?? existing?.gitEmail ?? defaultIdentity?.gitEmail ?? null,
        reason: normalizeOptionalString(input.reason) ?? existing?.reason ?? null,
        releasedAt: status === 'released' ? nowIso : existing?.releasedAt ?? null,
        closedAt: status === 'closed' ? nowIso : existing?.closedAt ?? null
    };
    const absolutePath = sessionPathFor(cwd, sessionId);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
    if (defaultIdentity?.actorId === input.actorId) {
        writeRuntimeIdentityDefault(cwd, {
            ...defaultIdentity,
            activeSessionId: sessionId,
            updatedAt: nowIso
        });
    }
    return {
        session,
        sessionPath: relativePathFrom(cwd, absolutePath)
    };
}
export function updateActorWorkSessionState(input) {
    const cwd = path.resolve(input.cwd);
    const existing = resolveActorWorkSession(cwd, {
        sessionId: input.sessionId ?? null,
        actorId: input.actorId ?? null,
        taskId: input.taskId ?? null,
        claimLeaseId: input.claimLeaseId ?? null,
        includeNonActive: true
    });
    if (!existing)
        return null;
    return upsertActorWorkSession({
        cwd,
        sessionId: existing.sessionId,
        actorId: existing.actorId,
        taskId: existing.taskId,
        claimLeaseId: input.claimLeaseId ?? existing.claimLeaseId,
        status: input.status,
        reason: input.reason ?? existing.reason ?? null,
        timestamp: input.timestamp,
        taskPath: existing.taskPath,
        sourcePrompt: existing.sourcePrompt,
        batchId: existing.batchId,
        guidanceSessionId: existing.guidanceSessionId,
        editor: existing.editor,
        gitName: existing.gitName,
        gitEmail: existing.gitEmail
    });
}
function sessionPathFor(cwd, sessionId) {
    return path.join(cwd, runtimeSessionsRootRelativePath, `${safeFileId(sessionId)}.json`);
}
function readSessionFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.actorWorkSession.v1' || !normalizeOptionalString(parsed.sessionId) || !normalizeOptionalString(parsed.actorId) || !normalizeOptionalString(parsed.taskId)) {
            return null;
        }
        return {
            schemaId: 'atm.actorWorkSession.v1',
            specVersion: '0.1.0',
            sessionId: parsed.sessionId.trim(),
            actorId: parsed.actorId.trim(),
            taskId: parsed.taskId.trim(),
            claimLeaseId: normalizeOptionalString(parsed.claimLeaseId) ?? null,
            status: normalizeSessionStatus(parsed.status),
            createdAt: normalizeOptionalString(parsed.createdAt) ?? new Date().toISOString(),
            updatedAt: normalizeOptionalString(parsed.updatedAt) ?? new Date().toISOString(),
            heartbeatAt: normalizeOptionalString(parsed.heartbeatAt) ?? normalizeOptionalString(parsed.updatedAt) ?? new Date().toISOString(),
            taskPath: normalizeOptionalString(parsed.taskPath) ?? null,
            sourcePrompt: normalizeOptionalString(parsed.sourcePrompt) ?? null,
            batchId: normalizeOptionalString(parsed.batchId) ?? null,
            guidanceSessionId: normalizeOptionalString(parsed.guidanceSessionId) ?? null,
            editor: normalizeOptionalString(parsed.editor) ?? null,
            gitName: normalizeOptionalString(parsed.gitName) ?? null,
            gitEmail: normalizeOptionalString(parsed.gitEmail) ?? null,
            reason: normalizeOptionalString(parsed.reason) ?? null,
            releasedAt: normalizeOptionalString(parsed.releasedAt) ?? null,
            closedAt: normalizeOptionalString(parsed.closedAt) ?? null
        };
    }
    catch {
        return null;
    }
}
function createActorWorkSessionId(cwd, actorId, taskId, timestamp) {
    const stamp = timestamp.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
    const digest = createHash('sha256')
        .update(`${path.resolve(cwd)}\n${actorId}\n${taskId}\n${timestamp}`)
        .digest('hex')
        .slice(0, 10);
    return `session-${stamp}-${sanitizeToken(actorId)}-${sanitizeToken(taskId)}-${digest}`;
}
function normalizeSessionStatus(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'released' || normalized === 'closed' || normalized === 'handoff' || normalized === 'taken_over') {
        return normalized;
    }
    return 'active';
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function sanitizeToken(value) {
    const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.length > 0 ? normalized : 'session';
}
function safeFileId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
