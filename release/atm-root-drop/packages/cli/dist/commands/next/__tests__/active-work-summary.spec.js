import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildActiveWorkSummary } from '../../next.js';
function fail(message) {
    console.error(`[active-work-summary.spec] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-active-work-summary-'));
try {
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
    const ownFoundationFile = 'packages/cli/src/commands/next.ts';
    const stagedFile = 'packages/cli/src/commands/tasks/import-orchestrator.ts';
    mkdirSync(path.join(repo, path.dirname(ownFoundationFile)), { recursive: true });
    mkdirSync(path.join(repo, path.dirname(stagedFile)), { recursive: true });
    writeFileSync(path.join(repo, ownFoundationFile), 'export const x = 1;\n', 'utf8');
    writeFileSync(path.join(repo, stagedFile), 'export const y = 1;\n', 'utf8');
    execFileSync('git', ['add', stagedFile], { cwd: repo, stdio: 'ignore' });
    writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-FABLE.json'), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-FABLE',
        title: 'Fable active task',
        status: 'running',
        claim: {
            state: 'active',
            actorId: 'claude-fable-5',
            intent: 'write',
            claimedAt: '2026-07-13T07:50:00.000Z',
            heartbeatAt: new Date().toISOString(),
            ttlSeconds: 1800,
            files: [ownFoundationFile]
        }
    });
    writeJson(path.join(repo, '.atm', 'runtime', 'locks', 'TASK-FABLE.lock.json'), {
        schemaId: 'atm.governanceScopeLock',
        workItemId: 'TASK-FABLE',
        actorId: 'claude-fable-5',
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 1800,
        files: [ownFoundationFile]
    });
    writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-FRESH-FABLE.json'), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-FRESH-FABLE',
        title: 'Fresh Fable task',
        status: 'open',
        owner: 'claude-fable-5',
        importedAt: new Date().toISOString(),
        scopePaths: ['packages/integrations-core/src/compiler/compile.ts']
    });
    writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-SAME-ACTOR.json'), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-SAME-ACTOR',
        title: 'Same actor different session task',
        status: 'running',
        claim: {
            state: 'active',
            actorId: 'codex-captain',
            leaseId: 'lease-same-actor-foreign-session',
            intent: 'write',
            claimedAt: '2026-07-13T08:00:00.000Z',
            heartbeatAt: new Date().toISOString(),
            ttlSeconds: 1800,
            files: ['packages/cli/src/commands/next/playbook-projection.ts']
        }
    });
    writeJson(path.join(repo, '.atm', 'runtime', 'sessions', 'session-same-actor-foreign.json'), {
        schemaId: 'atm.actorWorkSession.v1',
        specVersion: '0.1.0',
        sessionId: 'session-same-actor-foreign',
        actorId: 'codex-captain',
        taskId: 'TASK-SAME-ACTOR',
        claimLeaseId: 'lease-same-actor-foreign-session',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        taskPath: '.atm/history/tasks/TASK-SAME-ACTOR.json',
        sourcePrompt: null,
        batchId: null,
        guidanceSessionId: null,
        editor: 'cursor',
        gitName: 'Other Captain',
        gitEmail: 'other-captain@example.invalid'
    });
    const summary = buildActiveWorkSummary(repo, 'codex-captain', [ownFoundationFile, 'packages/integrations-core/src/compiler/compile.ts']);
    assert(summary.activeClaimCount === 2, 'active claim count must include foreign task claim and same-actor foreign session claim');
    assert(summary.freshReservationCount === 1, 'fresh reservation count must include newly opened foreign task');
    assert(summary.hasForeignActiveWork === true, 'foreign active work must enable the broker recommendation');
    assert(summary.brokerRecommendation.enabled === true, 'broker recommendation must be enabled');
    assert(summary.brokerRecommendation.reason?.includes('other active session(s)'), 'same actor different session must be visible in the broker reason');
    assert(summary.teamLevelRecommendation.level === 'L5', 'framework foundation overlap plus staged index must recommend L5');
    assert(summary.teamLevelRecommendation.foreignSessions.includes('session-same-actor-foreign'), 'same actor different session must be treated as foreign session work');
    assert(summary.teamLevelRecommendation.overlappingFiles.includes(ownFoundationFile), 'overlapping file must be reported');
    assert(summary.freshReservations.some((reservation) => reservation.actorId === 'claude-fable-5'), 'fresh reservation owner must be visible');
    assert(summary.activeActors.some((actor) => actor.actorId === 'claude-fable-5'), 'foreign actor must be visible');
    const sameActorSummary = summary.activeActors.find((actor) => actor.actorId === 'codex-captain');
    assert(sameActorSummary?.sessionIds.includes('session-same-actor-foreign'), 'active actor summary must expose session ids');
    assert(sameActorSummary?.editors.includes('cursor'), 'active actor summary must expose editor identity');
    const sameActorClaim = summary.activeClaims.find((claim) => claim.taskId === 'TASK-SAME-ACTOR');
    assert(sameActorClaim?.sessionId === 'session-same-actor-foreign', 'active claim must expose session id');
    assert(sameActorClaim?.editor === 'cursor', 'active claim must expose editor id');
    assert(summary.stagedFiles.includes(stagedFile), 'shared staged index files must be visible');
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
console.log('[active-work-summary.spec] ok');
