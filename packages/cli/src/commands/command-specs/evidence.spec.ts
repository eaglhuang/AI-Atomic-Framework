import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'evidence',
  summary: 'Add or verify task evidence for close/commit/PR governance gates.',
  positional: [
    { name: 'action', summary: 'add | verify', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to append or verify evidence.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for evidence add (or set ATM_ACTOR_ID).' },
    { flag: '--kind', value: 'type', summary: 'Evidence kind for add: test|artifact|attestation|review|commit|waiver.' },
    { flag: '--summary', value: 'text', summary: 'Optional short evidence summary for add.' },
    { flag: '--artifacts', value: 'csv', summary: 'Optional artifact path list for add.' },
    { flag: '--gate', value: 'type', summary: 'Evidence gate for verify: close|commit|pr.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --summary "governance validator passed" --artifacts reports/governance.json --json',
    'node atm.mjs evidence verify --task ATM-GOV-0104 --gate close --json'
  ]
});
