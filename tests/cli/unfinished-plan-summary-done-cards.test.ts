import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-unfinished-summary-'));

function card(taskId: string, status: string) {
  return `---\ntask_id: ${taskId}\ntitle: ${taskId} title\nstatus: ${status}\n---\n\n# ${taskId}\n`;
}

try {
  const tasksDir = path.join(root, 'planning', 'fixture-lane', 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(path.join(tasksDir, 'TASK-FIX-0001.task.md'), card('TASK-FIX-0001', 'done'));
  writeFileSync(path.join(tasksDir, 'TASK-FIX-0002.task.md'), card('TASK-FIX-0002', 'planned'));
  writeFileSync(path.join(tasksDir, 'README.md'), [
    '# Fixture lane',
    '',
    '## Task Roster',
    '',
    '| Task ID | Status | Title |',
    '| --- | --- | --- |',
    // A stale README row for a card that is already done, written in another case.
    '| task-fix-0001 | planned | Done card listed by an outdated README |',
    '| TASK-FIX-0002 | planned | Open card |',
    '| TASK-FIX-0003 | planned | Planned roster item without a card |',
    ''
  ].join('\n'));

  const outPath = path.join(root, 'summary.md');
  const result = spawnSync(process.execPath, [
    '--strip-types', path.join(repoRoot, 'scripts', 'generate-unfinished-plan-summary.ts'),
    '--planning-root', path.join(root, 'planning'),
    '--no-handoff', '--no-overlay',
    '--out', outPath
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.taskCards, 1, 'only the open card is unfinished, and it is counted once');
  assert.equal(report.readmeOnly, 1, 'only the roster row with no card is README-only');
  const markdown = readFileSync(outPath, 'utf8');
  assert.equal(markdown.includes('TASK-FIX-0001'), false, 'a done card is not reopened by a stale README');
  assert.ok(markdown.includes('TASK-FIX-0003'));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: done cards are not counted as README-only work');
