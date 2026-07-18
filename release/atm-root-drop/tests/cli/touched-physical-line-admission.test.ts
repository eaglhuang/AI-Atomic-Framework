import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectTouchedPhysicalLineBudget } from '../../scripts/validate-physical-line-budget.ts';

const tempRoot = path.join(tmpdir(), `atm-touched-line-budget-${process.pid}`);
mkdirSync(path.join(tempRoot, 'packages', 'cli', 'src'), { recursive: true });
mkdirSync(path.join(tempRoot, '.atm'), { recursive: true });
writeFileSync(path.join(tempRoot, '.atm', 'config.json'), JSON.stringify({ atomization: { maxLines: 5 } }, null, 2), 'utf8');
writeFileSync(path.join(tempRoot, 'packages', 'cli', 'src', 'ok.ts'), 'export const ok = true;\n', 'utf8');
writeFileSync(path.join(tempRoot, 'packages', 'cli', 'src', 'large.ts'), Array.from({ length: 6 }, (_, index) => `export const line${index} = ${index};`).join('\n'), 'utf8');

const passing = inspectTouchedPhysicalLineBudget(tempRoot, [
  'packages/cli/src/ok.ts',
  '.atm/history/tasks/TASK-RFT-0098.json',
  'release/atm-onefile/atm.mjs'
], { taskId: 'TASK-RFT-0098', actorId: 'validator', gate: 'claim' });

assert.equal(passing.ok, true);
assert.equal(passing.mode, 'touched');
assert.equal(passing.scannedFiles, 1);
assert.equal(passing.context.taskId, 'TASK-RFT-0098');

const failing = inspectTouchedPhysicalLineBudget(tempRoot, [
  'packages/cli/src/large.ts'
], { taskId: 'TASK-RFT-0098', actorId: 'validator', gate: 'commit' });

assert.equal(failing.ok, false);
assert.equal(failing.hardViolationCount, 1);
assert.deepEqual(failing.hardViolations, [{ file: 'packages/cli/src/large.ts', lines: 6 }]);
assert.ok(failing.reproduceCommand.includes('--touched'));
assert.ok(failing.reproduceCommand.includes('--gate commit'));

console.log('[touched-physical-line-admission] ok');
