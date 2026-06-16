import { dispatchTasksAction, normalizeTasksArgv } from '../command-dispatch.js';
import { CliError, makeResult } from '../../shared.js';
function fail(message) {
    console.error(`[command-dispatch.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
const calls = [];
function handler(name) {
    return (argv) => {
        calls.push(`${name}:${argv.join(' ')}`);
        return makeResult({ ok: true, command: name, cwd: process.cwd(), evidence: { argv } });
    };
}
const handlers = {
    close: handler('close'),
    reset: handler('reset'),
    create: handler('create'),
    mirror: handler('mirror'),
    audit: handler('audit'),
    queue: handler('queue'),
    parallel: handler('parallel'),
    lock: handler('lock'),
    migrateLegacyLedger: handler('migrate-legacy-ledger'),
    reservation: (action, argv) => handler(action)(argv),
    claimLifecycle: (action, argv) => handler(action)(argv),
    reconcile: handler('reconcile'),
    repairClosure: handler('repair-closure'),
    show: handler('show'),
    status: handler('status'),
    finalize: handler('finalize'),
    deliverAndClose: handler('deliver-and-close'),
    roster: handler('roster'),
    newTask: handler('new'),
    importTask: handler('import'),
    verify: handler('verify'),
    scope: handler('scope')
};
assert(JSON.stringify(normalizeTasksArgv(['status', '--output-json', 'ignored', '--task', 'TASK-1'])) === JSON.stringify(['status', '--task', 'TASK-1']), '--output-json pair must be stripped');
await dispatchTasksAction(['status', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'status:--task TASK-1', 'status must dispatch with remaining argv');
await dispatchTasksAction(['block', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'close:--status blocked --task TASK-1', 'block alias must route through close with blocked status');
await dispatchTasksAction(['abandon', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'close:--status abandoned --task TASK-1', 'abandon alias must route through close with abandoned status');
await dispatchTasksAction(['claim', '--task', 'TASK-1'], handlers);
assert(calls.pop() === 'claim:--task TASK-1', 'claim lifecycle action must preserve action identity');
let missingActionRejected = false;
try {
    await dispatchTasksAction([], handlers);
}
catch (error) {
    missingActionRejected = error instanceof CliError && error.code === 'ATM_CLI_USAGE';
}
assert(missingActionRejected, 'missing action must fail with CLI usage');
let unknownActionRejected = false;
try {
    await dispatchTasksAction(['unknown'], handlers);
}
catch (error) {
    unknownActionRejected = error instanceof CliError && error.code === 'ATM_CLI_USAGE';
}
assert(unknownActionRejected, 'unknown action must fail with CLI usage');
console.log('[command-dispatch.test] ok');
