import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'git',
  summary: 'Prepare repo-local git identity, create governed commits, and verify ATM git-governance trailers.',
  positional: [
    { name: 'action', summary: 'prepare | check | commit', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--actor', value: 'id', summary: 'Actor id used for git identity and trailer checks.' },
    { flag: '--task', value: 'id', summary: 'Optional task id to enforce owner/claim/trailer consistency.' },
    { flag: '--name', value: 'text', summary: 'Override git user.name during prepare; with --email, also seeds the ATM runtime identity profile.' },
    { flag: '--email', value: 'text', summary: 'Override git user.email during prepare; with --name, also seeds the ATM runtime identity profile.' },
    { flag: '--session', value: 'session-id', summary: 'Optional ATM work session id for check/commit alignment.' },
    { flag: '--message', value: 'text', summary: 'Commit summary for git commit; ATM appends governed trailers automatically.' },
    { flag: '--no-verify', summary: 'Pass through to git commit when emergency manual bypass is explicitly intended.' },
    { flag: '--no-trailers', summary: 'Skip trailer checks in git check (identity/owner checks still run).' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs git prepare --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git check --task ATM-GOV-0105 --actor codex-main --json',
    'node atm.mjs git commit --actor codex-main --task ATM-GOV-0105 --message "complete ATM-GOV-0105" --json'
  ]
});
