import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTaskForClaim } from '../../packages/cli/src/commands/tasks/claim-preparation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.join(os.tmpdir(), `atm-next-claim-orphaned-in-progress-${Date.now()}`);
const workspace = path.join(tempRoot, 'target');

try {
  mkdirSync(path.join(workspace, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'task-events'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(workspace, 'src'), { recursive: true });

  writeFileSync(path.join(workspace, '.atm', 'config.json'), JSON.stringify({}, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'registry.json'), JSON.stringify({ entries: [] }, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'git-baseline.json'), JSON.stringify({
    schemaId: 'atm.gitBaseline.v1',
    repoRoot: workspace,
    commit: 'HEAD'
  }, null, 2));
  writeFileSync(path.join(workspace, 'src', 'deliverable.ts'), 'export const deliverable = true;\n');

  runGit(['init']);
  runGit(['config', 'user.name', 'ATM Test']);
  runGit(['config', 'user.email', 'atm-test@example.com']);
  runGit(['add', '.']);
  runGit(['commit', '-m', 'test: baseline']);

  const taskId = 'TASK-CLAIM-ORPHAN-0001';
  const taskPath = path.join(workspace, '.atm', 'history', 'tasks', `${taskId}.json`);
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Orphaned in-progress claim adoption',
    status: 'in_progress',
    source: {
      planPath: 'docs/tasks/TASK-CLAIM-ORPHAN-0001.task.md',
      hash: 'sha256:test'
    },
    scopePaths: ['src/deliverable.ts'],
    deliverables: ['src/deliverable.ts'],
    target_repo: 'AI-Atomic-Framework',
    closure_authority: 'target_repo'
  }, null, 2)}\n`);

  const route = runAtm(['next', '--cwd', workspace, '--prompt', `Continue ${taskId}`, '--json']);
  assert.equal(route.exitCode, 0, route.stderr || route.stdout);
  assert.equal(route.parsed.evidence.importedTaskQueue.claimableTask.workItemId, taskId);

  const prepared = prepareTaskForClaim({
    cwd: workspace,
    taskId,
    actorId: 'captain',
    status: 'in_progress',
    title: 'Orphaned in-progress claim adoption',
    parseSingleCard: () => null,
    writeTaskFiles: () => ({ diagnostics: [], writtenPaths: [] }),
    writeImportEvidence: () => null
  });
  assert.equal(prepared.originalStatus, 'in_progress');
  assert.equal(prepared.finalStatus, 'ready');
  assert.deepEqual(prepared.steps.map((step) => step.action), ['reserve', 'promote']);

  const preparedTask = JSON.parse(readFileSync(taskPath, 'utf8'));
  assert.equal(preparedTask.status, 'ready');
  assert.equal(preparedTask.owner, 'captain');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[next-claim-orphaned-in-progress:test] ok');

function runGit(args: string[]) {
  const result = spawnSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8'
  });
  assert.equal(result.status ?? 0, 0, result.stderr || result.stdout);
}

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.dev.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_ACTOR_ID: 'captain'
    }
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}
