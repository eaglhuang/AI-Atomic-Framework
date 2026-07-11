import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCrossTaskMutation } from '../cross-task-mutation-guard.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-cross-task-guard-'));

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });

writeJson(path.join(repo, '.atm/history/tasks/TASK-A.json'), {
  workItemId: 'TASK-A',
  status: 'running',
  claim: {
    actorId: 'actor-a',
    state: 'active',
    files: ['src/a.ts', '.atm/history/evidence/TASK-A.*']
  }
});
writeJson(path.join(repo, '.atm/history/tasks/TASK-B.json'), {
  workItemId: 'TASK-B',
  status: 'running',
  claim: {
    actorId: 'actor-b',
    state: 'active',
    files: ['src/b.ts', '.atm/history/evidence/TASK-B.*']
  }
});
writeText(path.join(repo, 'src/a.ts'), 'export const a = 1;\n');
writeText(path.join(repo, 'src/b.ts'), 'export const b = 1;\n');
writeText(path.join(repo, '.atm/history/evidence/TASK-B.json'), '{}\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });

writeText(path.join(repo, 'src/b.ts'), 'export const b = 2;\n');
writeText(path.join(repo, '.atm/history/evidence/TASK-B.json'), '{"changed":true}\n');
writeText(path.join(repo, '.atm/history/evidence/git-head.jsonl'), '{}\n');
execFileSync('git', ['add', 'src/b.ts', '.atm/history/evidence/TASK-B.json'], { cwd: repo, stdio: 'ignore' });

const block = detectCrossTaskMutation(repo, 'TASK-A', 'pre-commit');

assert.ok(block, 'TASK-A must be blocked from mutating TASK-B owned files');
assert.equal(block.conflictTaskId, 'TASK-B');
assert.equal(block.commandFamily, 'pre-commit');
assert.deepEqual(block.conflictFiles, ['.atm/history/evidence/TASK-B.json', 'src/b.ts']);
assert.match(block.recoveryLane, /Stop write-path work/);
assert.deepEqual(
  block.conflicts.map((entry) => [entry.conflictTaskId, entry.owner, entry.surface, entry.conflictFiles]),
  [
    ['TASK-B', 'TASK-B', 'task-history', ['.atm/history/evidence/TASK-B.json']],
    ['TASK-B', 'actor-b', 'active-task-scope', ['src/b.ts']]
  ]
);

assert.equal(detectCrossTaskMutation(repo, 'TASK-B', 'pre-commit'), null);

execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: repo, stdio: 'ignore' });
writeText(path.join(repo, 'src/b.ts'), 'export const b = 3;\n');
assert.equal(detectCrossTaskMutation(repo, 'TASK-A', 'pre-commit'), null);
assert.ok(detectCrossTaskMutation(repo, 'TASK-A', 'restore'), 'destructive command families inspect unstaged mutations');

console.log('[cross-task-mutation-guard.test] ok');
