import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'spec',
  summary: 'Validate an atomic spec or supported report against schema contracts.',
  options: [
    commonCwdOption,
    { flag: '--validate', value: 'path', summary: 'Spec file path to validate.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs spec --validate tests/schema-fixtures/positive/hello-world.atom.json --json',
    'node atm.mjs spec --validate tests/schema-fixtures/map-equivalence-report/positive.json --json'
  ]
});
