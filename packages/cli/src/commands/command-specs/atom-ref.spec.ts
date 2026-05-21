import { defineCommandSpec } from '../shared.ts';
import {
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'atom-ref',
  summary: 'Generate and validate readable atom/map refs for runAtm callsites.',
  positional: [
    { name: 'subcommand', summary: 'sweep', required: true }
  ],
  options: [
    { flag: '--repo', value: 'path', repeatable: true, summary: 'Repository path to scan and optionally update.' },
    { flag: '--apply', summary: 'Write generated refs, reports, and safe callsite rewrites.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs atom-ref sweep --repo . --json',
    'node atm.mjs atom-ref sweep --apply --repo C:\\Users\\User\\AI-Atomic-Framework --json'
  ]
});
