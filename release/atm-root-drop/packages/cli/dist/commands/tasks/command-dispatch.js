import { CliError } from '../shared.js';
export const TASKS_ACTION_USAGE = 'tasks requires an action (create | import | mirror | verify | scope | queue | parallel | lock | reserve | promote | reset | claim | renew | release | handoff | takeover | block | abandon | close | reconcile | repair-closure | show | status | finalize | deliver-and-close | audit | migrate-legacy-ledger | roster | new).';
export function normalizeTasksArgv(argv) {
    const cleanArgv = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--output-json') {
            i++;
            continue;
        }
        cleanArgv.push(argv[i]);
    }
    return cleanArgv;
}
export async function dispatchTasksAction(argv, handlers) {
    const cleanArgv = normalizeTasksArgv(argv);
    const action = (cleanArgv[0] ?? '').toLowerCase();
    const rest = cleanArgv.slice(1);
    switch (action) {
        case 'close':
            return await handlers.close(rest);
        case 'reset':
            return await handlers.reset(rest);
        case 'block':
            return await handlers.close(['--status', 'blocked', ...rest]);
        case 'abandon':
            return await handlers.close(['--status', 'abandoned', ...rest]);
        case 'create':
            return await handlers.create(rest);
        case 'mirror':
            return await handlers.mirror(rest);
        case 'audit':
            return await handlers.audit(rest);
        case 'queue':
            return await handlers.queue(rest);
        case 'parallel':
            return await handlers.parallel(rest);
        case 'lock':
            return await handlers.lock(rest);
        case 'migrate-legacy-ledger':
            return await handlers.migrateLegacyLedger(rest);
        case 'reserve':
        case 'promote':
            return await handlers.reservation(action, rest);
        case 'claim':
        case 'renew':
        case 'release':
        case 'handoff':
        case 'takeover':
            return await handlers.claimLifecycle(action, rest);
        case 'reconcile':
            return await handlers.reconcile(rest);
        case 'repair-closure':
            return await handlers.repairClosure(rest);
        case 'show':
            return await handlers.show(rest);
        case 'status':
            return await handlers.status(rest);
        case 'finalize':
            return await handlers.finalize(rest);
        case 'deliver-and-close':
            return await handlers.deliverAndClose(rest);
        case 'roster':
            return await handlers.roster(rest);
        case 'new':
            return await handlers.newTask(rest);
        case 'import':
            return await handlers.importTask(rest);
        case 'verify':
            return await handlers.verify(rest);
        case 'scope':
            return await handlers.scope(rest);
        case '':
            throw new CliError('ATM_CLI_USAGE', TASKS_ACTION_USAGE, { exitCode: 2 });
        default:
            throw new CliError('ATM_CLI_USAGE', `tasks does not support action ${action}.`, { exitCode: 2 });
    }
}
