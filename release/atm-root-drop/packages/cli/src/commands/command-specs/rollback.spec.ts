import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'rollback',
  summary: 'Plan or apply rollback for atom/map registry targets.',
  options: [
    commonCwdOption,
    { flag: '--plan', summary: 'Prepare rollback proof preview without applying.' },
    { flag: '--apply', summary: 'Apply rollback and persist proof artifacts.' },
    { flag: '--target', value: 'kind', summary: 'Target kind: atom | map.' },
    { flag: '--atom', value: 'id', summary: 'Target atom id.' },
    { flag: '--map', value: 'id', summary: 'Target map id.' },
    { flag: '--map-owner', value: 'id', summary: 'Map owner atom id override.' },
    { flag: '--to', value: 'version', summary: 'Rollback destination version.' },
    { flag: '--behavior', value: 'id', summary: 'Behavior id for rollback evidence.' },
    { flag: '--registry', value: 'path', summary: 'Registry file path.' },
    { flag: '--proof', value: 'path', summary: 'Success proof output path.' },
    { flag: '--failure-proof', value: 'path', summary: 'Failure proof output path.' },
    { flag: '--by', value: 'name', summary: 'Decision author label.' },
    { flag: '--at', value: 'timestamp', summary: 'Verification timestamp.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs rollback --plan --atom ATM-CORE-0001 --to 1.0.0 --json',
    'node atm.mjs rollback --apply --atom ATM-CORE-0001 --to 1.0.0 --json'
  ]
});
