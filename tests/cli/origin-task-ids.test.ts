import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveHostOpenerPolicyDecision, type HostOpenerPolicyInput } from '../../packages/cli/src/commands/taskflow/host-opener-policy.ts';
import { collectOriginTaskSuffixes } from '../../packages/cli/src/commands/taskflow/origin-task-ids.ts';

mkdirSync('.atm-temp', { recursive: true });
const root = mkdtempSync(path.resolve('.atm-temp/origin-ids-'));
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const origin = path.join(root, 'origin.git');
git(root, 'init', '--bare', origin);
const writer = path.join(root, 'writer');
git(root, 'clone', origin, writer);
git(writer, 'config', 'user.name', 'fixture');
git(writer, 'config', 'user.email', 'fixture@example.test');
const card = (id: string): void => {
  mkdirSync(path.join(writer, '.atm/task-plans'), { recursive: true });
  writeFileSync(path.join(writer, '.atm/task-plans/cards.md'), `---\ntask_id: ${id}\n---\n`);
  git(writer, 'add', '.');
  git(writer, 'commit', '-m', id);
};
card('TASK-PRF-0001');
git(writer, 'branch', '-M', 'main');
git(writer, 'push', 'origin', 'main');
git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
const sessions = ['one', 'two'].map((name) => {
  const cwd = path.join(root, name);
  git(root, 'clone', origin, cwd);
  return cwd;
});
git(writer, 'switch', '-c', 'unmerged');
card('TASK-PRF-0156');
git(writer, 'push', 'origin', 'HEAD');
for (const cwd of sessions) assert.equal(Math.max(...collectOriginTaskSuffixes(cwd, 'TASK-PRF-NNNN', '.atm/task-plans')) + 1, 157);

const allocate = (cwd: string): string => resolveHostOpenerPolicyDecision({
  cwd, outputPath: '.atm/task-plans/new.md',
  profile: { taskId: { format: 'TASK-PRF-NNNN' } },
  delegationContract: { policy: {
    allocateTaskId: { mode: 'host-opener', format: 'TASK-PRF-NNNN' },
    resolveCanonicalOutputPath: { directory: '.atm/task-plans' }
  } }
} as HostOpenerPolicyInput).taskId;
for (const cwd of sessions) assert.equal(allocate(cwd), 'TASK-PRF-0157');

// A second session publishes while the first has stale remote refs.
card('TASK-PRF-0157');
git(writer, 'push', 'origin', 'HEAD');
assert.equal(Math.max(...collectOriginTaskSuffixes(sessions[0], 'TASK-PRF-NNNN', '.atm/task-plans')) + 1, 158);
assert.equal(allocate(sessions[0]), 'TASK-PRF-0158');
assert.deepEqual(collectOriginTaskSuffixes(root, 'TASK-PRF-NNNN', '.'), []);
git(sessions[1], 'remote', 'set-url', 'origin', path.join(root, 'unavailable'));
assert.throws(() => collectOriginTaskSuffixes(sessions[1], 'TASK-PRF-NNNN', '.atm/task-plans'), /Cannot discover origin task IDs/);
console.log('origin task allocation: unmerged branches, multiple sessions, refresh, non-git and unavailable origin passed');
