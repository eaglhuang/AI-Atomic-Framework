import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'identity',
    summary: 'Manage per-actor runtime git identity profiles, inspect hints, and clear stale repo-default identities before agent handoff.',
    positional: [
        { name: 'action', summary: 'set | show | clear', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--actor', value: 'id', summary: 'Actor id for the per-actor identity profile; omit on set to update repo default.json.' },
        { flag: '--name', value: 'text', summary: 'Optional display name; when combined with --kind, also updates actor registry.' },
        { flag: '--kind', value: 'kind', summary: 'Optional actor kind: human | ai-agent | automation.' },
        { flag: '--provider', value: 'text', summary: 'Optional provider label for registry/default identity.' },
        { flag: '--editor', value: 'text', summary: 'Optional editor/host label for registry/default identity.' },
        { flag: '--git-name', value: 'text', summary: 'Preferred git author name for this actor.' },
        { flag: '--git-email', value: 'text', summary: 'Preferred git author email for this actor.' },
        { flag: '--contact', value: 'text', summary: 'Optional owner/contact for registry update.' },
        { flag: '--capabilities', value: 'csv', summary: 'Optional capability tags for registry update.' },
        { flag: '--active-session', value: 'session-id', summary: 'Override the active session hint stored with the default identity.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs identity set --actor codex-main --git-name "codex-main" --git-email codex-main@atm.local --editor codex --json',
        'node atm.mjs identity set --git-name "solo-user" --git-email solo-user@example.local --json',
        'node atm.mjs identity clear --json',
        'node atm.mjs identity clear --actor codex-main --json',
        'node atm.mjs identity show --actor codex-main --json',
        'node atm.mjs identity show --json'
    ]
});
