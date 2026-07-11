import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[repair-claim-orchestrator.spec] ${message}`);
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
const repairClaim = read('packages/cli/src/commands/tasks/repair-claim-orchestrator.ts');

assert(repairClaim.includes('export async function runTasksRepairClaim'), 'repair-claim runner must live in repair-claim-orchestrator');
assert(repairClaim.includes("from './claim-repair-diagnostics.ts'"), 'repair-claim orchestrator must reuse diagnostics atom');
assert(facade.includes("import { runTasksRepairClaim } from './tasks/repair-claim-orchestrator.ts';"), 'tasks facade must import repair-claim orchestrator');
assert(!facade.includes('function parseRepairClaimOptions'), 'tasks facade must not keep repair-claim option parsing');
assert(!facade.includes('function runTasksRepairClaim'), 'tasks facade must not keep repair-claim runner body');
assert(lineCount(repairClaim) <= 600, 'repair-claim-orchestrator.ts must stay at or below 600 lines');

console.log('[repair-claim-orchestrator.spec] ok');
