import { readFileSync } from 'node:fs';
import path from 'node:path';
function fail(message) {
    console.error(`[deliver-close-orchestrator.spec] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
function read(relativePath) {
    return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}
function lineCount(text) {
    return text.split(/\r?\n/).length;
}
const facade = read('packages/cli/src/commands/tasks.ts');
const orchestrator = read('packages/cli/src/commands/tasks/deliver-close-orchestrator.ts');
assert(orchestrator.includes('export async function runTasksDeliverAndClose'), 'deliver-and-close runner must live in deliver-close-orchestrator');
assert(orchestrator.includes('DeliverAndCloseDependencies'), 'deliver-and-close must keep recursive runTasks dependency injected');
assert(orchestrator.includes('ATM_BATCH_CHECKPOINT_REQUIRED'), 'deliver-and-close orchestrator must own batch checkpoint gate');
assert(facade.includes("import { runTasksDeliverAndClose as delegatedRunTasksDeliverAndClose } from './tasks/deliver-close-orchestrator.js';"), 'tasks facade must import delegated deliver-and-close orchestrator');
assert(facade.includes('return delegatedRunTasksDeliverAndClose(argv, { runTasks });'), 'tasks facade must inject runTasks into deliver-and-close');
assert(!facade.includes('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED'), 'tasks facade must not retain deliver-and-close delivery commit body');
assert(lineCount(orchestrator) <= 600, 'deliver-close-orchestrator.ts must stay at or below 600 lines');
console.log('[deliver-close-orchestrator.spec] ok');
