import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPlan3DogfoodOrchestratorEvidence } from '../../packages/cli/src/commands/broker/replay/dogfood-orchestrator.ts';
import { selectRuntimeDogfoodTasks } from '../../packages/cli/src/commands/broker/replay/implementation.ts';
import { buildParallelReplayDogfoodEvidence } from '../../packages/core/src/broker/replay/index.ts';

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'atm-3-dogfood-ledger-'));
const taskRoot = path.join(fixtureRoot, '.atm', 'history', 'tasks');
mkdirSync(taskRoot, { recursive: true });
for (const taskId of ['ATM-DOGFOOD-A', 'ATM-DOGFOOD-B']) {
  writeFileSync(path.join(taskRoot, `${taskId}.json`), JSON.stringify({
    schemaId: 'atm.taskLedger.v1',
    id: taskId,
    status: 'planned',
    scopePaths: [
      'docs/governance/atm-3-replay-evidence.md',
      `artifacts/generated/${taskId}.json`
    ],
    deliverables: [`artifacts/generated/${taskId}.json`]
  }, null, 2));
}

const selected = selectRuntimeDogfoodTasks({
  cwd: fixtureRoot,
  requiredIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  minimum: 2
});

assert.equal(selected.length >= 2, true);
assert.equal(selected.every((entry) => ['planned', 'ready', 'running'].includes(entry.status)), true);
assert.equal(selected.some((entry) => entry.scopePaths.some((scope) => scope.includes('atm-3-replay-evidence.md'))), true);
assert.equal(new Set(selected.map((entry) => entry.taskId)).size, selected.length);
const dogfood = buildParallelReplayDogfoodEvidence({
  declaredIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  traces: selected.map((entry, index) => ({
    taskId: entry.taskId,
    actorId: `captain-${index + 1}`,
    declaredIntersection: ['docs/governance/atm-3-replay-evidence.md'],
    preservedIntersection: entry.scopePaths.includes('docs/governance/atm-3-replay-evidence.md'),
    canonicalTicketState: 'execute-now',
    waitedMs: index,
    successorWakeup: true,
    lifecycle: [
      'claim:registered-task',
      'canonical-ticket:execute-now',
      'proposal:isolated',
      'compose:shared-surface',
      'successor-wakeup:auto',
      'close-packet:sealed'
    ]
  }))
});
assert.equal(dogfood.taskCount, 2);
assert.equal(dogfood.actorCount, 2);
assert.equal(dogfood.preservedIntersection, true);
assert.equal(dogfood.terminalRefusalCount, 0);
assert.equal(dogfood.manualWakeupCount, 0);
assert.equal(dogfood.traces.every((trace) => trace.lifecycle.includes('close-packet:sealed')), true);

const orchestrator = buildPlan3DogfoodOrchestratorEvidence({
  cwd: process.cwd(),
  requiredIntersection: ['docs/governance/atm-3-replay-evidence.md']
});

assert.deepEqual(orchestrator.taskIds, ['ATM-GOV-0237', 'ATM-GOV-0238']);
assert.equal(orchestrator.safeComposeCell.verdict, 'pass');
assert.equal(orchestrator.safeComposeCell.waitedMs, 0);
assert.equal(orchestrator.safeComposeCell.canonicalWriteCount, 1);
assert.equal(orchestrator.fallbackCell.verdict, 'fail-closed');
assert.equal(orchestrator.fallbackCell.canonicalWriteCount, 0);
assert.equal(orchestrator.fallbackCell.waitedMs > 0, true);
assert.equal(orchestrator.steward.neutral, true);
assert.equal(orchestrator.terminalAuthorizationCensus.activeAuthorizationCount, 0);
assert.equal(orchestrator.terminalAuthorizationCensus.manualInterventionCount, 0);
assert.ok(orchestrator.digest.startsWith('sha256:'));

console.log('[atm-3-real-task-dogfood.test] ok');
