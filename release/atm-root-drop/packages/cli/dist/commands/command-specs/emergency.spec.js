import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'emergency',
    summary: 'Manage short-lived human-approved emergency maintenance leases for protected backend surfaces. Normal operators should use taskflow open/close; emergency approvals are for repair-only backend use.',
    positional: [
        { name: 'action', summary: 'approve | show | revoke | permissions', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--task', value: 'id', summary: 'Task id the emergency lease is limited to.' },
        { flag: '--actor', value: 'id', summary: 'Actor id allowed to consume the lease.' },
        { flag: '--approved-by', value: 'id', summary: 'Human approver label. Defaults to human.' },
        { flag: '--permission', value: 'id', summary: 'Permission id from emergency permissions.' },
        { flag: '--approval-text', value: 'text', summary: 'Human approval sentence authorizing this emergency lane use.' },
        { flag: '--reason', value: 'text', summary: 'Why normal taskflow open/close cannot be used.' },
        { flag: '--lease', value: 'id', summary: 'Lease id for show/revoke.' },
        { flag: '--emergency-approval', value: 'id', summary: 'Alias for --lease when inspecting an approval.' },
        { flag: '--surface', value: 'name', summary: 'Optional protected surface label.' },
        { flag: '--allowed-flag', value: 'flag', summary: 'Repeatable flag that this lease explicitly allows, such as --waiver-out-of-scope-delivery.', repeatable: true },
        { flag: '--ttl-minutes', value: 'number', summary: 'Lease lifetime in minutes.' },
        { flag: '--max-uses', value: 'number', summary: 'Maximum number of protected backend uses allowed by this lease.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs emergency permissions --json',
        'node atm.mjs emergency approve --task TASK-CID-0043 --actor 007 --permission backend.tasks.reconcile --approval-text "Human approved TASK-CID-0043 reconcile" --reason "Historical closeback repair" --json',
        'node atm.mjs emergency show --lease EMG-TASK-CID-0043-abc123 --json',
        'node atm.mjs emergency revoke --lease EMG-TASK-CID-0043-abc123 --actor captain --json'
    ]
});
