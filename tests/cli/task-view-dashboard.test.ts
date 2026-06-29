import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildCloseCompletionChecklist } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';
import { buildTaskViewDashboard } from '../../packages/cli/src/commands/task-view.ts';

function makeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'task-view-dashboard-'));
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(repo, '.atm', 'history', 'task-events', 'TASK-MAO-TEST-0044'), { recursive: true });
  return repo;
}

const repo = makeRepo();
const taskId = 'TASK-MAO-TEST-0044';
const transitionId = '2026-06-18T00-00-00-000Z-close-test00000001';
const closurePacketPath = `.atm/history/evidence/${taskId}.closure-packet.json`;

writeFileSync(path.join(repo, closurePacketPath), `${JSON.stringify({
  schemaId: 'atm.closurePacket.v1',
  taskId,
  targetCommit: 'abc123def456'
}, null, 2)}\n`, 'utf8');

writeFileSync(path.join(repo, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`), `${JSON.stringify({
  schemaId: 'atm.taskTransition.v1',
  transitionId,
  taskId,
  action: 'close',
  actorId: 'cursor-gpt-5.2',
  command: 'node atm.mjs tasks close --task TASK-MAO-TEST-0044 --actor cursor-gpt-5.2 --status done --waiver-out-of-scope-delivery --reason "fixture waiver"'
}, null, 2)}\n`, 'utf8');

writeFileSync(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: taskId,
  title: 'task-view fixture',
  status: 'done',
  owner: 'cursor-gpt-5.2',
  lastTransitionId: transitionId,
  closeReason: 'fixture waiver',
  closurePacket: closurePacketPath,
  claim: { state: 'released', actorId: 'cursor-gpt-5.2' },
  source: {
    planPath: '../3KLife/docs/ai_atomic_framework/multi-agent-orchestration/tasks/TASK-MAO-0044-task-view-dashboard.task.md'
  }
}, null, 2)}\n`, 'utf8');

const checklist = buildCloseCompletionChecklist({
  cwd: repo,
  taskId,
  taskDocument: JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), 'utf8')),
  triangulation: {
    liveLedger: { status: 'done' },
    planningFrontmatter: { status: 'done', source: '../3KLife/docs/ai_atomic_framework/multi-agent-orchestration/tasks/TASK-MAO-0044-task-view-dashboard.task.md' },
    lastTransitionEvent: { action: 'close', createdAt: '2026-06-18T00:00:00.000Z' }
  }
});

assert.equal(checklist.partialClose, false, 'complete close fixture must not be partial');
assert.equal(checklist.fields.find((entry) => entry.id === 'delivery-sha')?.value, 'abc123def456');
assert.equal(checklist.fields.find((entry) => entry.id === 'waiver-reason')?.ok, true);

const dashboard = buildTaskViewDashboard({
  cwd: repo,
  taskId,
  actorId: null
});

assert.equal(dashboard.readOnly, true);
assert.equal(dashboard.schemaId, 'atm.taskViewDashboard.v1');
assert.match(dashboard.nextSafeCommand, /^node atm\.mjs /);
assert.ok(dashboard.nextSafeCommand.includes('tasks import') || dashboard.nextSafeCommand.includes(taskId));

const frameworkRepo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
if (existsSync(path.join(frameworkRepo, '.atm', 'history', 'tasks', 'TASK-MAO-0043.json'))) {
  const liveDashboard = buildTaskViewDashboard({
    cwd: frameworkRepo,
    taskId: 'TASK-MAO-0043',
    actorId: 'cursor-gpt-5.2'
  });
  assert.equal(liveDashboard.partialClose, false, 'TASK-MAO-0043 should report complete close');
  assert.equal(liveDashboard.liveStatus, 'done');
}

rmSync(repo, { recursive: true, force: true });
console.log('task-view-dashboard.test.ts: ok');
