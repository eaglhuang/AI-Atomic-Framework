import { readFileSync } from 'node:fs';
import path from 'node:path';
function fail(message) {
    console.error(`[reconcile-orchestrator.spec] ${message}`);
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
const orchestrator = read('packages/cli/src/commands/tasks/reconcile-orchestrator.ts');
assert(orchestrator.includes('export async function runTasksReconcile'), 'reconcile runner must live in reconcile-orchestrator');
assert(orchestrator.includes('createClosurePacket'), 'reconcile orchestrator must own closure packet creation');
assert(orchestrator.includes('buildHistoricalDeliveryProvenance'), 'reconcile orchestrator must own historical delivery provenance');
assert(orchestrator.includes('executeTaskCloseTransaction'), 'reconcile orchestrator must own close transaction writes');
assert(facade.includes("import { runTasksReconcile } from './tasks/reconcile-orchestrator.js';"), 'tasks facade must import reconcile orchestrator');
assert(!facade.includes('Historical reconcile sync completed'), 'tasks facade must not retain reconcile evidence body');
assert(!facade.includes('atm.reconcileAttestation.v1'), 'tasks facade must not retain reconcile attestation body');
assert(lineCount(orchestrator) <= 600, 'reconcile-orchestrator.ts must stay at or below 600 lines');
console.log('[reconcile-orchestrator.spec] ok');
