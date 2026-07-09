import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message: string): never {
  console.error(`[validate-tasks-reconcile-atomic-map] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function read(relativePath: string): string {
  const absolute = path.join(root, relativePath);
  assert(existsSync(absolute), `${relativePath} must exist`);
  return readFileSync(absolute, 'utf8');
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

const tasksFacade = read('packages/cli/src/commands/tasks.ts');
const reconcile = read('packages/cli/src/commands/tasks/reconcile-orchestrator.ts');
const repairclose = read('packages/cli/src/commands/tasks/repairclose-orchestrator.ts');
const deliverClose = read('packages/cli/src/commands/tasks/deliver-close-orchestrator.ts');
const atomicMap = read('docs/reports/tasks-command-atomic-map.md');

const atomFiles = new Map([
  ['packages/cli/src/commands/tasks/reconcile-orchestrator.ts', reconcile],
  ['packages/cli/src/commands/tasks/repairclose-orchestrator.ts', repairclose],
  ['packages/cli/src/commands/tasks/deliver-close-orchestrator.ts', deliverClose]
]);

for (const [filePath, text] of atomFiles) {
  assert(lineCount(text) <= 600, `${filePath} must stay at or below 600 lines`);
  assert(atomicMap.includes(filePath), `atomic map must mention ${filePath}`);
}

assert(tasksFacade.includes("import { runTasksReconcile } from './tasks/reconcile-orchestrator.ts';"), 'tasks.ts must delegate reconcile');
assert(tasksFacade.includes("import { runTasksRepairClosure } from './tasks/repairclose-orchestrator.ts';"), 'tasks.ts must delegate repair-closure');
assert(tasksFacade.includes("import { runTasksDeliverAndClose as delegatedRunTasksDeliverAndClose } from './tasks/deliver-close-orchestrator.ts';"), 'tasks.ts must delegate deliver-and-close');
assert(tasksFacade.includes('return delegatedRunTasksDeliverAndClose(argv, { runTasks });'), 'deliver-and-close must use injected runTasks dependency');
assert(!tasksFacade.includes('function parseRepairClosureOptions'), 'tasks.ts must not retain repair-closure parser body');
assert(!tasksFacade.includes('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED'), 'tasks.ts must not retain deliver-and-close backend body');
assert(!tasksFacade.includes('atm.reconcileAttestation.v1'), 'tasks.ts must not retain reconcile backend body');
assert(lineCount(tasksFacade) < 3900, 'tasks.ts must remain below the TASK-RFT-0018 target ceiling of 3,900 lines');

console.log('[validate-tasks-reconcile-atomic-map] ok');
