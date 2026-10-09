import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { runTasksClose } from '../../packages/cli/src/commands/tasks/close-orchestrator.ts';

for (const failure of ['first', 'second', 'journal', 'record-change', 'index-change', 'none'] as const) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-close-cleanup-rollback-'));
  const originalRm = fs.rmSync;
  const originalWrite = fs.writeFileSync;
  const taskId = 'TASK-PROBE-0001';
  const actor = 'cleanup-probe';
  const taskPath = path.join(root, '.atm/history/tasks', `${taskId}.json`);
  const teamDirectory = path.join(root, '.atm/runtime/team-runs');
  const first = path.join(teamDirectory, 'aaa-owned.json');
  const second = path.join(teamDirectory, 'bbb-owned.json');
  const foreign = path.join(teamDirectory, 'foreign.json');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    git('init', '-q');
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.mkdirSync(teamDirectory, { recursive: true });
    const now = new Date().toISOString();
    const taskBytes = JSON.stringify({ workItemId: taskId, title: 'Cleanup rollback', status: 'running', scopePaths: ['probe.txt'], deliverables: [], validators: [], claim: { actorId: actor, leaseId: 'probe-lease', claimedAt: now, heartbeatAt: now, ttlSeconds: 1800, state: 'active', files: ['probe.txt'] } });
    fs.writeFileSync(taskPath, taskBytes);
    const ownedBytes = JSON.stringify({ schemaId: 'atm.teamRun.v1', teamRunId: 'owned', taskId, status: 'active' });
    const foreignBytes = JSON.stringify({ schemaId: 'atm.teamRun.v1', teamRunId: 'foreign', taskId: 'TASK-OTHER-0001', status: 'active' });
    fs.writeFileSync(first, ownedBytes);
    fs.writeFileSync(second, ownedBytes);
    fs.writeFileSync(foreign, foreignBytes);
    fs.writeFileSync(path.join(root, 'probe.txt'), 'fixture');
    fs.writeFileSync(path.join(root, 'foreign.txt'), 'base');
    git('add', '.');
    git('-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-q', '-m', 'fixture');
    fs.writeFileSync(path.join(root, 'foreign.txt'), 'foreign staged work');
    git('add', '--', 'foreign.txt');
    const indexBefore = git('ls-files', '--stage');
    const injected = Object.assign(new Error(`injected ${failure} cleanup failure`), { code: 'EACCES' });
    fs.rmSync = ((target, options) => {
      if (String(target) === second && failure === 'record-change') {
        originalWrite(first, 'concurrent replacement');
        throw injected;
      }
      if (String(target) === second && failure === 'index-change') {
        originalWrite(taskPath, 'concurrent staged replacement');
        git('add', '--', path.relative(root, taskPath));
        throw injected;
      }
      if ((failure === 'first' && String(target) === first) || (failure === 'second' && String(target) === second)) throw injected;
      return originalRm(target, options);
    }) as typeof fs.rmSync;
    fs.writeFileSync = ((target, data, options) => {
      if (failure === 'journal' && String(target).endsWith(`close-journal-${taskId}.json`) && String(data).includes('"committed"')) throw injected;
      return originalWrite(target, data, options);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    let caught: unknown;
    try { await runTasksClose(['--cwd', root, '--task', taskId, '--actor', actor, '--status', 'blocked', '--reason', 'probe', '--json']); }
    catch (error) { caught = error; }
    assert.equal(fs.readFileSync(foreign, 'utf8'), foreignBytes, `${failure}: foreign run preserved`);
    assert.equal(git('show', ':foreign.txt'), 'foreign staged work', `${failure}: foreign staged bytes preserved`);
    if (failure !== 'none') {
      assert.ok(caught, `${failure}: primary operation must fail`);
      assert.equal(fs.readFileSync(taskPath, 'utf8'), taskBytes, `${failure}: task and active claim restored`);
      assert.equal(fs.readFileSync(first, 'utf8'), failure === 'record-change' ? 'concurrent replacement' : ownedBytes, `${failure}: rollback must not overwrite replacement`);
      assert.equal(fs.readFileSync(second, 'utf8'), ownedBytes, `${failure}: second record restored`);
      if (failure === 'index-change') {
        assert.equal(git('show', `:${path.relative(root, taskPath).replace(/\\/g, '/')}`), 'concurrent staged replacement');
      } else {
        assert.equal(git('ls-files', '--stage'), indexBefore, `${failure}: exact staged entries restored`);
      }
      if (failure === 'record-change' || failure === 'index-change') {
        const journal = JSON.parse(fs.readFileSync(path.join(root, '.atm-temp', `close-journal-${taskId}.json`), 'utf8'));
        assert.equal(journal.status, 'rollback-required');
        assert.equal(journal.actorId, actor);
        assert.equal(Buffer.from(journal.teamRecords[0].bytes, 'base64').toString('utf8'), ownedBytes);
        assert.match(journal.teamRecords[0].sha256, /^[a-f0-9]{64}$/);
      }
    } else {
      assert.equal(caught, undefined);
      assert.equal(fs.existsSync(first), false);
      assert.equal(fs.existsSync(second), false);
      const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
      assert.equal(task.status, 'blocked');
      assert.equal(task.claim.state, 'released');
    }
  } finally {
    fs.rmSync = originalRm;
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
    originalRm(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(root), false, `${failure}: fixture cleans its own resources`);
}
console.log('task-close-cleanup-rollback: PASS');
