import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'agent-pack',
    summary: 'Install, uninstall, diff, or list ATM agent packs.',
    positional: [
        { name: 'action', summary: 'install | uninstall | diff | list', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--pack', value: 'pack-id', summary: 'Agent pack id for install/uninstall/diff.' },
        { flag: '--dry-run', summary: 'Preview install without writing files.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs agent-pack list --json',
        'node atm.mjs agent-pack install --pack claude-code --dry-run --json',
        'node atm.mjs agent-pack install --pack claude-code --json',
        'node atm.mjs agent-pack diff --pack claude-code --json',
        'node atm.mjs agent-pack uninstall --pack claude-code --json'
    ]
});
