import { runRescuePolice } from '../../../core/src/police/rescue-family.ts';
import { CliError, makeResult, message } from './shared.ts';

interface RescueOptions {
  cwd: string;
  action: string;
  json: boolean;
}

function parseRescueArgs(argv: string[]): RescueOptions {
  const cwd = process.cwd();
  let action = 'police';
  let json = false;

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0) {
    action = positionals[0];
  }

  return { cwd, action, json };
}

export async function runRescue(argv: string[]) {
  const options = parseRescueArgs(argv);

  if (options.action !== 'police') {
    throw new CliError(
      'ATM_CLI_USAGE',
      `rescue only supports subcommand "police" (got "${options.action}"). Usage: atm rescue police`,
      { exitCode: 2 }
    );
  }

  const report = runRescuePolice(options.cwd);

  return makeResult({
    ok: report.healthy,
    command: 'rescue',
    cwd: options.cwd,
    messages: [
      message(
        report.healthy ? 'info' : 'error',
        report.healthy ? 'ATM_RESCUE_HEALTHY' : 'ATM_RESCUE_BLOCKED',
        report.healthy
          ? 'Rescue police: all invariants passed.'
          : `Rescue police: ${report.blockingFindings.length} blocking finding(s) detected.`,
        {
          healthy: report.healthy,
          blockingFindings: report.blockingFindings.length,
          warnings: report.warnings.length,
          skipped: report.skipped.length,
          total: report.findings.length
        }
      )
    ],
    evidence: {
      report
    }
  });
}
