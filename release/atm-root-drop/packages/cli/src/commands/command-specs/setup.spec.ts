import { defineCommandSpec } from '../shared.ts';
import { commonCwdOption, commonHelpOption, commonJsonOption, commonPrettyOption } from './_common.ts';

export default defineCommandSpec({
  name: 'setup', summary: 'Set up ATM in one selected project, discover supported agent configurations, safely reconcile integrations, and verify readiness.',
  positional: [],
  options: [commonCwdOption,
    { flag: '--agents', value: 'csv', summary: 'Explicit adapter IDs, or none for CLI-only setup. Defaults to all detected configurations.' },
    { flag: '--dry-run', summary: 'Inspect the selected target and all integration conflicts without writing.' },
    commonJsonOption, commonPrettyOption, commonHelpOption],
  examples: ['node atm.mjs setup', 'node atm.mjs setup --cwd ../project --json', 'node atm.mjs setup --cwd ../project --agents codex,claude-code --json', 'node atm.mjs setup --cwd ../project --agents none --dry-run --json']
});
