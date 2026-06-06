import { defineCommandSpec } from '../shared.js';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption, } from './_common.js';
export default defineCommandSpec({
    name: 'validate',
    summary: 'Run repository, framework-development, or atomic spec validation checks.',
    positional: [
        { name: 'validation-name', summary: 'Optional named validation such as atom-callsite-readability or framework-development.', required: false }
    ],
    options: [
        commonCwdOption,
        { flag: '--repo', value: 'path', summary: 'Repository path for named validation checks.' },
        { flag: '--files', value: 'csv', summary: 'Optional declared file scope for framework-development validation.' },
        { flag: '--target-repo', value: 'path', summary: 'Optional cross-repo target repository path for framework-development validation.' },
        { flag: '--spec', value: 'path', summary: 'Validate a specific atomic spec path.' },
        commonJsonOption,
        commonPrettyOption,
        commonHelpOption
    ],
    examples: [
        'node atm.mjs validate --json',
        'node atm.mjs validate --spec tests/schema-fixtures/positive/hello-world.atom.json --json',
        'node atm.mjs validate atom-callsite-readability --repo . --json',
        'node atm.mjs validate framework-development --repo . --json',
        'node atm.mjs validate framework-development --repo . --target-repo ../AI-Atomic-Framework --json'
    ]
});
