import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[claim-orchestrator.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

const facade = read('packages/cli/src/commands/tasks.ts');
const legacy = read('packages/cli/src/commands/tasks/legacy/implementation.ts');
const orchestrator = read('packages/cli/src/commands/tasks/claim-orchestrator.ts');
const ownership = read('packages/cli/src/commands/tasks/claim-ownership.ts');
const preparation = read('packages/cli/src/commands/tasks/claim-preparation.ts');
const intent = read('packages/cli/src/commands/tasks/claim-intent.ts');
const takeoverEvidence = read('packages/cli/src/commands/tasks/takeover-evidence.ts');

assert(orchestrator.includes('export async function runTasksClaimLifecycle'), 'claim lifecycle runner must live in claim-orchestrator');
assert(ownership.includes('export function throwIfForeignSameTaskClaim'), 'lane-aware claim ownership helper must exist');
assert(orchestrator.includes("from './claim-ownership.ts'"), 'claim-orchestrator must reuse claim-ownership helper');
assert(legacy.includes("import { runTasksClaimLifecycle as delegatedRunTasksClaimLifecycle } from '../claim-orchestrator.ts';"), 'legacy tasks implementation must delegate lifecycle runner');
assert(legacy.includes('delegatedRunTasksClaimLifecycle'), 'legacy tasks implementation must call delegated lifecycle runner');
assert(facade.includes("runTasksClaimLifecycle"), 'tasks facade must re-export claim lifecycle runner');
assert(preparation.includes('export function prepareTaskForClaim'), 'claim preparation must live in claim-preparation atom');
assert(legacy.includes("import { prepareTaskForClaim as delegatedPrepareTaskForClaim } from '../claim-preparation.ts';")
  || legacy.includes("prepareTaskForClaim"), 'legacy tasks implementation must keep claim preparation wiring');
assert(preparation.includes('parseSingleCard'), 'claim preparation must keep parser as an injected atom boundary');
assert(preparation.includes('writeTaskFiles'), 'claim preparation must keep task writer as an injected atom boundary');
assert(preparation.includes('writeImportEvidence'), 'claim preparation must keep import evidence writer as an injected atom boundary');
assert(intent.includes('export function resolveTaskClaimIntent'), 'claim intent resolution must live in claim-intent atom');
assert(takeoverEvidence.includes('export function writeTakeoverEvidence'), 'takeover evidence writer must live in takeover-evidence atom');

for (const [name, text] of [
  ['claim-orchestrator.ts', orchestrator],
  ['claim-ownership.ts', ownership],
  ['claim-preparation.ts', preparation],
  ['claim-intent.ts', intent],
  ['takeover-evidence.ts', takeoverEvidence]
] as const) {
  assert(lineCount(text) <= 600, `${name} must stay at or below 600 lines`);
}

console.log('[claim-orchestrator.spec] ok');
