import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'actor',
  summary: 'Manage actor identity registry records and verify repo-local git identity alignment.',
  positional: [
    { name: 'action', summary: 'register | list | resolve | verify-git', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--id', value: 'id', summary: 'Actor id. Required for register; optional for resolve/verify-git when env vars are set.' },
    { flag: '--kind', value: 'kind', summary: 'Actor kind: human | ai-agent | automation.' },
    { flag: '--name', value: 'text', summary: 'Display name for register.' },
    { flag: '--provider', value: 'text', summary: 'Provider label (for example: OpenAI, Anthropic).' },
    { flag: '--editor', value: 'text', summary: 'Editor or host tool label (for example: codex, claude-code).' },
    { flag: '--git-name', value: 'text', summary: 'Expected git user.name for this actor.' },
    { flag: '--git-email', value: 'text', summary: 'Expected git user.email for this actor.' },
    { flag: '--contact', value: 'text', summary: 'Optional contact or owner channel.' },
    { flag: '--capabilities', value: 'csv', summary: 'Comma-separated capability tags.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs actor register --id codex-main --kind ai-agent --name "Codex Main" --provider OpenAI --editor codex --git-name "Codex Agent" --git-email codex@example.local --json',
    'node atm.mjs actor list --json',
    'node atm.mjs actor resolve --id codex-main --json',
    'node atm.mjs actor verify-git --id codex-main --json'
  ]
});
