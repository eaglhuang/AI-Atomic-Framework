import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const DEFAULT_TTL_SECONDS = 1800;
export function createProposalLaneAdmission(input) {
    const deniedSharedPaths = uniquePaths([
        ...input.overlappingFiles,
        ...input.queueAdmission.queuedSharedPaths,
        ...input.queueAdmission.waitingOn.map((entry) => entry.surfacePath)
    ]);
    if (input.existingLane && input.existingLane.taskId === input.taskId && input.existingLane.status === 'active') {
        return {
            schemaId: 'atm.proposalLaneAdmission.v1',
            taskId: input.taskId,
            status: 'same-task-conflict',
            deniedSharedPaths,
            allowedPrivatePaths: [],
            reason: `Task ${input.taskId} already has active proposal lane ${input.existingLane.laneId}.`
        };
    }
    const lane = buildProposalLane({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        baseDigest: input.baseDigest,
        deniedSharedPaths,
        waitingOn: input.queueAdmission.waitingOn,
        now: input.now ?? new Date(),
        ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS
    });
    return {
        schemaId: 'atm.proposalLaneAdmission.v1',
        taskId: input.taskId,
        status: 'proposal-lane-opened',
        proposalLane: lane,
        deniedSharedPaths,
        allowedPrivatePaths: lane.allowedPrivatePaths,
        reason: 'Shared live paths remain queued; isolated proposal lane may collect runtime proposal and evidence artifacts only.'
    };
}
export function writeProposalLane(cwd, lane) {
    const lanePath = proposalLanePath(cwd, lane.taskId);
    mkdirSync(path.dirname(lanePath), { recursive: true });
    writeFileSync(lanePath, `${JSON.stringify(lane, null, 2)}\n`, 'utf8');
    return normalizeRelativePath(cwd, lanePath);
}
export function readActiveProposalLane(cwd, taskId) {
    const lanePath = proposalLanePath(cwd, taskId);
    if (!existsSync(lanePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(lanePath, 'utf8'));
        return parsed?.schemaId === 'atm.proposalLane.v1' && parsed.status === 'active' ? parsed : null;
    }
    catch {
        return null;
    }
}
export function isProposalLanePrivatePath(filePath) {
    const normalized = normalizeWorkPath(filePath);
    return normalized.startsWith('.atm/runtime/proposal-lanes/')
        || normalized.startsWith('.atm/runtime/broker-proposals/')
        || normalized.startsWith('.atm/history/evidence/')
        || normalized.startsWith('.atm/history/task-events/')
        || normalized.startsWith('.atm/history/tasks/');
}
export function isLiveSharedMutationPath(filePath) {
    const normalized = normalizeWorkPath(filePath);
    return normalized.startsWith('packages/')
        || normalized.startsWith('schemas/')
        || normalized.startsWith('scripts/')
        || normalized.startsWith('assets/')
        || normalized.startsWith('release/')
        || normalized.startsWith('dist/')
        || normalized.startsWith('build/')
        || normalized.startsWith('.atm/runtime/task-direction/')
        || normalized.startsWith('.atm/runtime/broker-shared-surface-')
        || normalized.startsWith('.atm/runtime/write-broker-')
        || normalized === '.atm/runtime/broker-proposals.json';
}
function buildProposalLane(input) {
    const createdAt = input.now.toISOString();
    const laneId = `proposal-lane-${input.now.getTime()}-${hashShort(`${input.taskId}:${input.actorId}:${input.baseDigest}`)}`;
    const durableProposalRef = `.atm/runtime/broker-proposals/${input.taskId}/${laneId}.json`;
    const allowedPrivatePaths = uniquePaths([
        `.atm/runtime/proposal-lanes/${input.taskId}.json`,
        durableProposalRef,
        `.atm/history/evidence/${input.taskId}.proposal-lane-${laneId}.json`
    ]).filter((entry) => isProposalLanePrivatePath(entry) && !isLiveSharedMutationPath(entry));
    return {
        schemaId: 'atm.proposalLane.v1',
        specVersion: '0.1.0',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId,
        baseDigest: input.baseDigest,
        allowedPrivatePaths,
        candidateSharedSurfaces: uniquePaths(input.deniedSharedPaths),
        waitingOn: input.waitingOn,
        durableProposalRef,
        status: 'active',
        heartbeatAt: createdAt,
        ttlSeconds: input.ttlSeconds,
        createdAt,
        updatedAt: createdAt
    };
}
function proposalLanePath(cwd, taskId) {
    return path.join(cwd, '.atm', 'runtime', 'proposal-lanes', `${taskId}.json`);
}
function normalizeRelativePath(cwd, absolutePath) {
    return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}
function normalizeWorkPath(value) {
    return String(value).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function uniquePaths(values) {
    return [...new Set(values.map(normalizeWorkPath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function hashShort(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}
