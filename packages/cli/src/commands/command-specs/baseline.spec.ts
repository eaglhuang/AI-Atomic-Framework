import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption,
} from './_common.ts';

export default defineCommandSpec({
  name: 'baseline',
  summary: 'Create, inspect, or restore redteam test baselines for ATM framework work.',
  positional: [
    { name: 'action', summary: 'create | status | restore', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--repo', value: 'path', summary: 'Repository path for baseline operations.' },
    { flag: '--name', value: 'name', summary: 'Baseline name, usually a git tag such as atm-redteam-baseline-2026-05-24.' },
    { flag: '--worktree-only', summary: 'Required for restore; resets the current test worktree to the baseline commit.' },
    { flag: '--force', summary: 'Allow restore on main/master/trunk. Use only for explicit recovery.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs baseline create --name atm-redteam-baseline-2026-05-24 --json',
    'node atm.mjs baseline status --name atm-redteam-baseline-2026-05-24 --json',
    'node atm.mjs baseline restore --name atm-redteam-baseline-2026-05-24 --worktree-only --json'
  ]
});
