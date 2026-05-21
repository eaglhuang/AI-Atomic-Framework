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
  positional: [
    { name: 'validation-name', summary: 'Optional named validation such as atom-callsite-readability.', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path for named validation checks.' },
    { flag: '--spec', value: 'path', summary: 'Validate a specific atomic spec path.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs validate --json',
    'node atm.mjs validate --spec tests/schema-fixtures/positive/hello-world.atom.json --json',
    'node atm.mjs validate atom-callsite-readability --repo . --json'
  ]
});
