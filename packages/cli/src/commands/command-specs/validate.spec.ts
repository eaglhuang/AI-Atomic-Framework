import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'validate',
  summary: 'Run repository, framework-development, taxonomy, or atomic spec validation checks.',
  positional: [
    { name: 'validation-name', summary: 'Optional named validation such as atom-callsite-readability, framework-development, or taxonomy.', required: false }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path for named validation checks.' },
    { flag: '--files', value: 'csv', summary: 'Optional declared file scope for framework-development validation.' },
    { flag: '--target-repo', value: 'path', summary: 'Optional cross-repo target repository path for framework-development validation.' },
    { flag: '--spec', value: 'path', summary: 'Validate a specific atomic spec path.' },
    { flag: '--task', value: 'id', summary: 'Optional task id to query validator scope taxonomy for touched files.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs validate --json',
    'node atm.mjs validate --spec tests/schema-fixtures/positive/hello-world.atom.json --json',
    'node atm.mjs validate atom-callsite-readability --repo . --json',
    'node atm.mjs validate framework-development --repo . --json',
    'node atm.mjs validate framework-development --repo . --target-repo ../AI-Atomic-Framework --json',
    'node atm.mjs validate taxonomy --task TASK-MAO-0042 --json'
  ]
});
