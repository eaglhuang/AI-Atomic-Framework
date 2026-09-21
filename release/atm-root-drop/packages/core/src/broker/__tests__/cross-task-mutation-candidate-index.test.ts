import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCrossTaskMutation } from '../cross-task-mutation-guard.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-index-'));
const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
mkdirSync(taskDir, { recursive: true });
for (const [taskId, scope] of [['TASK-A', 'src/a.ts'], ['TASK-B', 'src/b.ts']] as const) {
  writeFileSync(path.join(taskDir, `${taskId}.json`), JSON.stringify({ workItemId: taskId, status: 'running', claim: { state: 'active', actorId: taskId, files: [scope] } }));
}

assert.equal(detectCrossTaskMutation(cwd, 'TASK-A', 'pre-commit', ['src/a.ts']), null,
  'a candidate index must not inherit unrelated live worktree mutations');
const block = detectCrossTaskMutation(cwd, 'TASK-A', 'pre-commit', ['src/a.ts', 'src/b.ts']);
assert.equal(block?.conflictTaskId, 'TASK-B', 'a foreign path inside the candidate index remains blocked');
console.log('[cross-task-mutation-candidate-index] ok');
