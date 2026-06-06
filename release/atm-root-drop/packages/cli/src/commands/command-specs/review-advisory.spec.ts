import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'review-advisory',
  summary: 'Generate non-blocking semantic advisory findings.',
  options: [
    commonCwdOption,
    { flag: '--mode', value: 'mode', summary: 'stub | agent-bridge | external-cli' },
    { flag: '--stub-profile', value: 'profile', summary: 'pass | warn | unavailable' },
    { flag: '--out', value: 'path', summary: 'Advisory report output path.' },
    { flag: '--report-id', value: 'id', summary: 'Advisory report id override.' },
    { flag: '--target-kind', value: 'kind', summary: 'atom | map | proposal | diff | scope' },
    { flag: '--target-id', value: 'id', summary: 'Target identifier for advisory context.' },
    { flag: '--source-path', value: 'path', summary: 'Source path to annotate (repeatable).' },
    { flag: '--provider-response', value: 'path', summary: 'JSON provider response for agent-bridge mode.' },
    { flag: '--provider-cmd', value: 'command', summary: 'External provider command for external-cli mode.' },
    { flag: '--machine-findings', value: 'path', summary: 'Optional machine findings JSON file.' },
    { flag: '--queue', value: 'path', summary: 'Optional queue path for supplemental context.' },
    { flag: '--proposal-id', value: 'id', summary: 'Optional proposal id for supplemental context.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs review-advisory --mode stub --stub-profile pass --json'
  ]
});
