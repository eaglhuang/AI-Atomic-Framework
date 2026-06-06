import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'integration',
    summary: 'List, install, verify, remove, or run ATM agent integration adapters and hooks.',
    positional: [
        { name: 'action', summary: 'list | add | verify | remove | hook | hooks', required: false },
        { name: 'adapter-id', summary: 'Adapter id for add/verify/remove or hook event/action.', required: false },
        { name: 'hook-adapter-id', summary: 'Adapter id for hooks install/verify.', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--repo', value: 'path', summary: 'Repository path for hook invocations.' },
        { flag: '--actor', value: 'name', summary: 'Actor label recorded in install manifests.' },
        { flag: '--at', value: 'timestamp', summary: 'Install timestamp override.' },
        { flag: '--editor', value: 'id', summary: 'Editor id for integration hook pre-agent/pre-tool.' },
        { flag: '--prompt', value: 'text', summary: 'Prompt text for pre-agent hook evaluation.' },
        { flag: '--tool-name', value: 'name', summary: 'Tool name for pre-tool hook evaluation.' },
        { flag: '--command', value: 'command', summary: 'Shell command for pre-tool hook evaluation.' },
        { flag: '--files', value: 'csv', summary: 'Comma-separated paths for pre-tool hook evaluation.' },
        { flag: '--dry-run', summary: 'Preview integration install without writing files.' },
        { flag: '--force', summary: 'Overwrite existing manifests and target files.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs integration list --json',
        'node atm.mjs integration add claude-code --json',
        'node atm.mjs integration add codex --json',
        'node atm.mjs integration add antigravity --json',
        'node atm.mjs integration verify claude-code --json',
        'node atm.mjs integration remove claude-code --json',
        'node atm.mjs integration hook pre-agent --editor copilot --json',
        'node atm.mjs integration hook pre-tool --editor claude-code --files packages/core/src/index.ts --json',
        'node atm.mjs integration hooks install copilot --json',
        'node atm.mjs integration hooks verify claude-code --json'
    ]
});
