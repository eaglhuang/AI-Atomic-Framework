import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'health-report',
  summary: 'Generate a map health report and highlight high-risk atoms or bottlenecks.',
  options: [
    commonCwdOption,
    { flag: '--map', value: 'id', summary: 'Map id to inspect.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs health-report --map ATM-MAP-0001 --json'
  ]
});
