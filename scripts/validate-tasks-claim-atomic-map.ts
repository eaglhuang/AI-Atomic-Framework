import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message: string): never {
  console.error(`[validate-tasks-claim-atomic-map] ${message}`);
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
const claimOrchestrator = read('packages/cli/src/commands/tasks/claim-orchestrator.ts');
const claimPreparation = read('packages/cli/src/commands/tasks/claim-preparation.ts');
const claimIntent = read('packages/cli/src/commands/tasks/claim-intent.ts');
const takeoverEvidence = read('packages/cli/src/commands/tasks/takeover-evidence.ts');
const repairClaimOrchestrator = read('packages/cli/src/commands/tasks/repair-claim-orchestrator.ts');
const atomicMap = read('docs/reports/tasks-command-atomic-map.md');

const atomFiles = new Map([
  ['packages/cli/src/commands/tasks/claim-orchestrator.ts', claimOrchestrator],
  ['packages/cli/src/commands/tasks/claim-preparation.ts', claimPreparation],
  ['packages/cli/src/commands/tasks/claim-intent.ts', claimIntent],
  ['packages/cli/src/commands/tasks/takeover-evidence.ts', takeoverEvidence],
  ['packages/cli/src/commands/tasks/repair-claim-orchestrator.ts', repairClaimOrchestrator]
]);

for (const [filePath, text] of atomFiles) {
  assert(lineCount(text) <= 600, `${filePath} must stay at or below 600 lines`);
  assert(atomicMap.includes(filePath), `atomic map must mention ${filePath}`);
}

assert(tasksFacade.includes("import { runTasksClaimLifecycle as delegatedRunTasksClaimLifecycle } from './tasks/claim-orchestrator.ts';"), 'tasks.ts must delegate claim lifecycle');
assert(tasksFacade.includes("import { prepareTaskForClaim as delegatedPrepareTaskForClaim } from './tasks/claim-preparation.ts';"), 'tasks.ts must delegate claim preparation');
assert(tasksFacade.includes("import { runTasksRepairClaim } from './tasks/repair-claim-orchestrator.ts';"), 'tasks.ts must delegate repair-claim');
assert(claimPreparation.includes('export function prepareTaskForClaim'), 'claim preparation atom must export prepareTaskForClaim');
assert(claimPreparation.includes('parseSingleCard'), 'claim preparation atom must consume the injected parser boundary');
assert(claimPreparation.includes('writeTaskFiles'), 'claim preparation atom must consume the injected task writer boundary');
assert(claimPreparation.includes('writeImportEvidence'), 'claim preparation atom must consume the injected import-evidence writer boundary');
assert(!tasksFacade.includes('function resolveTaskClaimIntent'), 'tasks.ts must not retain claim intent helper body');
assert(!tasksFacade.includes('function writeTakeoverEvidence'), 'tasks.ts must not retain takeover evidence helper body');
assert(!tasksFacade.includes('function parseRepairClaimOptions'), 'tasks.ts must not retain repair-claim parser body');
assert(lineCount(tasksFacade) < 4800, 'tasks.ts must remain below the TASK-RFT-0017 target ceiling of 4,800 lines');
assert(!atomicMap.includes('packages/cli/src/commands/next.ts` | `tasks.claim.lifecycle'), 'claim lifecycle atom must not move into next.ts');

console.log('[validate-tasks-claim-atomic-map] ok');
