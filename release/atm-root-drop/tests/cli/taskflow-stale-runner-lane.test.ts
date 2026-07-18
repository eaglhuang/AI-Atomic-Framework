import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-taskflow-stale-runner-lane-'));
const wrapperEntrypoint = path.join(repo, 'atm.mjs');

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTask(taskId: string, status = 'running', files: readonly string[] = ['packages/cli/src/commands/taskflow/implementation.ts']): void {
  const cardPath = `docs/tasks/${taskId}.task.md`;
  mkdirSync(path.join(repo, 'docs/tasks'), { recursive: true });
  writeFileSync(path.join(repo, cardPath), [
    '---',
    `task_id: ${taskId}`,
    `status: ${status}`,
    '---',
    `# ${taskId}`,
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(repo, '.atm/history/tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    status,
    related_plan: cardPath,
    source: {
      planPath: cardPath,
      sectionTitle: taskId,
      headingLine: 1,
      hash: 'fixture'
    },
    claim: {
      actorId: 'lane-captain',
      leaseId: 'lease-1',
      claimedAt: '2026-07-16T00:00:00.000Z',
      state: 'active',
      files
    }
  });
}

function initializeRepo(): void {
  mkdirSync(path.join(repo, 'release/atm-onefile'), { recursive: true });
  mkdirSync(path.join(repo, 'packages/cli/src/commands/taskflow'), { recursive: true });
  writeFileSync(wrapperEntrypoint, [
    '#!/usr/bin/env node',
    `const { runCli } = await import(${JSON.stringify(pathToFileURL(cliEntrypoint).href)});`,
    'process.exitCode = await runCli(process.argv.slice(2));',
    ''
  ].join('\n'), 'utf8');
  const runnerPath = path.join(repo, 'release/atm-onefile/atm.mjs');
  const sourcePath = path.join(repo, 'packages/cli/src/commands/taskflow/implementation.ts');
  writeFileSync(runnerPath, '// stale runner\n', 'utf8');
  writeFileSync(sourcePath, '// newer source\n', 'utf8');
  utimesSync(runnerPath, new Date('2026-07-16T00:00:00.000Z'), new Date('2026-07-16T00:00:00.000Z'));
  utimesSync(sourcePath, new Date('2026-07-16T01:00:00.000Z'), new Date('2026-07-16T01:00:00.000Z'));
  spawnSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'ATM Test'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
}

function runAtm(args: readonly string[], expectStatus = 0): Record<string, any> {
  const result = spawnSync(process.execPath, ['--strip-types', wrapperEntrypoint, ...args, '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    result.status,
    expectStatus,
    `unexpected status for ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return JSON.parse((result.stdout.trim() || result.stderr.trim()) as string) as Record<string, any>;
}

function currentHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitFixtureChange(filePath: string, content: string): void {
  writeFileSync(path.join(repo, filePath), content, 'utf8');
  spawnSync('git', ['add', filePath], { cwd: repo, stdio: 'ignore' });
  const commit = spawnSync('git', ['commit', '-m', `fixture ${filePath}`], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(commit.status, 0, commit.stderr);
}

function staleRunnerBlocker(taskId: string): Record<string, any> {
  const result = runAtm(['taskflow', 'pre-close', '--task', taskId, '--actor', 'lane-captain'], 1);
  const blockers = result.evidence.writeReadinessHint.blockers as Record<string, any>[];
  const blocker = blockers.find((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_STALE_RUNNER');
  assert.ok(blocker, `missing stale-runner blocker in ${JSON.stringify(blockers, null, 2)}`);
  return blocker;
}

try {
  initializeRepo();

  writeTask('TASK-LANE-TEST-0001');
  const notEnqueued = staleRunnerBlocker('TASK-LANE-TEST-0001');
  assert.equal(notEnqueued.queuePosition, null);
  assert.equal(notEnqueued.queueHeadHealth, 'task-active');
  assert.equal(notEnqueued.runnerGateDecision, 'required');
  assert.deepEqual(notEnqueued.runnerGateIntersectingFiles, ['packages/cli/src/commands/taskflow/implementation.ts']);
  assert.match(notEnqueued.requiredCommand, /broker runner-sync enqueue/);
  assert.match(notEnqueued.runnerSyncActionChain[0], /broker runner-sync enqueue/);
  assert.match(notEnqueued.runnerSyncActionChain.join('\n'), /ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build/);

  writeTask('TASK-LANE-DOCS-0001', 'running', ['docs/tasks/TASK-LANE-DOCS-0001.task.md', '.atm/history/tasks/TASK-LANE-DOCS-0001.json']);
  const docsOnly = runAtm(['taskflow', 'pre-close', '--task', 'TASK-LANE-DOCS-0001', '--actor', 'lane-captain'], 1);
  assert.equal(docsOnly.evidence.runnerGateDecision, 'skipped-non-code');
  assert.deepEqual(docsOnly.evidence.runnerGateIntersectingFiles, []);
  assert.equal((docsOnly.evidence.writeReadinessHint.blockers as Record<string, any>[]).some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_STALE_RUNNER'), false);

  runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-LANE-TEST-0001',
    '--actor', 'lane-captain',
    '--sealed-source-sha', currentHead(),
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);

  commitFixtureChange('packages/cli/src/commands/taskflow/implementation.ts', '// newer source after task one\n');

  writeTask('TASK-LANE-TEST-0002');
  runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-LANE-TEST-0002',
    '--actor', 'lane-captain',
    '--sealed-source-sha', currentHead(),
    '--surface', 'release/atm-root-drop/release-manifest.json'
  ]);

  const waiting = staleRunnerBlocker('TASK-LANE-TEST-0002');
  assert.equal(waiting.queuePosition, 2);
  assert.equal(waiting.queueHeadHealth, 'task-active');
  assert.match(waiting.summary, /position 2/);
  assert.match(waiting.runnerSyncActionChain[0], /broker runner-sync status/);

  writeTask('TASK-LANE-TEST-0002', 'done');
  const orphaned = staleRunnerBlocker('TASK-LANE-TEST-0002');
  assert.equal(orphaned.queueHeadHealth, 'task-terminal');
  assert.match(orphaned.requiredCommand, /broker runner-sync cleanup/);
  assert.match(orphaned.runnerSyncActionChain[0], /broker runner-sync cleanup/);

  console.log('[taskflow-stale-runner-lane.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
