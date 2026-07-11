import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[repairclose-orchestrator.spec] ${message}`);
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
const orchestrator = read('packages/cli/src/commands/tasks/repairclose-orchestrator.ts');

assert(orchestrator.includes('export async function runTasksRepairClosure'), 'repair-closure runner must live in repairclose-orchestrator');
assert(orchestrator.includes('function parseRepairClosureOptions'), 'repair-closure parser must move with the backend runner');
assert(orchestrator.includes('writeRepairClosureTransition'), 'repair-closure transition writer must move with the backend runner');
assert(facade.includes("import { runTasksRepairClosure } from './tasks/repairclose-orchestrator.ts';"), 'tasks facade must import repairclose orchestrator');
assert(!facade.includes('function parseRepairClosureOptions'), 'tasks facade must not retain repair-closure option parser');
assert(!facade.includes('repairClosurePacketForTask'), 'tasks facade must not retain closure-packet repair implementation dependency');
assert(lineCount(orchestrator) <= 600, 'repairclose-orchestrator.ts must stay at or below 600 lines');

console.log('[repairclose-orchestrator.spec] ok');
