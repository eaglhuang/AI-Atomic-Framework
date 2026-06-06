import { sweepAtomRefReadability } from '../../../core/src/registry/atom-ref-readability.ts';
import { CliError, makeResult, message } from './shared.ts';

interface ParsedAtomRefArgs {
  readonly subcommand: 'sweep';
  readonly apply: boolean;
  readonly repos: readonly string[];
}

export function runAtomRef(argv: string[]) {
  const options = parseAtomRefArgs(argv);
  const sweep = sweepAtomRefReadability({
    repos: options.repos,
    apply: options.apply
  });
  const failedRepos = sweep.repos.filter((repo) => !repo.ok);
  return makeResult({
    ok: failedRepos.length === 0,
    command: 'atom-ref',
    cwd: process.cwd(),
    messages: [
      failedRepos.length === 0
        ? message('info', 'ATM_ATOM_REF_SWEEP_OK', 'Atom/map readable-ref sweep completed.', {
          repoCount: sweep.repos.length,
          apply: options.apply
        })
        : message('error', 'ATM_ATOM_REF_SWEEP_FAILED', 'Atom/map readable-ref sweep found violations.', {
          repoCount: sweep.repos.length,
          failedRepoCount: failedRepos.length
        })
    ],
    evidence: sweep
  });
}

function parseAtomRefArgs(argv: string[]): ParsedAtomRefArgs {
  const state = {
    subcommand: null as 'sweep' | null,
    apply: false,
    repos: [] as string[]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', 'atom-ref sweep requires a value for --repo', { exitCode: 2 });
      }
      state.repos.push(value);
      index += 1;
      continue;
    }
    if (arg === '--apply') {
      state.apply = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `atom-ref does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.subcommand) {
      throw new CliError('ATM_CLI_USAGE', 'atom-ref accepts only one subcommand', { exitCode: 2 });
    }
    if (arg !== 'sweep') {
      throw new CliError('ATM_CLI_USAGE', 'atom-ref supports only: sweep', { exitCode: 2 });
    }
    state.subcommand = arg;
  }

  if (!state.subcommand) {
    throw new CliError('ATM_CLI_USAGE', 'atom-ref requires a subcommand: sweep', { exitCode: 2 });
  }

  return {
    subcommand: state.subcommand,
    apply: state.apply,
    repos: state.repos
  };
}
