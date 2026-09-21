import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGitLease } from './lease-command.ts';

const cwd = path.join(os.tmpdir(), `atm-stage-override-released-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const stagedPath = '.atm/history/tasks/TASK-FOREIGN.json';

try {
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd });
  execFileSync('git', ['config', 'user.email', 'atm-test@example.invalid'], { cwd });
  writeFileSync(path.join(cwd, stagedPath), '{"taskId":"TASK-FOREIGN","status":"blocked"}\n', 'utf8');
  execFileSync('git', ['add', stagedPath], { cwd });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd });

  writeFileSync(path.join(cwd, stagedPath), '{"taskId":"TASK-FOREIGN","status":"blocked","residue":true}\n', 'utf8');
  execFileSync('git', ['add', stagedPath], { cwd });

  const result = runGitLease({
    cwd,
    taskId: 'TASK-CURRENT',
    actorId: 'test-actor',
    leaseKind: 'stage-override',
    paths: [stagedPath],
    overrideReason: 'approved recovery test',
    ttlSeconds: 900,
  }) as any;

  assert.equal(result.ok, true, 'released foreign staged records must be leaseable for explicit recovery');
  const leasePath = result.evidence.leasePath as string;
  assert.equal(existsSync(path.join(cwd, leasePath)), true);
  const lease = JSON.parse(readFileSync(path.join(cwd, leasePath), 'utf8')) as any;
  assert.deepEqual(lease.paths, [stagedPath]);
  assert.deepEqual(lease.stagedEntries.map((entry: any) => entry.path), [stagedPath]);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('lease-command released staged ownership test passed');
