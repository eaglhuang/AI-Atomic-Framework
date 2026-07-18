import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { createOrRefreshTaskQueue, type TaskDirectionTask } from '../../packages/cli/src/commands/task-direction.ts';
import { writeBatchRun } from '../../packages/cli/src/commands/work-channels.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function task(taskId: string): TaskDirectionTask {
  return { workItemId: taskId, title: taskId, dependencies: [], taskPath: `.atm/history/tasks/${taskId}.json`, sourcePlanPath: `planning/${taskId}.task.md`, nearbyPlanPaths: [], scopePaths: ['packages/cli/src/commands/batch/implementation.ts'], targetRepo: 'AI-Atomic-Framework', allowPlanningMirror: false };
}

async function buildFixture() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'strict-ab-dogfood-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'strict-ab-dogfood'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'strict-ab-dogfood@example.test'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, 'README.md'), 'strict ab dogfood fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  const tasks = [task('TASK-AB-A'), task('TASK-AB-B'), task('TASK-AB-C')];
  for (const entry of tasks) writeJson(path.join(repo, entry.taskPath), { schemaVersion: 'atm.workItem.v0.2', workItemId: entry.workItemId, title: entry.title, status: 'ready', targetRepo: 'AI-Atomic-Framework', scopePaths: entry.scopePaths, deliverables: entry.scopePaths, validators: ['npm run typecheck'] });
  const queue = createOrRefreshTaskQueue({ cwd: repo, sourcePrompt: 'strict ab dogfood fixture', tasks, actorId: 'validator', taskIds: tasks.map((entry) => entry.workItemId) });
  const batchRun = writeBatchRun({ cwd: repo, sourcePrompt: 'strict ab dogfood fixture', tasks, queue, actorId: 'validator' });
  createOrRefreshTaskQueue({ cwd: repo, sourcePrompt: 'strict ab dogfood fixture', tasks, actorId: 'validator', taskIds: tasks.map((entry) => entry.workItemId), batchId: batchRun.batchId, scopeKey: batchRun.scopeKey });
  return { repo, batchRun };
}

async function testAutoBatchCircuitBreaker() {
  const { repo, batchRun } = await buildFixture();
  const prior = process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN;
  try {
    const off = await runBatch(['current', '--cwd', repo, '--batch', batchRun.batchId, '--compact', '--auto-batch', 'off', '--json']);
    const offWave = (off.evidence as any).current.currentWave;
    assert.equal(offWave.status, 'serial-fallback');
    assert.equal(offWave.autoBatch.enabled, false);
    assert.equal(offWave.autoBatch.reason, '--auto-batch off');
    process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN = '1';
    const circuit = await runBatch(['current', '--cwd', repo, '--batch', batchRun.batchId, '--compact', '--json']);
    assert.equal((circuit.evidence as any).current.currentWave.autoBatch.reason, 'ATM_AUTO_BATCH_CIRCUIT_OPEN');
    delete process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN;
    const enabled = await runBatch(['current', '--cwd', repo, '--batch', batchRun.batchId, '--compact', '--auto-batch-max-wave-size', '2', '--auto-batch-collection-timeout-ms', '250', '--json']);
    const wave = (enabled.evidence as any).current.currentWave;
    assert.equal(wave.status, 'wave-ready');
    assert.equal(wave.autoBatch.enabled, true);
    assert.equal(wave.autoBatch.maxWaveSize, 2);
    assert.equal(wave.autoBatch.collectionTimeoutMs, 250);
    assert.deepEqual(wave.selectedTaskIds, ['TASK-AB-A', 'TASK-AB-B']);
  } finally {
    if (prior === undefined) delete process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN;
    else process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN = prior;
    rmSync(repo, { recursive: true, force: true });
  }
}

async function testAnalyzerRolloutVerdict() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'strict-ab-analyzer-'));
  try {
    const laneRoot = path.join(repo, '.atm/history/session-events/lane-ab');
    mkdirSync(laneRoot, { recursive: true });
    const events = [
      { schemaId: 'atm.laneSessionEvent.v1', eventId: 'a', laneId: 'lane-ab', createdAt: '2026-07-18T00:00:00.000Z', action: 'broker-ticket', actorId: 'a', taskId: 'TASK-A', details: { brokerTicket: { ticketId: 'a', waitedMs: 10, batchEligible: true, waveId: 'wave-ab', sharedSurface: 'commit' } } },
      { schemaId: 'atm.laneSessionEvent.v1', eventId: 'b', laneId: 'lane-ab', createdAt: '2026-07-18T00:00:01.000Z', action: 'broker-ticket', actorId: 'b', taskId: 'TASK-B', details: { brokerTicket: { ticketId: 'b', waitedMs: 20, batchEligible: true, waveId: 'wave-ab', sharedSurface: 'build' } } },
      { schemaId: 'atm.laneSessionEvent.v1', eventId: 'c', laneId: 'lane-ab', createdAt: '2026-07-18T00:00:02.000Z', action: 'broker-ticket', actorId: 'c', taskId: 'TASK-C', details: { brokerTicket: { ticketId: 'c', waitedMs: 30, batchEligible: true, waveId: 'wave-ab', sharedSurface: 'projection' } } }
    ];
    events.forEach((event, index) => writeJson(path.join(laneRoot, `${index}.json`), event));
    const output = execFileSync(process.execPath, ['--strip-types', 'scripts/analyze-captain-parallel-ledger.ts', '--session-event-root', path.join(repo, '.atm/history/session-events'), '--json'], { cwd: process.cwd(), encoding: 'utf8' });
    const parsed = JSON.parse(output);
    assert.equal(parsed.autoBatchPipeline.rolloutVerdict.verdict, 'improved');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

await testAutoBatchCircuitBreaker();
await testAnalyzerRolloutVerdict();

console.log('[strict-paired-ab-dogfood.test] ok');
