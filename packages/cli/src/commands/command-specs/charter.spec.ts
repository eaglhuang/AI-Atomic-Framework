import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption
} from './_common.ts';

export default defineCommandSpec({
  name: 'charter',
  summary: 'Upgrade the AtomicCharter to the version bundled with this ATM release.',
  positional: [
    { name: 'action', summary: 'upgrade', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--dry-run', summary: 'Show the version delta and planned file changes without writing (default).' },
    { flag: '--write', summary: 'Apply the upgrade and record a receipt with the previous files under .atm/history/evidence/.' },
    { flag: '--enforce-now', summary: 'Enforce newly added invariants immediately instead of starting them advisory for one release.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs charter upgrade --json',
    'node atm.mjs charter upgrade --write --json'
  ]
});
