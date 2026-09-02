import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveRunnerBuildOutputInventory } from '../../packages/core/src/broker/runner-build-output-inventory.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-taskflow-stale-runner-lane-'));
const wrapperEntrypoint = path.join(repo, 'atm.mjs');

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTask(taskId: string, status = 'running', files: readonly string[] = ['packages/cli/src/commands/taskflow/implementation.ts']): void {
  const claimedAt = new Date().toISOString();
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
      claimedAt,
      heartbeatAt: claimedAt,
      ttlSeconds: 3600,
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
  commitPaths([filePath], `fixture ${filePath}`);
}

function commitPaths(filePaths: readonly string[], message: string): void {
  spawnSync('git', ['add', '--', ...filePaths], { cwd: repo, stdio: 'ignore' });
  const commit = spawnSync('git', ['commit', '-m', message], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(commit.status, 0, commit.stderr);
}

function computeBuildInputsTreeHash(commitSha = 'HEAD'): string {
  const result = spawnSync('git', [
    'ls-tree',
    '-r',
    '-z',
    commitSha,
    '--',
    'packages',
    'scripts',
    'templates',
    'schemas',
    'atomic_workbench',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json'
  ], {
    cwd: repo,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(result.status, 0, String(result.stderr));
  return `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`;
}

function writeRunnerSyncReceipt(taskId: string, sealedSourceSha: string, runnerInputTreeHash: string, options: { complete?: boolean; staleChild?: boolean } = {}): string {
  const receiptRef = `.atm/history/evidence/${taskId}.runner-sync-receipt.json`;
  const complete = options.complete !== false;
  const outputInventory = deriveRunnerBuildOutputInventory({
    sealedSourceSha,
    observedPaths: [receiptRef],
    currentTaskId: taskId,
    ownership: [{ path: receiptRef, ownerTaskId: taskId }]
  });
  writeJson(path.join(repo, receiptRef), {
    schemaId: 'atm.runnerSyncReceipt.v1',
    taskId,
    sealedSourceSha,
    memberTaskIds: [taskId],
    groupManifest: {
      memberTaskIds: [taskId]
    },
    childReceipts: complete ? [{
      taskId,
      sealedSourceSha,
      sharedSealedInputDigest: options.staleChild ? 'sha256:stale' : runnerInputTreeHash
    }] : [],
    childAttribution: {
      schemaId: 'atm.runnerSyncChildAttribution.v1',
      complete,
      members: complete ? [{ taskId }] : [],
      missingTaskIds: complete ? [] : [taskId]
    },
    lifecycle: {
      finalizable: true
    },
    outputInventory,
    runnerInputTreeHash,
    runnerInputGraph: {
      schemaId: 'atm.runnerInputGraph.v1',
      sealedSourceSha,
      aggregateInputTreeHash: runnerInputTreeHash,
      nodes: []
    }
  });
  return receiptRef;
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

  const receiptSeal = currentHead();
  const receiptInputHash = computeBuildInputsTreeHash(receiptSeal);
  writeTask('TASK-LANE-RECEIPT-0001');
  const receiptRef = writeRunnerSyncReceipt('TASK-LANE-RECEIPT-0001', receiptSeal, receiptInputHash);
  commitPaths([
    'docs/tasks/TASK-LANE-RECEIPT-0001.task.md',
    '.atm/history/tasks/TASK-LANE-RECEIPT-0001.json',
    receiptRef
  ], 'fixture receipt publication closure');
  const receiptReady = runAtm(['taskflow', 'pre-close', '--task', 'TASK-LANE-RECEIPT-0001', '--actor', 'lane-captain'], 1);
  assert.equal(receiptReady.evidence.runnerReceiptPublicationClosure.status, 'accepted');
  assert.equal((receiptReady.evidence.writeReadinessHint.blockers as Record<string, any>[]).some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_STALE_RUNNER'), false);

  const dirtyReceiptDocsTask = 'TASK-LANE-DIRTY-RECEIPT-DOCS-0001';
  const dirtyReceiptDocsSeal = currentHead();
  const dirtyReceiptDocsHash = computeBuildInputsTreeHash(dirtyReceiptDocsSeal);
  writeTask(dirtyReceiptDocsTask, 'running', [
    `.atm/history/evidence/${dirtyReceiptDocsTask}.*`,
    'docs/ERROR_CODES.md',
    'packages/cli/src/commands/taskflow/implementation.ts'
  ]);
  writeFileSync(path.join(repo, 'docs/ERROR_CODES.md'), '# Error Codes\n', 'utf8');
  const dirtyReceiptDocsReceipt = writeRunnerSyncReceipt(dirtyReceiptDocsTask, dirtyReceiptDocsSeal, dirtyReceiptDocsHash);
  commitPaths([
    `docs/tasks/${dirtyReceiptDocsTask}.task.md`,
    `.atm/history/tasks/${dirtyReceiptDocsTask}.json`,
    dirtyReceiptDocsReceipt,
    'docs/ERROR_CODES.md'
  ], 'fixture dirty receipt docs closure');
  const dirtyReceipt = JSON.parse(readFileSync(path.join(repo, dirtyReceiptDocsReceipt), 'utf8')) as Record<string, any>;
  dirtyReceipt.lifecycle.note = 'updated after durable publication';
  writeJson(path.join(repo, dirtyReceiptDocsReceipt), dirtyReceipt);
  writeFileSync(path.join(repo, 'docs/ERROR_CODES.md'), '# Error Codes\n\nRegenerated docs.\n', 'utf8');
  const dirtyReceiptDocsAllowed = runAtm(['taskflow', 'pre-close', '--task', dirtyReceiptDocsTask, '--actor', 'lane-captain'], 1);
  assert.equal(dirtyReceiptDocsAllowed.evidence.runnerReceiptPublicationClosure.status, 'accepted');
  assert.equal(dirtyReceiptDocsAllowed.evidence.historicalClosePreflight.dirtyGuard.reason, 'no-blocking-dirty-files');
  assert.deepEqual(dirtyReceiptDocsAllowed.evidence.historicalClosePreflight.scopeTrackedDirtyFiles, []);
  assert.equal((dirtyReceiptDocsAllowed.evidence.writeReadinessHint.blockers as Record<string, any>[]).some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY'), false);

  writeFileSync(path.join(repo, 'packages/cli/src/commands/taskflow/implementation.ts'), '// uncommitted runner source drift\n', 'utf8');
  const dirtySourceBlocked = runAtm(['taskflow', 'pre-close', '--task', dirtyReceiptDocsTask, '--actor', 'lane-captain'], 1);
  assert.equal(dirtySourceBlocked.evidence.runnerReceiptPublicationClosure.status, 'accepted');
  assert.ok(dirtySourceBlocked.evidence.historicalClosePreflight.scopeTrackedDirtyFiles.includes('packages/cli/src/commands/taskflow/implementation.ts'));
  assert.equal((dirtySourceBlocked.evidence.writeReadinessHint.blockers as Record<string, any>[]).some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_SCOPE_TRACKED_DIRTY'), true);

  commitFixtureChange('packages/cli/src/commands/taskflow/implementation.ts', '// runner input drift after receipt\n');
  const runnerInputDrift = runAtm(['taskflow', 'pre-close', '--task', 'TASK-LANE-RECEIPT-0001', '--actor', 'lane-captain'], 1);
  assert.equal(runnerInputDrift.evidence.runnerReceiptPublicationClosure.status, 'rebuild-required');
  assert.deepEqual(runnerInputDrift.evidence.runnerReceiptPublicationClosure.runnerAffectingDeltaPaths, ['packages/cli/src/commands/taskflow/implementation.ts']);
  assert.equal((runnerInputDrift.evidence.writeReadinessHint.blockers as Record<string, any>[]).some((entry) => entry.code === 'ATM_TASKFLOW_PRECLOSE_STALE_RUNNER'), true);

  const missingAttributionSeal = currentHead();
  const missingAttributionHash = computeBuildInputsTreeHash(missingAttributionSeal);
  writeTask('TASK-LANE-MISSING-ATTR-0001');
  const missingAttributionReceipt = writeRunnerSyncReceipt('TASK-LANE-MISSING-ATTR-0001', missingAttributionSeal, missingAttributionHash, { complete: false });
  commitPaths([
    'docs/tasks/TASK-LANE-MISSING-ATTR-0001.task.md',
    '.atm/history/tasks/TASK-LANE-MISSING-ATTR-0001.json',
    missingAttributionReceipt
  ], 'fixture missing receipt attribution');
  const missingAttribution = runAtm(['taskflow', 'pre-close', '--task', 'TASK-LANE-MISSING-ATTR-0001', '--actor', 'lane-captain'], 1);
  assert.equal(missingAttribution.evidence.runnerReceiptPublicationClosure.status, 'rebuild-required');
  assert.match(missingAttribution.evidence.runnerReceiptPublicationClosure.reason, /attribution/i);

  const staleChildSeal = currentHead();
  const staleChildHash = computeBuildInputsTreeHash(staleChildSeal);
  writeTask('TASK-LANE-STALE-CHILD-0001');
  const staleChildReceipt = writeRunnerSyncReceipt('TASK-LANE-STALE-CHILD-0001', staleChildSeal, staleChildHash, { staleChild: true });
  commitPaths([
    'docs/tasks/TASK-LANE-STALE-CHILD-0001.task.md',
    '.atm/history/tasks/TASK-LANE-STALE-CHILD-0001.json',
    staleChildReceipt
  ], 'fixture stale child receipt');
  const staleChild = runAtm(['taskflow', 'pre-close', '--task', 'TASK-LANE-STALE-CHILD-0001', '--actor', 'lane-captain'], 1);
  assert.equal(staleChild.evidence.runnerReceiptPublicationClosure.status, 'rebuild-required');
  assert.match(staleChild.evidence.runnerReceiptPublicationClosure.reason, /stale/i);

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
