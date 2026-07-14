import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../next.js';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-fresh-reservation-'));
function writeFixtureJson(relativePath, value) {
    const filePath = path.join(cwd, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
try {
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd, stdio: 'ignore' });
    writeFixtureJson('.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
    writeFixtureJson('.atm/runtime/identity/default.json', { actorId: 'codex-captain', gitName: 'ATM Fixture', gitEmail: 'fixture@example.invalid', updatedAt: '2026-07-13T00:00:00.000Z' });
    mkdirSync(path.join(cwd, 'planning/tasks'), { recursive: true });
    writeFileSync(path.join(cwd, 'planning/tasks/TASK-FRESH.task.md'), [
        '---',
        'owner: claude-fable-5',
        'createdAt: 2026-07-13T00:00:00.000Z',
        '---',
        '',
        '# TASK-FRESH'
    ].join('\n'));
    writeFixtureJson('.atm/history/tasks/TASK-FRESH.json', {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: 'TASK-FRESH',
        title: 'Fresh foreign task',
        status: 'open',
        owner: 'codex-captain',
        importedAt: new Date().toISOString(),
        scopePaths: ['packages/integrations-core/src/compiler/compile.ts'],
        targetRepo: 'fixture',
        closureAuthority: 'target_repo',
        source: { planPath: 'planning/tasks/TASK-FRESH.task.md' }
    });
    mkdirSync(path.join(cwd, 'packages/integrations-core/src/compiler'), { recursive: true });
    writeFileSync(path.join(cwd, 'packages/integrations-core/src/compiler/compile.ts'), 'export const compile = true;\n');
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
    console.log('fresh-task-reservation: ok');
}
finally {
    rmSync(cwd, { recursive: true, force: true });
}
