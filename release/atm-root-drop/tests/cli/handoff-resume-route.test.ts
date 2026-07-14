import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { resolveHandoffResumeTaskRoute, runNext } from '../../packages/cli/src/commands/next.ts';

const task = (workItemId: string, status: string, actor: string | null) => ({
  workItemId,
  title: workItemId,
  status,
  closedAt: null,
  closedByActor: null,
  closurePacket: null,
  lastTransitionId: null,
  lastTransitionAt: null,
  milestone: null,
  dependencies: [],
  taskPath: `.atm/history/tasks/${workItemId}.json`,
  format: 'json',
  sourcePlanPath: null,
  nearbyPlanPaths: [],
  scopePaths: ['src/work.ts'],
  targetRepo: 'fixture',
  planningRepo: 'fixture',
  allowPlanningMirror: false,
  planningReadOnlyPaths: [],
  planningMirrorPaths: [],
  targetAllowedFiles: ['src/work.ts'],
  closureAuthority: 'target_repo',
  activeClaimActorId: actor,
  activeClaimIntent: actor ? 'write' : null
});

const intent = (prompt: string) => ({
  schemaId: 'atm.taskIntent.v1',
  userPrompt: prompt,
  explicitTaskIds: [],
  mentionedTaskIds: [],
  mentionedPlanPaths: [],
  taskRootHints: [],
  targetRepoHints: [],
  requestedAction: 'implement',
  confidence: 0.7,
  source: 'cli-deterministic',
  ordinalScope: null,
  queueRequested: false,
  taskScopeMentioned: true
}) as any;

function withHandoff(content: string, callback: (cwd: string, prompt: string) => void) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-handoff-route-'));
  try {
    const handoff = path.join(cwd, '.atm', 'history', 'handoff', 'WORKSPACE-UNFINISHED-WORK.md');
    mkdirSync(path.dirname(handoff), { recursive: true });
    writeFileSync(handoff, content, 'utf8');
    callback(cwd, 'Read .atm/history/handoff/WORKSPACE-UNFINISHED-WORK.md and continue.');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

withHandoff('- Active task: `TASK-ACTIVE-0001`\n', (cwd, prompt) => {
  const route = resolveHandoffResumeTaskRoute(cwd, [task('TASK-ACTIVE-0001', 'running', 'captain'), task('TASK-DONE-0002', 'done', null)] as any, intent(prompt));
  assert.equal(route?.status, 'ready');
  assert.equal(route?.selectedTasks[0]?.workItemId, 'TASK-ACTIVE-0001');
});

withHandoff('- Active task: `TASK-DONE-0002`\n', (cwd, prompt) => {
  const route = resolveHandoffResumeTaskRoute(cwd, [task('TASK-DONE-0002', 'done', null), task('TASK-OTHER-0003', 'running', 'captain')] as any, intent(prompt));
  assert.equal(route?.status, 'not-found');
  assert.deepEqual(route?.diagnostics, ['handoff-file-references-no-active-claim']);
});

withHandoff('Continue the current active work; no task id is repeated here.\n', (cwd, prompt) => {
  const route = resolveHandoffResumeTaskRoute(cwd, [task('TASK-ONE-0004', 'running', 'one'), task('TASK-TWO-0005', 'running', 'two')] as any, intent(prompt));
  assert.equal(route?.status, 'ambiguous');
  assert.equal(route?.selectedTasks.length, 2);
});

const integrationCwd = mkdtempSync(path.join(os.tmpdir(), 'atm-handoff-next-route-'));
try {
  execFileSync('git', ['init'], { cwd: integrationCwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd: integrationCwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: integrationCwd, stdio: 'ignore' });
  mkdirSync(path.join(integrationCwd, '.atm', 'history', 'handoff'), { recursive: true });
  mkdirSync(path.join(integrationCwd, '.atm', 'runtime', 'identity'), { recursive: true });
  writeFileSync(path.join(integrationCwd, '.atm', 'config.json'), `${JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2, taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } })}\n`, 'utf8');
  writeFileSync(path.join(integrationCwd, '.atm', 'runtime', 'identity', 'default.json'), `${JSON.stringify({ actorId: 'captain' })}\n`, 'utf8');
  writeFileSync(path.join(integrationCwd, '.atm', 'history', 'handoff', 'WORKSPACE-UNFINISHED-WORK.md'), '- Active task: `TASK-INTEGRATION-0006`\n', 'utf8');
  writeFileSync(path.join(integrationCwd, '.atm', 'history', 'tasks.json'), '{}\n', 'utf8');
  mkdirSync(path.join(integrationCwd, '.atm', 'history', 'tasks'), { recursive: true });
  writeFileSync(path.join(integrationCwd, '.atm', 'history', 'tasks', 'TASK-INTEGRATION-0006.json'), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2', workItemId: 'TASK-INTEGRATION-0006', title: 'handoff integration', status: 'running',
    scopePaths: ['src/work.ts'], deliverables: ['src/work.ts'], targetRepo: 'fixture', closureAuthority: 'target_repo',
    source: { planPath: null }, claim: { state: 'active', actorId: 'captain', intent: 'write', files: ['src/work.ts'] }
  })}\n`, 'utf8');
  writeFileSync(path.join(integrationCwd, 'README.md'), 'fixture\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: integrationCwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: integrationCwd, stdio: 'ignore' });
  const result = await runNext(['--cwd', integrationCwd, '--prompt', 'Read .atm/history/handoff/WORKSPACE-UNFINISHED-WORK.md and continue.']) as any;
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.evidence.nextAction.selectedTask.workItemId, 'TASK-INTEGRATION-0006');
  assert.ok(result.evidence.nextAction.decisionTrail?.some((entry: any) => String(entry.reason).includes('TASK-INTEGRATION-0006')) || result.evidence.importedTaskQueue.promptScope.diagnostics.includes('handoff-file-task-reference'));
} finally {
  rmSync(integrationCwd, { recursive: true, force: true });
}

console.log('handoff-resume-route: ok');
