import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildGuidancePacket } from './guidance-packet.js';
export function createGuidanceSession(input) {
    const now = input.now ?? new Date().toISOString();
    const actor = input.actor ?? 'ATM CLI';
    const sessionId = createSessionId(input.repositoryRoot, input.goal, now);
    const packet = buildGuidancePacket({
        sessionId,
        orientation: input.orientation,
        routeDecision: input.routeDecision
    });
    const session = {
        schemaId: 'atm.guidanceSession',
        specVersion: '0.1.0',
        sessionId,
        repositoryRoot: path.resolve(input.repositoryRoot),
        goal: input.goal,
        createdAt: now,
        updatedAt: now,
        actor,
        orientation: input.orientation,
        routeDecision: input.routeDecision,
        packet,
        ...(input.legacyRoutePlan !== undefined ? { legacyRoutePlan: input.legacyRoutePlan } : {}),
        ...(input.shadowMode !== undefined ? { shadowMode: input.shadowMode } : {})
    };
    writeGuidanceSession(session);
    writeGuidanceAudit(session.repositoryRoot, {
        who: actor,
        when: now,
        action: 'guidance.start',
        reason: input.goal,
        result: session.routeDecision.recommendedRoute,
        profile: 'dev',
        sessionId
    });
    return session;
}
export function guidancePaths(repositoryRoot, sessionId) {
    const atmRoot = path.join(path.resolve(repositoryRoot), '.atm');
    return {
        activeSessionPath: path.join(atmRoot, 'runtime', 'guidance', 'active-session.json'),
        sessionsRoot: path.join(atmRoot, 'history', 'guidance', 'sessions'),
        auditLogPath: path.join(atmRoot, 'history', 'guidance', 'audit-log.jsonl'),
        proposalsRoot: path.join(atmRoot, 'history', 'guidance', 'proposals'),
        sessionPath: sessionId ? path.join(atmRoot, 'history', 'guidance', 'sessions', `${safeFileId(sessionId)}.json`) : null,
        proposalPath: sessionId ? path.join(atmRoot, 'history', 'guidance', 'proposals', `${safeFileId(sessionId)}.json`) : null
    };
}
export function writeGuidanceSession(session) {
    const paths = guidancePaths(session.repositoryRoot, session.sessionId);
    if (!paths.sessionPath)
        return;
    writeJson(paths.sessionPath, session);
    writeJson(paths.activeSessionPath, {
        schemaId: 'atm.activeGuidanceSession',
        specVersion: '0.1.0',
        sessionId: session.sessionId,
        sessionPath: path.relative(session.repositoryRoot, paths.sessionPath).replace(/\\/g, '/'),
        updatedAt: session.updatedAt
    });
}
export function readActiveGuidanceSession(repositoryRoot) {
    const paths = guidancePaths(repositoryRoot);
    const active = readJson(paths.activeSessionPath);
    if (!active?.sessionPath)
        return null;
    return readGuidanceSession(repositoryRoot, active.sessionPath.replace(/\.json$/, '').split('/').pop() ?? '');
}
export function readGuidanceSession(repositoryRoot, sessionId) {
    const paths = guidancePaths(repositoryRoot, sessionId);
    if (!paths.sessionPath || !existsSync(paths.sessionPath))
        return null;
    return readJson(paths.sessionPath);
}
export function writeGuidanceAudit(repositoryRoot, record) {
    const paths = guidancePaths(repositoryRoot);
    mkdirSync(path.dirname(paths.auditLogPath), { recursive: true });
    appendFileSync(paths.auditLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function readJson(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function createSessionId(repositoryRoot, goal, now) {
    const timestamp = now.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
    const digest = createHash('sha256').update(`${path.resolve(repositoryRoot)}\n${goal}\n${now}`).digest('hex').slice(0, 10);
    return `guidance-${timestamp}-${digest}`;
}
function safeFileId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
