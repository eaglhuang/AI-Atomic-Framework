import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'test',
  summary: 'Run atom smoke, spec, map integration, map equivalence, or propagation tests.',
  options: [
    commonCwdOption,
    { flag: '--atom', value: 'name', summary: 'Run canned atom smoke (currently: hello-world).' },
    { flag: '--spec', value: 'path', summary: 'Run spec-based test runner flow.' },
    { flag: '--map', value: 'id', summary: 'Run map integration test for a map id.' },
    { flag: '--equivalence-fixtures', value: 'path', summary: 'Run map equivalence using a fixture set. Must be paired with --map.' },
    { flag: '--propagate', value: 'id', summary: 'Run downstream propagation checks for an atom id.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs test --atom hello-world --json',
    'node atm.mjs test --map ATM-MAP-0001 --json',
    'node atm.mjs test --map ATM-MAP-0001 --equivalence-fixtures fixtures/equivalence/checkout-mini.json --json'
  ]
});
