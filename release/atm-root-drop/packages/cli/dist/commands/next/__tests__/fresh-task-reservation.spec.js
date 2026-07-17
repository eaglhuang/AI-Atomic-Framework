import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../next.js';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-fresh-reservation-'));
const originalLaneEnv = process.env.ATM_LANE_SESSION_ID;
function writeFixtureJson(relativePath, value) {
    const filePath = path.join(cwd, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writeFreshTaskFixture(input) {
    const taskCardPath = `planning/tasks/${input.taskId}.task.md`;
    writeFileSync(path.join(cwd, taskCardPath), [
        '---',
        `owner: ${input.owner}`,
        'createdAt: 2026-07-13T00:00:00.000Z',
        '---',
        '',
        `# ${input.taskId}`
    ].join('\n'));
    writeFixtureJson(`.atm/history/tasks/${input.taskId}.json`, {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: input.taskId,
        title: `Fresh task ${input.taskId}`,
        status: 'open',
        owner: input.owner,
        importedAt: new Date().toISOString(),
        scopePaths: [input.scopePath],
        targetRepo: 'fixture',
        closureAuthority: 'target_repo',
        ...(input.laneSessionId ? { laneSessionId: input.laneSessionId } : {}),
        source: { planPath: taskCardPath }
    });
    mkdirSync(path.join(cwd, path.dirname(input.scopePath)), { recursive: true });
    writeFileSync(path.join(cwd, input.scopePath), `export const ${input.taskId.replace(/[^A-Za-z0-9_]/g, '_')} = true;\n`);
}
try {
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd, stdio: 'ignore' });
    writeFixtureJson('.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
    writeFixtureJson('.atm/runtime/identity/default.json', { actorId: 'codex-captain', gitName: 'ATM Fixture', gitEmail: 'fixture@example.invalid', updatedAt: '2026-07-13T00:00:00.000Z' });
    mkdirSync(path.join(cwd, 'planning/tasks'), { recursive: true });
    writeFreshTaskFixture({
        taskId: 'TASK-FRESH',
        owner: 'claude-fable-5',
        scopePath: 'packages/integrations-core/src/compiler/compile.ts'
    });
    execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture base'], { cwd, stdio: 'ignore' });
    await assert.rejects(() => runNext(['--cwd', cwd, '--claim', '--task', 'TASK-FRESH', '--actor', 'codex-captain', '--auto-intent']), (error) => {
        assert.equal(error.code, 'ATM_NEXT_FRESH_FOREIGN_TASK_RESERVED');
        assert.equal(error.details?.reservedByActorId, 'claude-fable-5');
        assert.equal(error.details?.teamLevelRecommendation?.level, 'L5');
        assert.match(error.details?.overrideCommand ?? '', /--force/);
        return true;
    });
    const forced = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-FRESH', '--actor', 'codex-captain', '--auto-intent', '--force']);
    assert.equal(forced.ok, true, 'explicit --force should allow a governed takeover after the guard explains the reservation');
    process.env.ATM_LANE_SESSION_ID = 'lane-current';
    writeFreshTaskFixture({
        taskId: 'TASK-SAME-ACTOR-OTHER-LANE',
        owner: 'codex-captain',
        scopePath: 'packages/integrations-core/src/compiler/other-lane.ts',
        laneSessionId: 'lane-other'
    });
    await assert.rejects(() => runNext(['--cwd', cwd, '--claim', '--task', 'TASK-SAME-ACTOR-OTHER-LANE', '--actor', 'codex-captain', '--auto-intent']), (error) => {
        assert.equal(error.code, 'ATM_NEXT_FRESH_FOREIGN_TASK_RESERVED');
        assert.equal(error.details?.reservedByActorId, 'codex-captain');
        assert.equal(error.details?.reservedByLaneSessionId, 'lane-other');
        assert.equal(error.details?.currentLaneSessionId, 'lane-current');
        return true;
    });
    writeFreshTaskFixture({
        taskId: 'TASK-SAME-ACTOR-SAME-LANE',
        owner: 'codex-captain',
        scopePath: 'packages/integrations-core/src/compiler/same-lane.ts',
        laneSessionId: 'lane-current'
    });
    const sameLane = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-SAME-ACTOR-SAME-LANE', '--actor', 'codex-captain', '--auto-intent']);
    assert.equal(sameLane.ok, true, 'same actor and same lane should keep reservation reuse behavior');
    writeFreshTaskFixture({
        taskId: 'TASK-SAME-ACTOR-LEGACY',
        owner: 'codex-captain',
        scopePath: 'packages/integrations-core/src/compiler/legacy.ts'
    });
    const legacyActorOnly = await runNext(['--cwd', cwd, '--claim', '--task', 'TASK-SAME-ACTOR-LEGACY', '--actor', 'codex-captain', '--auto-intent']);
    assert.equal(legacyActorOnly.ok, true, 'actor-only legacy reservations should remain claimable by the same actor');
    if (originalLaneEnv === undefined) {
        delete process.env.ATM_LANE_SESSION_ID;
    }
    else {
        process.env.ATM_LANE_SESSION_ID = originalLaneEnv;
    }
    console.log('fresh-task-reservation: ok');
}
finally {
    if (originalLaneEnv === undefined) {
        delete process.env.ATM_LANE_SESSION_ID;
    }
    else {
        process.env.ATM_LANE_SESSION_ID = originalLaneEnv;
    }
    rmSync(cwd, { recursive: true, force: true });
}
