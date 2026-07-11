import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');
const tasksFacade = read('packages/cli/src/commands/tasks.ts');
const facadeLines = tasksFacade.split(/\r?\n/).length;

assert.ok(facadeLines < 1000, `tasks.ts facade is ${facadeLines} lines, expected under 1000`);
for (const forbidden of [
  'function parsePlanMarkdown',
  'function parseSingleCard',
  'function writeTaskFiles',
  'function writeImportEvidence',
  'function runTasksScopeAdd',
  'function runTasksScopeRepair',
  'function runTasksQueue',
  'function runTasksParallel',
  'function runTasksLockCleanup'
]) {
  assert.ok(!tasksFacade.includes(forbidden), `tasks.ts still defines ${forbidden}`);
}

for (const required of [
  'packages/atm-markdown-task-source/src/task-card-parser.ts',
  'packages/cli/src/commands/tasks/task-card-writer.ts',
  'packages/cli/src/commands/tasks/scope-queue.ts'
]) {
  assert.ok(read(required).trim().length > 0, `${required} must exist and be non-empty`);
}

const nextDiff = process.env.ATM_RFT0019_ALLOW_NEXT_DIFF === '1'
  ? ''
  : read('packages/cli/src/commands/next/channel-strategy.ts');
assert.ok(nextDiff.length > 0, 'Lane A next.ts guard file must remain readable');

console.log(JSON.stringify({
  ok: true,
  tasksFacadeLines: facadeLines,
  checked: 'TASK-RFT-0019 final facade atomic map'
}, null, 2));
