import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'identity',
    summary: 'Manage repo-local default actor identity and inspect the current runtime session hint.',
    positional: [
        { name: 'action', summary: 'set | show', required: true }
    ],
    options: [
        commonCwdOption,
        { flag: '--actor', value: 'id', summary: 'Default actor id for this repository runtime.' },
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
        'node atm.mjs identity show --json'
    ]
});
