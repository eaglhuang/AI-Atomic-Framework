import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'validate',
  summary: 'Run repository or atomic spec validation checks.',
  options: [
    commonCwdOption,
    { flag: '--spec', value: 'path', summary: 'Validate a specific atomic spec path.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs validate --json',
    'node atm.mjs validate --spec tests/schema-fixtures/positive/hello-world.atom.json --json'
  ]
});
