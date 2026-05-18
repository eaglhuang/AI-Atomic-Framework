#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runATMChart } from './commands/atm-chart.ts';
import { runBootstrap } from './commands/bootstrap-entry.ts';
import { runBudget } from './commands/budget.ts';
import { runCreate } from './commands/create.ts';
import { runCreateMap } from './commands/create-map.ts';
import { runDoctor } from './commands/doctor.ts';
import { runExplain } from './commands/explain.ts';
import { runGuard } from './commands/guard.ts';
import { runGuide } from './commands/guide.ts';
import { runHandoff } from './commands/handoff.ts';
import { runInit } from './commands/init.ts';
import { runIntegration } from './commands/integration.ts';
import { runLock } from './commands/lock.ts';
import { runNext } from './commands/next.ts';
import { runOrient } from './commands/orient.ts';
import { runSelfHostAlphaAsync } from './commands/self-host-alpha.ts';
import { runSpec } from './commands/spec.ts';
import { runStart } from './commands/start.ts';
import { runStatus } from './commands/status.ts';
import { runUpgrade } from './commands/upgrade.ts';
import { runTestAsync } from './commands/test.ts';
import { runValidate } from './commands/validate.ts';
import { runVerify } from './commands/verify.ts';
import { runWelcome } from './commands/welcome.ts';
import { runRegistryDiff } from './commands/registry-diff.ts';
import { runReplacementLane } from './commands/replacement-lane.ts';
import { runRollback } from './commands/rollback.ts';
import { runReview } from './commands/review.ts';
import { runReviewAdvisory } from './commands/review-advisory.ts';
import { runMigrate } from './commands/migrate.ts';
import { runAgentPack } from './commands/agent-pack.ts';
import { getCommandSpec, listCommandSpecs } from './commands/command-specs.ts';
import { CliError, makeHelpResult, makeResult, message, writeResult } from './commands/shared.ts';
import { checkStartupKnownBadVersion, isKnownBadReadOnlyCommand } from './startup-known-bad.ts';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from './startup-integrity.ts';

