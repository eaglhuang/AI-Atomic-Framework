import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-source-first-close-'));
const taskId = 'TASK-SOURCE-FIRST-CLOSE';
const actorId = 'source-first-validator';
const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);

try {
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'source-first close must not write',
    status: 'running',
    owner: actorId,
    claim: { state: 'active', actorId, intent: 'write' },
    deliverables: ['src/owned.ts'],
    scopePaths: ['src/owned.ts'],
    validators: []
  }, null, 2)}\n`, 'utf8');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'owned.ts'), 'export const owned = true;\n', 'utf8');
  const beforeTask = readFileSync(taskPath, 'utf8');

  const result = spawnSync(process.execPath, [
    path.join(root, 'atm.dev.mjs'), 'tasks', 'close',
    '--cwd', repo,
    '--task', taskId,
    '--actor', actorId,
    '--status', 'done',
    '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1, `source-first close must fail closed: ${result.stderr}`);
  const payload = JSON.parse(result.stderr) as { diagnostics?: { errorCodes?: string[] } };
  assert.deepEqual(payload.diagnostics?.errorCodes, ['ATM_SOURCE_FIRST_WRITE_REFUSED']);
  assert.equal(readFileSync(taskPath, 'utf8'), beforeTask, 'source-first close must leave the task ledger byte-identical');
  assert.equal(existsSync(path.join(repo, '.atm', 'history', 'task-events', taskId)), false, 'source-first close must not create a transition event');
  assert.equal(existsSync(path.join(repo, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`)), false, 'source-first close must not create a closure packet');
  assert.equal(existsSync(path.join(repo, '.atm-temp', `close-journal-${taskId}.json`)), false, 'source-first close must not leave a transaction journal');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[taskflow-source-first-close-no-write.test] ok');
