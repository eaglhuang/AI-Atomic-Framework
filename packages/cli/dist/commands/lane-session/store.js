import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRuntimeIdentityForActor } from '../actor-registry.js';
import { relativePathFrom } from '../shared.js';
export const runtimeLaneSessionsRootRelativePath = '.atm/runtime/lane-sessions';
export function mintLaneSession(input) {
    const cwd = path.resolve(input.cwd);
    const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
    const laneId = normalizeOptionalString(input.laneId) ?? createLaneSessionId(cwd, input.actorId, input.taskId ?? null, nowIso);
    const ttlMs = normalizePositiveInteger(input.ttlMs, 0);
    const session = {
        schemaId: 'atm.laneSession.v1',
        specVersion: '0.1.0',
        laneId,
        actorId: input.actorId,
        taskId: normalizeOptionalString(input.taskId) ?? null,
        status: input.status ?? 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
        ttlMs,
        identity: snapshotLaneIdentity(cwd, input.actorId),
        adoptionSource: normalizeAdoptionSource(input.adoptionSource),
        handoffTokenHash: input.handoffToken ? hashHandoffToken(input.handoffToken) : null,
        lastCommand: normalizeLastCommand(input.lastCommand),
        lastHeartbeatAt: nowIso
    };
    const absolutePath = laneSessionPathFor(cwd, laneId);
    atomicWriteJson(absolutePath, session);
    return {
        session,
        sessionPath: relativePathFrom(cwd, absolutePath)
    };
}
export function adoptLaneSession(input) {
    const cwd = path.resolve(input.cwd);
    const previousSession = readLaneSession(cwd, input.laneId);
    if (!previousSession) {
        return { ok: false, reason: 'not-found', session: null, ttlPhaseBefore: null };
    }
    if (previousSession.status === 'released' || previousSession.status === 'expired') {
        return { ok: false, reason: 'closed', session: previousSession, ttlPhaseBefore: null };
    }
    const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
    const graceMs = normalizePositiveInteger(input.graceMs, 0);
    const ttlPhaseBefore = classifyLaneSessionTtl({
        now: nowIso,
        expiresAt: previousSession.expiresAt,
        graceMs
    });
    const providedToken = normalizeOptionalString(input.handoffToken);
    const tokenMatches = Boolean(providedToken
        && previousSession.handoffTokenHash
        && hashHandoffToken(providedToken) === previousSession.handoffTokenHash);
    if (providedToken && previousSession.handoffTokenHash && !tokenMatches) {
        return { ok: false, reason: 'token-mismatch', session: previousSession, ttlPhaseBefore };
    }
    let authorization = null;
    if (tokenMatches) {
        authorization = 'handoff-token';
    }
    else if (previousSession.status === 'handoff') {
        authorization = 'handoff-status';
    }
    else if (ttlPhaseBefore === 'expired') {
        authorization = 'stale-ttl';
    }
    else if (input.confirm === true) {
        authorization = 'confirm';
    }
    else {
        return { ok: false, reason: 'not-stale', session: previousSession, ttlPhaseBefore };
    }
    const ttlMs = normalizePositiveInteger(previousSession.ttlMs, 0);
    const session = {
        ...previousSession,
        actorId: input.actorId,
        status: 'adopted',
        updatedAt: nowIso,
        expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
        identity: snapshotLaneIdentity(cwd, input.actorId),
        adoptionSource: {
            kind: 'adoption',
            sourceLaneId: previousSession.laneId,
            sourceActorId: previousSession.actorId,
            reason: normalizeOptionalString(input.reason) ?? null
        },
        lastCommand: normalizeLastCommand(input.lastCommand),
        lastHeartbeatAt: nowIso
    };
    const absolutePath = laneSessionPathFor(cwd, previousSession.laneId);
    atomicWriteJson(absolutePath, session);
    return {
        ok: true,
        session,
        previousSession,
        sessionPath: relativePathFrom(cwd, absolutePath),
        ttlPhaseBefore,
        authorization
    };
}
export function recordLaneSessionHeartbeat(input) {
    const cwd = path.resolve(input.cwd);
    const previousSession = readLaneSession(cwd, input.laneId);
    if (!previousSession) {
        return { ok: false, reason: 'not-found', session: null, ttlPhaseBefore: null };
    }
    const nowIso = normalizeIsoString(input.timestamp) ?? new Date().toISOString();
    const ttlPhaseBefore = classifyLaneSessionTtl({ now: nowIso, expiresAt: previousSession.expiresAt });
    if (previousSession.status === 'released' || previousSession.status === 'expired') {
        return { ok: false, reason: 'closed', session: previousSession, ttlPhaseBefore };
    }
    if (ttlPhaseBefore === 'expired') {
        return { ok: false, reason: 'expired', session: previousSession, ttlPhaseBefore };
    }
    const ttlMs = normalizePositiveInteger(previousSession.ttlMs, 0);
    const session = {
        ...previousSession,
        actorId: normalizeOptionalString(input.actorId) ?? previousSession.actorId,
        updatedAt: nowIso,
        expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
        identity: snapshotLaneIdentity(cwd, normalizeOptionalString(input.actorId) ?? previousSession.actorId),
        lastCommand: normalizeLastCommand(input.lastCommand) ?? previousSession.lastCommand,
        lastHeartbeatAt: nowIso
    };
    const absolutePath = laneSessionPathFor(cwd, previousSession.laneId);
    atomicWriteJson(absolutePath, session);
    return {
        ok: true,
        session,
        previousSession,
        sessionPath: relativePathFrom(cwd, absolutePath),
        ttlPhaseBefore
    };
}
export function inspectLaneSessionSweep(input) {
    return sweepLaneSessions({ ...input, write: false });
}
export function sweepLaneSessions(input) {
    const cwd = path.resolve(input.cwd);
    const generatedAt = normalizeIsoString(input.now) ?? new Date().toISOString();
    const graceMs = normalizePositiveInteger(input.graceMs ?? 0, 0);
    const entries = [];
    const sweptSessions = [];
    for (const session of listLaneSessions(cwd)) {
        const ttlPhase = classifyLaneSessionTtl({ now: generatedAt, expiresAt: session.expiresAt, graceMs });
        const sweepable = ttlPhase === 'expired' && session.status !== 'released' && session.status !== 'expired';
        entries.push({
            laneId: session.laneId,
            actorId: session.actorId,
            taskId: session.taskId,
            status: session.status,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
            ttlPhase,
            sweepable,
            reason: sweepable
                ? 'ttl-expired'
                : session.status === 'released' || session.status === 'expired'
                    ? 'already-closed'
                    : ttlPhase === 'grace'
                        ? 'within-grace'
                        : 'fresh'
        });
        if (!input.write || !sweepable)
            continue;
        const nextSession = {
            ...session,
            status: 'expired',
            updatedAt: generatedAt,
            lastCommand: normalizeLastCommand(input.lastCommand) ?? session.lastCommand
        };
        atomicWriteJson(laneSessionPathFor(cwd, session.laneId), nextSession);
        sweptSessions.push(nextSession);
    }
    return {
        generatedAt,
        graceMs,
        write: input.write === true,
        entries,
        staleCount: entries.filter((entry) => entry.sweepable).length,
        sweptCount: sweptSessions.length,
        sweptSessions
    };
}
export function isLaneSessionAdoptable(session) {
    return session.status !== 'released' && session.status !== 'expired';
}
export function readLaneSession(cwd, laneId) {
    return readLaneSessionFile(laneSessionPathFor(path.resolve(cwd), laneId));
}
export function listLaneSessions(cwd) {
    const absoluteRoot = path.join(path.resolve(cwd), runtimeLaneSessionsRootRelativePath);
    if (!existsSync(absoluteRoot))
        return [];
    return readdirSync(absoluteRoot)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readLaneSessionFile(path.join(absoluteRoot, entry)))
        .filter((entry) => entry !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
export function classifyLaneSessionTtl(input) {
    const nowMs = input.now instanceof Date ? input.now.getTime() : Date.parse(input.now ?? new Date().toISOString());
    const expiresMs = Date.parse(input.expiresAt);
    const graceMs = normalizePositiveInteger(input.graceMs ?? 0, 0);
    if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs))
        return 'expired';
    if (nowMs <= expiresMs)
        return 'fresh';
    return nowMs <= expiresMs + graceMs ? 'grace' : 'expired';
}
export function hashHandoffToken(token) {
    return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}
