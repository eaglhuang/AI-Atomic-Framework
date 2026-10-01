import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { listActorWorkSessions, upsertActorWorkSession } from '../actor-session.js';
import { parseClaimRecord } from '../tasks/task-ledger-readers.js';
import { writeTaskDocumentWithTransition } from '../tasks/close-helpers/task-transition-writer.js';
export function rebindLifecycleAfterLaneAdopt(input) {
    const cwd = path.resolve(input.cwd);
    const nowIso = input.timestamp ?? new Date().toISOString();
    const reboundSessionIds = [];
    const reboundTaskIds = [];
    const preservedLeaseIds = [];
    for (const workSession of listActorWorkSessions(cwd)) {
        if (workSession.status !== 'active')
            continue;
        if (workSession.guidanceSessionId !== input.laneId)
            continue;
        upsertActorWorkSession({
            cwd,
            sessionId: workSession.sessionId,
            actorId: input.actorId,
            taskId: workSession.taskId,
            claimLeaseId: workSession.claimLeaseId,
            status: 'active',
            timestamp: nowIso,
            taskPath: workSession.taskPath,
            sourcePrompt: workSession.sourcePrompt,
            batchId: workSession.batchId,
            guidanceSessionId: input.laneId,
            editor: workSession.editor,
            gitName: workSession.gitName,
            gitEmail: workSession.gitEmail,
            reason: workSession.reason ?? `lane adopt rebind to ${input.laneId}`
        });
        reboundSessionIds.push(workSession.sessionId);
        if (workSession.claimLeaseId)
            preservedLeaseIds.push(workSession.claimLeaseId);
    }
    const taskIds = new Set();
    if (input.session.taskId)
        taskIds.add(input.session.taskId);
    for (const sessionId of reboundSessionIds) {
        const matched = listActorWorkSessions(cwd).find((entry) => entry.sessionId === sessionId);
        if (matched?.taskId)
            taskIds.add(matched.taskId);
    }
    for (const taskId of listTaskIdsWithLaneClaim(cwd, input.laneId)) {
        taskIds.add(taskId);
    }
    for (const taskId of taskIds) {
        const rebound = rebindTaskClaimLane({
            cwd,
            taskId,
            laneId: input.laneId,
            actorId: input.actorId,
            laneStatus: input.session.status
        });
        if (!rebound)
            continue;
        reboundTaskIds.push(taskId);
        preservedLeaseIds.push(rebound.leaseId);
    }
    return {
        reboundSessionIds: [...new Set(reboundSessionIds)].sort(),
        reboundTaskIds: [...new Set(reboundTaskIds)].sort(),
        preservedLeaseIds: [...new Set(preservedLeaseIds)].sort()
    };
}
function listTaskIdsWithLaneClaim(cwd, laneId) {
    const root = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(root))
        return [];
    const matches = [];
    for (const entry of readdirSync(root)) {
        if (!entry.endsWith('.json'))
            continue;
        const taskId = entry.replace(/\.json$/, '');
        const absolutePath = path.join(root, entry);
        try {
            const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
            const claim = parseClaimRecord(parsed.claim);
            if (claim?.state === 'active' && claim.laneSession?.laneSessionId === laneId) {
                matches.push(taskId);
            }
        }
        catch {
            // Ignore malformed task documents during adopt rebind.
        }
    }
    return matches;
}
function rebindTaskClaimLane(input) {
    const absolutePath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
    if (!existsSync(absolutePath))
        return null;
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const claim = parseClaimRecord(parsed.claim);
    if (!claim || claim.state !== 'active')
        return null;
    if (claim.laneSession && claim.laneSession.laneSessionId !== input.laneId)
        return null;
    // Start from the raw claim so fields the reader does not model (for example
    // intent) survive the rebind; only the owner and lane binding change.
    const nextClaim = {
        ...parsed.claim,
        ...claim,
        actorId: input.actorId,
        laneSession: {
            laneSessionId: input.laneId,
            status: input.laneStatus,
            source: claim.laneSession?.source ?? 'option',
            exportHint: claim.laneSession?.exportHint ?? `export ATM_LANE_SESSION_ID=${JSON.stringify(input.laneId)}`
        }
    };
    parsed.claim = nextClaim;
    if (parsed.owner === claim.actorId)
        parsed.owner = input.actorId;
    // Write through the governed transition writer so the claim rebind, its
    // transition event and the ledger hash land together; a raw write left
    // lastTransitionId pointing at an event whose taskSha256 no longer matched.
    const previousStatus = typeof parsed.status === 'string' ? parsed.status : null;
    writeTaskDocumentWithTransition({
        cwd: input.cwd,
        taskPath: absolutePath,
        taskId: input.taskId,
        taskDocument: parsed,
        action: 'adopt',
        actorId: input.actorId,
        previousStatus,
        command: `node atm.mjs lane adopt ${input.laneId} --actor ${input.actorId} --json`
    });
    return { leaseId: claim.leaseId };
}
