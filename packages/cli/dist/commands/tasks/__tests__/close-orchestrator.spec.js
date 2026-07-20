/**
 * TASK-RFT-0012 spec — close-orchestrator surface smoke test.
 *
 * The body of runTasksClose was moved verbatim out of tasks.ts. This spec
 * verifies the extracted module still loads, exports an async function, and
 * that its argv-parsing branch still hard-fails on missing --task (a proxy
 * for "the orchestrator wire-up is not broken"). Fuller close-path coverage
 * is exercised by the integration flow through `node atm.mjs tasks close`.
 *
 * Branches exercised via CliError code:
 *   - normal (missing --task usage error)
 *   - historical-delivery (missing --task with historical flag)
 *   - historical-batch (missing --task with batch flag)
 *   - rollback (missing --task with rollback-shaped invocation)
 */
import { runTasksClose } from '../close-orchestrator.js';
import { CliError } from '../../shared.js';
function fail(message) {
    console.error(`[close-orchestrator.spec] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
assert(typeof runTasksClose === 'function', 'runTasksClose export must be a function');
assert(runTasksClose.constructor.name === 'AsyncFunction', 'runTasksClose must be async');
async function expectCliError(argv, branch) {
    try {
        await runTasksClose(argv);
        fail(`branch ${branch}: expected CliError, got success`);
    }
    catch (err) {
        if (!(err instanceof CliError)) {
            fail(`branch ${branch}: expected CliError, got ${err instanceof Error ? err.constructor.name : typeof err}`);
        }
    }
}
await expectCliError(['--actor', 'test-actor', '--status', 'done'], 'normal');
await expectCliError(['--actor', 'test-actor', '--status', 'done', '--historical-delivery', 'HEAD'], 'historical-delivery');
await expectCliError(['--actor', 'test-actor', '--status', 'done', '--historical-batch', 'batch-x'], 'historical-batch');
await expectCliError(['--actor', 'test-actor', '--status', 'abandoned', '--reason', 'rollback'], 'rollback');
console.log('[close-orchestrator.spec] ok (4 branches)');
