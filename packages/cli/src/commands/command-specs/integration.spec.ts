import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'integration',
  summary: 'List, install, verify, or remove ATM agent integration adapters.',
  positional: [
    { name: 'action', summary: 'list | add | verify | remove', required: false },
    { name: 'adapter-id', summary: 'Adapter id for add/verify/remove.', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'name', summary: 'Actor label recorded in install manifests.' },
    { flag: '--at', value: 'timestamp', summary: 'Install timestamp override.' },
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
    'node atm.mjs integration remove claude-code --json'
  ]
});
