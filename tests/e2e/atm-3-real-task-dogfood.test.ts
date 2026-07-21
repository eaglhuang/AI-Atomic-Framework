import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectRuntimeDogfoodTasks } from '../../packages/cli/src/commands/broker/replay/implementation.ts';

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

console.log('[atm-3-real-task-dogfood.test] ok');
