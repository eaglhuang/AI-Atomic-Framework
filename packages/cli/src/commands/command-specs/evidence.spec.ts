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
    { name: 'action', summary: 'add | git-head-backfill | verify | diff', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--task', value: 'id', summary: 'Task id to append or verify evidence.' },
    { flag: '--actor', value: 'id', summary: 'Actor id for evidence add (or set ATM_ACTOR_ID).' },
    { flag: '--kind', value: 'type', summary: 'Evidence kind for add: test|artifact|attestation|review|commit|waiver.' },
    { flag: '--summary', value: 'text', summary: 'Optional short evidence summary for add.' },
    { flag: '--artifacts', value: 'csv', summary: 'Optional artifact path list for add.' },
    { flag: '--freshness', value: 'type', summary: 'Evidence freshness for add: fresh|historical-reference|draft (default: fresh).' },
    { flag: '--validators', value: 'csv', summary: 'Optional validator pass list recorded with the evidence.' },
    { flag: '--command', value: 'text', summary: 'Optional command string for runnable evidence proof (requires exit code and sha256 outputs).' },
    { flag: '--exit-code', value: 'number', summary: 'Exit code paired with --command evidence.' },
    { flag: '--stdout-sha256', value: 'sha256', summary: 'stdout digest paired with --command evidence.' },
    { flag: '--stderr-sha256', value: 'sha256', summary: 'stderr digest paired with --command evidence.' },
    { flag: '--reason', value: 'text', summary: 'Optional rationale for git-head-backfill.' },
    { flag: '--gate', value: 'type', summary: 'Evidence gate for verify: close|commit|pr.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --summary "governance validator passed" --artifacts reports/governance.json --json',
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --freshness fresh --command "npm run typecheck" --exit-code 0 --stdout-sha256 sha256:1111111111111111111111111111111111111111111111111111111111111111 --stderr-sha256 sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 --validators typecheck,validate:cli --json',
    'node atm.mjs evidence git-head-backfill --actor codex-main --reason "Backfill evidence for a pre-ATM HEAD commit" --json',
    'node atm.mjs evidence verify --task ATM-GOV-0104 --gate close --json'
  ]
});