export const cliCommandRunners: Record<string, (argv: any) => any> = {
  'atm-chart': runATMChart,
  bootstrap: runBootstrap,
  budget: runBudget,
  create: runCreate,
  'create-map': runCreateMap,
  doctor: runDoctor,
  explain: runExplain,
  guard: runGuard,
  guide: runGuide,
  handoff: runHandoff,
  init: runInit,
  integration: runIntegration,
  lock: runLock,
  next: runNext,
  orient: runOrient,
  'self-host-alpha': runSelfHostAlphaAsync,
  spec: runSpec,
  start: runStart,
  status: runStatus,
  upgrade: runUpgrade,
  test: runTestAsync,
  validate: runValidate,
  verify: runVerify,
  welcome: runWelcome,
  'registry-diff': runRegistryDiff,
  'replacement-lane': runReplacementLane,
  rollback: runRollback,
  review: runReview,
  'review-advisory': runReviewAdvisory,
  migrate: runMigrate,
  'agent-pack': runAgentPack
};

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const [commandName, ...rawCommandArgs] = argv;
  const outputFormat = selectOutputFormat(argv, io);
  const commandArgs = stripFormatFlags(rawCommandArgs);

  if (!commandName || commandName === '--help' || commandName === '--json' || commandName === '--pretty') {
    writeResult(createGlobalHelpResult(process.cwd()), io.stdout, outputFormat);
    return 0;
  }

  if (commandName === 'help') {
    const targetCommand = commandArgs.find((arg: any) => !arg.startsWith('-'));
    if (!targetCommand) {
      writeResult(createGlobalHelpResult(process.cwd()), io.stdout, outputFormat);
      return 0;
    }
    const spec = getCommandSpec(targetCommand);
    if (!spec) {
      const result = makeResult({
        ok: false,
        command: 'help',
        cwd: process.cwd(),
        messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Unknown command: ${targetCommand}`)],
        evidence: {
          commands: Object.keys(cliCommandRunners)
        }
      });
      writeResult(result, io.stderr, outputFormat);
      return 2;
    }
    writeResult(makeHelpResult(spec, process.cwd()), io.stdout, outputFormat);
    return 0;
  }

  const runner = cliCommandRunners[commandName];
  if (!runner) {
    const result = makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Unknown command: ${commandName}`)],
      evidence: {
        commands: Object.keys(cliCommandRunners)
      }
    });
    writeResult(result, io.stderr, outputFormat);
    return 2;
  }

  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    const spec = getCommandSpec(commandName);
    if (!spec) {
      const result = makeResult({
        ok: false,
        command: commandName,
        cwd: process.cwd(),
        messages: [message('error', 'ATM_CLI_HELP_NOT_FOUND', `No help spec found for ${commandName}.`)],
        evidence: {}
      });
      writeResult(result, io.stderr, outputFormat);
      return 2;
    }
    writeResult(makeHelpResult(spec, process.cwd()), io.stdout, outputFormat);
    return 0;
  }

  if (commandName !== 'doctor') {
    const trustIntegrity = checkStartupIntegrity(resolveBundledIntegrityRoot());
    if (!trustIntegrity.ok) {
      const result = makeResult({
        ok: false,
        command: commandName,
        cwd: process.cwd(),
        messages: [message('error', 'ATM_RELEASE_INTEGRITY_FAILED', 'Bundled ATM release integrity check failed; refusing to run non-read-only commands.', { mode: trustIntegrity.mode })],
        evidence: { trustIntegrity }
      });
      writeResult(result, io.stderr, outputFormat);
      return 1;
    }
  }

  const knownBadStatus = checkStartupKnownBadVersion();
  if (!knownBadStatus.ok && !isKnownBadReadOnlyCommand(commandName, commandArgs)) {
    const result = makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', 'ATM_KNOWN_BAD_VERSION_BLOCKED', 'This ATM CLI version is marked known-bad; refusing to run write-oriented commands.', {
        currentVersion: knownBadStatus.currentVersion,
        replacementVersion: knownBadStatus.match?.replacementVersion ?? null,
        reasonSummary: knownBadStatus.match?.reasonSummary ?? null,
        severity: knownBadStatus.match?.severity ?? null,
        mode: knownBadStatus.mode
      })],
      evidence: { knownBadStatus }
    });
    writeResult(result, io.stderr, outputFormat);
    return 1;
  }

  try {
    const result = await runner(commandArgs);
    writeResult(result, result.ok ? io.stdout : io.stderr, outputFormat);
    return result.ok ? 0 : 1;
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError('ATM_CLI_UNHANDLED', error instanceof Error ? error.message : String(error));
    const result = makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', cliError.code, cliError.message, cliError.details)],
      evidence: {}
    });
    writeResult(result, io.stderr, outputFormat);
    return cliError.exitCode;
  }
}

function createGlobalHelpResult(cwd: any) {
  const commands = listCommandSpecs()
    .map((spec) => ({ command: spec.name, summary: spec.summary }))
    .sort((left, right) => left.command.localeCompare(right.command));
  return makeResult({
    ok: true,
    command: 'help',
    cwd,
    messages: [message('info', 'ATM_CLI_HELP', 'Use "node atm.mjs <command> --help" for command details.')],
    evidence: {
      commands,
      outputModes: ['json', 'pretty']
    }
  });
}

function stripFormatFlags(argv: any) {
  return argv.filter((arg: any) => arg !== '--json' && arg !== '--pretty');
}

function selectOutputFormat(argv: any, io: any) {
  if (argv.includes('--json')) {
    return 'json';
  }
  if (argv.includes('--pretty')) {
    return 'pretty';
  }
  return io.stdout?.isTTY ? 'pretty' : 'json';
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  process.exitCode = await runCli();
}
