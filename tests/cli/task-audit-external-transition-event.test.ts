import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { auditTasks } from '../../packages/cli/src/commands/framework-development.ts';

// A planning repository mirrors task cards whose closure belongs to another
// repository. Their lastTransitionId names an event in that target repository,
// so the planning repository must not demand the event file locally.
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-audit-external-transition-'));
const git = (args: readonly string[]) => execFileSync('git', [...args], { cwd: tempRoot, stdio: 'ignore' });

function writeCard(taskId: string, extra: readonly string[]) {
  mkdirSync(path.join(tempRoot, 'docs', 'tasks'), { recursive: true });
  writeFileSync(path.join(tempRoot, 'docs', 'tasks', `${taskId}.task.md`), [
    '---', `task_id: ${taskId}`, 'status: done', ...extra,
    `lastTransitionId: "2026-06-10T14-28-27-714Z-close-${taskId.slice(-4)}0000000"`, '---', '', `# ${taskId}`
  ].join('\n'), 'utf8');
}

try {
  writeFileSync(path.join(tempRoot, 'package.json'), '{"name":"planning-fixture","type":"module"}\n', 'utf8');
  git(['init', '-q']);
  git(['config', '--local', 'user.name', 'test-actor']);
  git(['config', '--local', 'user.email', 'test-actor@example.local']);
  writeCard('TASK-EXT-0001', ['targetRepo: some-other-target-repo', 'closure_authority: target_repo']);
  writeCard('TASK-LOC-0001', []);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'cards']);

  const missing = auditTasks(tempRoot).findings
    .filter((entry) => entry.code === 'ATM_TASK_AUDIT_TRANSITION_EVENT_MISSING')
    .map((entry) => entry.taskId);
  assert.ok(!missing.includes('TASK-EXT-0001'), 'external target task must not require a local transition event');
  assert.ok(missing.includes('TASK-LOC-0001'), 'local task still requires its transition event');
  console.log('task audit external transition event: ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
