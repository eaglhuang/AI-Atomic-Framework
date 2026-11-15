import path from 'node:path';
import { upgradeCharter } from '../../../plugin-governance-local/src/index.ts';
import { CliError, makeResult, message } from './shared.ts';
import { readFrameworkVersion } from './shared/result-core.ts';

const usage = 'Usage: node atm.mjs charter upgrade [--dry-run|--write] [--enforce-now] [--cwd <path>] --json';

// `atm charter upgrade` moves an adopter's AtomicCharter to the charter bundled
// with this ATM release. Dry-run is the default; --write applies the upgrade
// and records a receipt with the previous files for review or rollback.
export function runCharter(argv: string[]) {
  const action = argv.find((entry) => !entry.startsWith('-'));
  if (action !== 'upgrade') {
    throw new CliError('ATM_CLI_USAGE', `charter supports only: upgrade. ${usage}`, { exitCode: 2 });
  }
  const cwdIndex = argv.indexOf('--cwd');
  const cwd = path.resolve(cwdIndex >= 0 && argv[cwdIndex + 1] ? argv[cwdIndex + 1] : process.cwd());
  const write = argv.includes('--write') && !argv.includes('--dry-run');
  const report = upgradeCharter({
    cwd,
    write,
    enforceNow: argv.includes('--enforce-now'),
    frameworkVersion: readFrameworkVersion()
  });

  if (report.status === 'conflict') {
    return makeResult({
      ok: false,
      command: 'charter',
      cwd,
      messages: [message('error', 'ATM_CHARTER_UPGRADE_CONFLICT', 'The AtomicCharter cannot be upgraded automatically; no files were changed.', {
        conflicts: report.conflicts
      })],
      evidence: report
    });
  }

  const summary = report.status === 'current'
    ? `AtomicCharter is already at the bundled version ${report.bundledVersion}.`
    : report.written
      ? `AtomicCharter upgraded from ${report.currentVersion ?? 'none'} to ${report.bundledVersion}. Rerun node atm.mjs integration add <editor-id> --force --json to refresh agent skills.`
      : `AtomicCharter ${report.currentVersion ?? 'none'} can be upgraded to ${report.bundledVersion}. Rerun with --write to apply.`;
  return makeResult({
    ok: true,
    command: 'charter',
    cwd,
    messages: [message('info', 'ATM_CHARTER_UPGRADE_OK', summary, {
      status: report.status,
      written: report.written,
      addedInvariants: report.addedInvariants,
      advisoryUntilFrameworkVersion: report.advisoryUntilFrameworkVersion
    })],
    evidence: report
  });
}
