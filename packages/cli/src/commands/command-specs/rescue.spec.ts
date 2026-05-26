import { defineCommandSpec } from '../shared.ts';
import {
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'rescue',
  summary: 'Run rescue-family diagnostics and disaster-recovery operations for corrupted ATM state.',
  positional: [
    { name: 'action', summary: 'police | diagnose | rebuild-registry | reload-atoms | rebuild-maps | replay-lineage | clear-cache | factory-reset', required: false }
  ],
  options: [
    { flag: '--dry-run', summary: 'Report planned recovery steps without mutating state.' },
    { flag: '--confirm', summary: 'Allow destructive rescue actions to execute instead of staying in dry-run mode.' },
    { flag: '--i-understand-this-deletes-state', summary: 'Required acknowledgement for factory-reset execution.' },
    { flag: '--map', value: 'id', summary: 'Map id required by replay-lineage.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs rescue police --json',
    'node atm.mjs rescue diagnose --json',
    'node atm.mjs rescue rebuild-registry --dry-run --json',
    'node atm.mjs rescue replay-lineage --map ATM-MAP-0001 --confirm --json'
  ]
});
