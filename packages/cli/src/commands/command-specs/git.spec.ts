import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'git',
  summary: 'Prepare repo-local git identity and verify ATM git-governance trailers.',
  positional: [
    { name: 'action', summary: 'prepare | check', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for git identity and trailer checks.' },
    { flag: '--task', value: 'id', summary: 'Optional task id to enforce owner/claim/trailer consistency.' },
    { flag: '--name', value: 'text', summary: 'Override git user.name during prepare.' },
    { flag: '--email', value: 'text', summary: 'Override git user.email during prepare.' },
    { flag: '--no-trailers', summary: 'Skip trailer checks in git check (identity/owner checks still run).' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs git prepare --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git check --task ATM-GOV-0105 --actor codex-main --json'
  ]
});
