import { readFileSync } from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  console.error(`[deliver-close-orchestrator.spec] ${message}`);
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
const legacyImplementation = read('packages/cli/src/commands/tasks/legacy/implementation.ts');
const orchestrator = read('packages/cli/src/commands/tasks/deliver-close-orchestrator.ts');

assert(orchestrator.includes('export async function runTasksDeliverAndClose'), 'deliver-and-close runner must live in deliver-close-orchestrator');
assert(orchestrator.includes('DeliverAndCloseDependencies'), 'deliver-and-close must keep recursive runTasks dependency injected');
assert(orchestrator.includes('ATM_BATCH_CHECKPOINT_REQUIRED'), 'deliver-and-close orchestrator must own batch checkpoint gate');
assert(orchestrator.includes("'--auto-stage'"), 'deliver-and-close must delegate complete task bundle staging, including task events, to governed git commit');
assert(!orchestrator.includes("execFileSync('git', ['-C', options.cwd, 'add'"), 'deliver-and-close must not maintain a second partial raw-git staging path');
assert(facade.includes('runTasks,'), 'public tasks facade must continue to export the task command entrypoint');
assert(legacyImplementation.includes("import { runTasksDeliverAndClose as delegatedRunTasksDeliverAndClose } from '../deliver-close-orchestrator.ts';"), 'active task dispatcher must import the delegated deliver-and-close orchestrator');
assert(legacyImplementation.includes('return delegatedRunTasksDeliverAndClose(argv, { runTasks });'), 'active task dispatcher must inject runTasks into deliver-and-close');
assert(!facade.includes('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED'), 'tasks facade must not retain deliver-and-close delivery commit body');
assert(lineCount(orchestrator) <= 600, 'deliver-close-orchestrator.ts must stay at or below 600 lines');

console.log('[deliver-close-orchestrator.spec] ok');
