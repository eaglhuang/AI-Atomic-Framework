import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'atomize',
    summary: 'Inspect and improve ATM atomization coverage for the current repository, including inventory/score/backfill plus the official registration-receipt and task snapshot helper lane.',
    positional: [
        { name: 'subcommand', summary: 'inventory | score | backfill | register-receipt | snapshot | verify-task', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--repo', value: 'path', summary: 'Repository path to inspect or update.' },
        { flag: '--dry-run', summary: 'For backfill, generate a proposal without writing atomization artifacts.' },
        { flag: '--apply', summary: 'For backfill, write generatedDraft governance artifacts for review.' },
        { flag: '--task', value: 'id', summary: 'For register-receipt/snapshot/verify-task: governed task id for receipts and task snapshots.' },
        { flag: '--phase', value: 'before|after', summary: 'For snapshot: which task snapshot boundary to record.' },
        { flag: '--shard', value: 'path', summary: 'For register-receipt: owner-shard file to update.' },
        { flag: '--path-pattern', value: 'glob', summary: 'For register-receipt: production path pattern to register into the owner shard.' },
        { flag: '--atom-id', value: 'id', summary: 'For register-receipt: owner atom or map id for the path pattern.' },
        { flag: '--capability', value: 'text', summary: 'For register-receipt: capability description recorded in the owner-shard row.' },
        { flag: '--source-task', value: 'id', summary: 'For register-receipt: source task id stored onto the owner-shard row.' },
        { flag: '--map-id', value: 'id', summary: 'For register-receipt: referenced map id to record into the generated receipt. Repeatable.' },
        { flag: '--validate-command', value: 'text', summary: 'For register-receipt: validator command to run before the receipt is marked healthy. Repeatable.' },
        { flag: '--no-default-validator', summary: 'For register-receipt: skip the default npm run validate:atomization-coverage command.' },
        { flag: '--expected-atom-delta', value: 'number', summary: 'For verify-task: expected atom registry count delta between before/after snapshots.' },
        { flag: '--expected-map-delta', value: 'number', summary: 'For verify-task: expected map registry count delta between before/after snapshots.' },
        { flag: '--expected-path-delta', value: 'number', summary: 'For verify-task: expected path-to-atom-map row count delta between before/after snapshots.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs atomize inventory --repo . --json',
        'node atm.mjs atomize score --repo . --json',
        'node atm.mjs atomize backfill --dry-run --repo . --json',
        'node atm.mjs atomize backfill --apply --repo . --json',
        'node atm.mjs atomize register-receipt --repo . --task TASK-CID-0104 --shard atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json --path-pattern packages/cli/src/commands/evidence.ts --atom-id atm.historical-batch-evidence --capability "historical batch evidence slicing and close-readiness guards" --source-task TASK-CID-0104 --map-id atm.task-closure-map --json',
        'node atm.mjs atomize snapshot --repo . --task TASK-CID-0104 --phase before --json',
        'node atm.mjs atomize verify-task --repo . --task TASK-CID-0104 --expected-atom-delta 0 --expected-map-delta 0 --expected-path-delta 1 --json'
    ]
});
