import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, initializeGitRepository } from '../../../temp-workspace.js';
import { enrichCommandResult, makeResult, message } from '../../shared.js';
import { runTeam } from '../../team.js';
import { resolveTeamStartExecutionLane } from '../team-execution-lane.js';
function testExecutionLaneZeroExecuteIsBlocked() {
    const blocked = resolveTeamStartExecutionLane({
        executeRequested: true,
        providerExecutionCount: 0,
        providerResultOk: []
    });
    assert.equal(blocked.executionBlocked, true);
    assert.equal(blocked.messageCode, 'ATM_TEAM_EXECUTION_BLOCKED');
    assert.equal(blocked.messageLevel, 'error');
    assert.match(blocked.messageText, /blocked|failed/i);
}
function testExecutionLaneStateOnlyStartRemainsOk() {
    const stateOnly = resolveTeamStartExecutionLane({
        executeRequested: false,
        providerExecutionCount: 0,
        providerResultOk: []
    });
    assert.equal(stateOnly.executionBlocked, false);
    assert.equal(stateOnly.messageCode, 'ATM_TEAM_STARTED');
    assert.equal(stateOnly.messageLevel, 'info');
    assert.match(stateOnly.messageText, /no agents were spawned/i);
}
function testExecutionLaneSuccessfulExecuteIsNotBlocked() {
    const executed = resolveTeamStartExecutionLane({
        executeRequested: true,
        providerExecutionCount: 2,
        providerResultOk: [true, true]
    });
    assert.equal(executed.executionBlocked, false);
    assert.equal(executed.messageCode, 'ATM_TEAM_STARTED_EXECUTED');
}
function testExecutionLaneFailedProviderIsBlocked() {
    const failed = resolveTeamStartExecutionLane({
        executeRequested: true,
        providerExecutionCount: 1,
        providerResultOk: [false]
    });
    assert.equal(failed.executionBlocked, true);
    assert.equal(failed.messageCode, 'ATM_TEAM_EXECUTION_BLOCKED');
}
function testBlockedResultContractIsNonSuccess() {
    const lane = resolveTeamStartExecutionLane({
        executeRequested: true,
        providerExecutionCount: 0,
        providerResultOk: []
    });
    const result = enrichCommandResult(makeResult({
        ok: !lane.executionBlocked,
        command: 'team',
        cwd: process.cwd(),
        messages: [
            message(lane.messageLevel, lane.messageCode, lane.messageText, {
                executeRequested: true,
                providerExecutionCount: 0,
                providerExecutionBlockedReason: 'broker-only-runtime-never-spawns'
            })
        ],
        evidence: {
            action: 'start',
            executeRequested: true,
            providerExecutionCount: 0
        }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.blocking, true);
    assert.notEqual(result.severity, 'success');
    assert.ok(result.diagnostics.errorCodes.includes('ATM_TEAM_EXECUTION_BLOCKED'));
}
async function testTeamStartExecuteWithZeroProvidersFailsClosed() {
    const cwd = createTempWorkspace('atm-team-execute-fail-closed-');
    initializeGitRepository(cwd);
    const taskId = 'TASK-TEAM-EXECUTE-FAIL-CLOSED';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: 'Execute fail-closed fixture',
        status: 'running',
        targetRepo: 'AI-Atomic-Framework',
        scopePaths: ['docs/execute-fail-closed.md'],
        deliverables: ['docs/execute-fail-closed.md'],
        validators: ['validator']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, 'docs', 'execute-fail-closed.md'), '# Fixture\n', 'utf8');
    const zeroExecution = await runTeam([
        'start', '--task', taskId, '--actor', 'validator', '--cwd', cwd, '--execute', '--json'
    ]);
    assert.equal(zeroExecution.ok, false, 'execute with zero provider runs must not return ok:true');
    const blockedMessage = zeroExecution.messages.find((entry) => entry.code === 'ATM_TEAM_EXECUTION_BLOCKED');
    assert.ok(blockedMessage, 'must emit ATM_TEAM_EXECUTION_BLOCKED instead of ATM_TEAM_STARTED');
    assert.equal(blockedMessage?.level, 'error');
    assert.equal(blockedMessage?.data?.providerExecutionCount, 0);
    assert.equal(zeroExecution.evidence?.providerOrchestration?.results?.length, 0);
    const enriched = enrichCommandResult(zeroExecution);
    assert.equal(enriched.exitCode, 1);
    assert.equal(enriched.blocking, true);
    assert.notEqual(enriched.severity, 'success');
}
async function testTeamStartWithoutExecuteRemainsOk() {
    const cwd = createTempWorkspace('atm-team-state-only-start-');
    initializeGitRepository(cwd);
    const taskId = 'TASK-TEAM-STATE-ONLY-START';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: 'State-only start fixture',
        status: 'running',
        targetRepo: 'AI-Atomic-Framework',
        scopePaths: ['docs/state-only-start.md'],
        deliverables: ['docs/state-only-start.md'],
        validators: ['validator']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, 'docs', 'state-only-start.md'), '# Fixture\n', 'utf8');
    const stateOnly = await runTeam([
        'start', '--task', taskId, '--actor', 'validator', '--cwd', cwd, '--json'
    ]);
    assert.equal(stateOnly.ok, true, 'state-only team start must remain ok when execute is not requested');
    assert.ok(stateOnly.messages.some((entry) => entry.code === 'ATM_TEAM_STARTED'));
    assert.equal(stateOnly.evidence?.executeRequested, false);
    assert.equal(stateOnly.evidence?.providerOrchestration?.results?.length ?? 0, 0);
    const enriched = enrichCommandResult(stateOnly);
    assert.equal(enriched.exitCode, 0);
    assert.equal(enriched.blocking, false);
    assert.equal(enriched.severity, 'success');
}
testExecutionLaneZeroExecuteIsBlocked();
testExecutionLaneStateOnlyStartRemainsOk();
testExecutionLaneSuccessfulExecuteIsNotBlocked();
testExecutionLaneFailedProviderIsBlocked();
testBlockedResultContractIsNonSuccess();
await testTeamStartExecuteWithZeroProvidersFailsClosed();
await testTeamStartWithoutExecuteRemainsOk();
console.log(JSON.stringify({ ok: true, spec: 'team-execute-fail-closed.spec.ts', assertions: 6 }, null, 2));
