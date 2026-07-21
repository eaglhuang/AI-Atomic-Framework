import assert from 'node:assert/strict';
import { selectRuntimeDogfoodTasks } from '../../packages/cli/src/commands/broker/replay/implementation.ts';

const selected = selectRuntimeDogfoodTasks({
  cwd: process.cwd(),
  requiredIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  minimum: 1
});

assert.equal(selected.length >= 1, true);
assert.equal(selected.every((entry) => ['planned', 'ready', 'running'].includes(entry.status)), true);
assert.equal(selected.some((entry) => entry.scopePaths.some((scope) => scope.includes('atm-3-replay-evidence.md'))), true);

console.log('[atm-3-real-task-dogfood.test] ok');
