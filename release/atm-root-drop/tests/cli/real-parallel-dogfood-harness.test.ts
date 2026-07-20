import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runRealParallelDogfood, validateSummaryFile, type RealParallelDogfoodSummary } from '../../scripts/run-real-parallel-dogfood.ts';

const repoRoot = process.cwd();

const summary = await runRealParallelDogfood({ mode: 'generate' });
assert.equal(summary.schemaId, 'atm.realParallelDogfood.v1');
assert.equal(summary.taskId, 'ATM-GOV-0223');
assert.ok(summary.workerCount >= 4);
assert.ok(summary.maxSimultaneousWork >= 4);
assert.ok(summary.actualOverlapMs > 0);
assert.ok(summary.parallelAdmissionCount > 0);
assert.deepEqual(summary.sideEffectCounts, {
  silentOverwrite: 0,
  escapedConflict: 0,
  duplicateSideEffect: 0,
  unresolvedStarvation: 0
});

const findings = await validateSummaryFile(join(repoRoot, 'artifacts/generated/atm-parallel-dogfood/summary.json'));
assert.deepEqual(findings, []);

const persisted = JSON.parse(await readFile(join(repoRoot, 'artifacts/generated/atm-parallel-dogfood/summary.json'), 'utf8')) as RealParallelDogfoodSummary;
assert.equal(persisted.workers.length, summary.workerCount);
assert.equal(new Set(persisted.workers.map((worker) => worker.actorId)).size, summary.workerCount);
assert.equal(new Set(persisted.workers.map((worker) => worker.laneSessionId)).size, summary.workerCount);
assert.ok(persisted.workers.every((worker) => worker.evidenceSeal.startsWith('seal-')));
assert.ok(persisted.ticketTransitions.some((transition) => transition.to === 'parallel-admitted'));
assert.ok(persisted.ticketTransitions.some((transition) => transition.to === 'compose-ticketed'));
assert.ok(persisted.ticketTransitions.some((transition) => transition.to === 'conflict-ticketed'));

const report = await readFile(join(repoRoot, 'docs/reports/atm-2-1-real-parallel-dogfood.md'), 'utf8');
assert.match(report, /ATM 2\.1 Real Parallel Dogfood/);
assert.match(report, /maxSimultaneousWork: [4-9]/);
assert.match(report, /escapedConflict: 0/);

console.log(JSON.stringify({
  ok: true,
  taskId: summary.taskId,
  maxSimultaneousWork: summary.maxSimultaneousWork,
  actualOverlapMs: summary.actualOverlapMs,
  parallelAdmissionCount: summary.parallelAdmissionCount
}));
