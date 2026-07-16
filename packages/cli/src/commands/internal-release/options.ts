import path from 'node:path';
import { CliError } from '../shared.ts';
import type { InternalReleaseSyncOptions } from './types.ts';

export function parseInternalReleaseSyncOptions(argv: string[]): InternalReleaseSyncOptions {
  const repos: string[] = [];
  const skips: string[] = [];
  const options = {
    cwd: process.cwd(),
    build: true,
    dryRun: false,
    verify: true,
    allowVerifyFailure: false,
    source: null as string | null,
    keepTemp: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--framework-root') {
      options.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      repos.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--skip' || arg === '--exclude') {
      skips.push(requireValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--source') {
      options.source = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--no-build') {
      options.build = false;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-verify') {
      options.verify = false;
      continue;
    }
    if (arg === '--allow-verify-failure') {
      options.allowVerifyFailure = true;
      continue;
    }
    if (arg === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    throw new CliError('ATM_CLI_USAGE', `internal-release sync does not support option ${arg}`, { exitCode: 2 });
  }
  return {
    cwd: path.resolve(options.cwd),
    repos,
    skips,
    build: options.build,
    dryRun: options.dryRun,
    verify: options.verify,
    allowVerifyFailure: options.allowVerifyFailure,
    source: options.source,
    keepTemp: options.keepTemp
  };
}

function requireValue(argv: readonly string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `${flag} requires a value.`, { exitCode: 2 });
  }
  return value;
}
