import { defineCommandSpec } from '../shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption
} from './_common.ts';

export default defineCommandSpec({
  name: 'internal-release',
  summary: 'Build the ATM framework runner and sync it to explicitly listed internal repositories.',
  positional: [
    { name: 'action', summary: 'sync', required: true }
  ],
  options: [
    commonCwdOption,
    { flag: '--framework-root', value: 'path', summary: 'Alias for --cwd when running from outside the framework repository.' },
    { flag: '--repo', value: 'path', summary: 'Target repository to receive the built ATM runner. Repeatable.' },
    { flag: '--skip', value: 'name-or-path', summary: 'Skip a target repository by basename or resolved path. Repeatable.' },
    { flag: '--exclude', value: 'name-or-path', summary: 'Alias for --skip.' },
    { flag: '--source', value: 'path', summary: 'Runner source path. Defaults to release/atm-onefile/atm.mjs.' },
    { flag: '--no-build', summary: 'Do not run npm run build before syncing.' },
    { flag: '--dry-run', summary: 'Plan sync targets without copying files.' },
    { flag: '--no-verify', summary: 'Do not run target doctor/framework-mode/tasks audit after copying.' },
    { flag: '--allow-verify-failure', summary: 'Report verification failures without failing the sync command.' },
    commonJsonOption,
    commonPrettyOption,
    commonHelpOption
  ],
  examples: [
    'node atm.mjs internal-release sync --repo ../host-a --repo ../host-b --json',
    'node atm.mjs internal-release sync --repo ../host-a --repo ../host-b --skip host-b --json',
    'node atm.mjs internal-release sync --repo ../host-a --no-build --dry-run --json'
  ]
});
