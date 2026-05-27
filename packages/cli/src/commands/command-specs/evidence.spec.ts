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
    { name: 'action', summary: 'add | run | git-head-backfill | verify | diff | validators', required: true }
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
    { flag: '--command-runs', value: 'json-file', summary: 'Append multiple commandRuns from a JSON array or {commandRuns:[]} cache file.' },
    { flag: '--exit-code', value: 'number', summary: 'Exit code paired with --command evidence.' },
    { flag: '--stdout-sha256', value: 'sha256', summary: 'stdout digest paired with --command evidence.' },
    { flag: '--stderr-sha256', value: 'sha256', summary: 'stderr digest paired with --command evidence.' },
    { flag: '--runner-kind', value: 'kind', summary: 'Runner kind for command proof: dev-source|frozen-runner|external.' },
    { flag: '--source-commit', value: 'sha', summary: 'Source commit paired with dev-source command proof.' },
    { flag: '--reason', value: 'text', summary: 'Optional rationale for git-head-backfill.' },
    { flag: '--gate', value: 'type', summary: 'Evidence gate for verify: close|commit|pr.' },
    { flag: '--list', summary: 'List all required validators with tier and current evidence state (used with validators action).' },
    { flag: '--recent-run', summary: 'Use the most recent cached command run if available in the task evidence (used with run action).' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --summary "governance validator passed" --artifacts reports/governance.json --json',
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --freshness fresh --command "npm run typecheck" --exit-code 0 --stdout-sha256 sha256:1111111111111111111111111111111111111111111111111111111111111111 --stderr-sha256 sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 --validators typecheck,validate:cli --json',
    'node atm.mjs evidence add --task ATM-GOV-0104 --actor codex-main --kind test --command-runs .atm/runtime/command-runs/batch-validators.json --validators typecheck,validate:cli --json',
    'node atm.mjs evidence git-head-backfill --actor codex-main --reason "Backfill evidence for a pre-ATM HEAD commit" --json',
    'node atm.mjs evidence verify --task ATM-GOV-0104 --gate close --json',
    'node atm.mjs evidence validators --list --task ATM-GOV-0104 --json',
    'node atm.mjs evidence run --task ATM-GOV-0104 --actor Augment --command "npm run typecheck" --validators typecheck --recent-run --json'
  ]
});