export function laneSessionPathFor(cwd, laneId) {
    return path.join(path.resolve(cwd), runtimeLaneSessionsRootRelativePath, `${safeFileId(laneId)}.json`);
}
export function atomicWriteJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
        writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        renameSync(tempPath, filePath);
    }
    finally {
        if (existsSync(tempPath))
            rmSync(tempPath, { force: true });
    }
}
function readLaneSessionFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.laneSession.v1' || !normalizeOptionalString(parsed.laneId) || !normalizeOptionalString(parsed.actorId)) {
            return null;
        }
        return {
            schemaId: 'atm.laneSession.v1',
            specVersion: '0.1.0',
            laneId: parsed.laneId.trim(),
            actorId: parsed.actorId.trim(),
            taskId: normalizeOptionalString(parsed.taskId) ?? null,
            status: normalizeStatus(parsed.status),
            createdAt: normalizeIsoString(parsed.createdAt) ?? new Date().toISOString(),
            updatedAt: normalizeIsoString(parsed.updatedAt) ?? normalizeIsoString(parsed.createdAt) ?? new Date().toISOString(),
            expiresAt: normalizeIsoString(parsed.expiresAt) ?? new Date(0).toISOString(),
            ttlMs: normalizePositiveInteger(parsed.ttlMs, 0),
            identity: normalizeIdentity(parsed.identity, parsed.actorId.trim()),
            adoptionSource: normalizeAdoptionSource(parsed.adoptionSource),
            handoffTokenHash: normalizeOptionalString(parsed.handoffTokenHash) ?? null,
            lastCommand: normalizeLastCommand(parsed.lastCommand),
            lastHeartbeatAt: normalizeIsoString(parsed.lastHeartbeatAt) ?? null
        };
    }
    catch {
        return null;
    }
}
function snapshotLaneIdentity(cwd, actorId) {
    const identity = readRuntimeIdentityForActor(cwd, actorId);
    return {
        actorId,
        editor: normalizeOptionalString(identity?.editor) ?? null,
        gitName: normalizeOptionalString(identity?.gitName) ?? null,
        gitEmail: normalizeOptionalString(identity?.gitEmail) ?? null,
        provider: normalizeOptionalString(identity?.provider) ?? null,
        activeSessionId: normalizeOptionalString(identity?.activeSessionId) ?? null
    };
}
function createLaneSessionId(cwd, actorId, taskId, timestamp) {
    const stamp = timestamp.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
    const digest = createHash('sha256')
        .update(`${path.resolve(cwd)}\n${actorId}\n${taskId ?? ''}\n${timestamp}`)
        .digest('hex')
        .slice(0, 10);
    return `lane-${stamp}-${sanitizeToken(actorId)}-${digest}`;
}
function normalizeAdoptionSource(value) {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    const kind = record.kind === 'adoption' || record.kind === 'handoff' || record.kind === 'import' ? record.kind : 'mint';
    return {
        kind,
        sourceLaneId: normalizeOptionalString(record.sourceLaneId) ?? null,
        sourceActorId: normalizeOptionalString(record.sourceActorId) ?? null,
        reason: normalizeOptionalString(record.reason) ?? null
    };
}
function normalizeIdentity(value, actorId) {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    return {
        actorId: normalizeOptionalString(record.actorId) ?? actorId,
        editor: normalizeOptionalString(record.editor) ?? null,
        gitName: normalizeOptionalString(record.gitName) ?? null,
        gitEmail: normalizeOptionalString(record.gitEmail) ?? null,
        provider: normalizeOptionalString(record.provider) ?? null,
        activeSessionId: normalizeOptionalString(record.activeSessionId) ?? null
    };
}
function normalizeLastCommand(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const command = normalizeOptionalString(record.command);
    if (!command)
        return null;
    return {
        command,
        executedAt: normalizeIsoString(record.executedAt) ?? new Date().toISOString(),
        exitCode: typeof record.exitCode === 'number' && Number.isInteger(record.exitCode) ? record.exitCode : null
    };
}
function normalizeStatus(value) {
    return value === 'handoff' || value === 'adopted' || value === 'released' || value === 'expired' ? value : 'active';
}
function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}
function normalizeIsoString(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function sanitizeToken(value) {
    const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.length > 0 ? normalized : 'lane';
}
function safeFileId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
