#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommandSpec } from './commands/command-specs.ts';
import { applyOutputProjectionFlagsFromArgv, CliError, enrichCommandResult, makeHelpResult, makeResult, message, readFrameworkVersion, writeResult, type CommandResult } from './commands/shared.ts';
import { checkStartupKnownBadVersion, isKnownBadReadOnlyCommand } from './startup-known-bad.ts';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from './startup-integrity.ts';
import { inspectRunnerSourceDrift } from './commands/framework-development/closure-packet-schema.ts';
import { describeRunnerMode } from './commands/next/runner-mode.ts';
import { runNext } from './commands/next.ts';
import { runDoctor } from './commands/doctor.ts';
import { runGuide } from './commands/guide.ts';
import { runInit } from './commands/init.ts';
import { runCreate } from './commands/create.ts';
import { runTaskflow } from './commands/taskflow.ts';
import { runWelcome } from './commands/welcome.ts';
import { runStatus } from './commands/status.ts';
import { runVerify } from './commands/verify.ts';
import { runOrient } from './commands/orient.ts';
import { runEvidence } from './commands/evidence.ts';
import { runLock } from './commands/lock.ts';
import { runBroker } from './commands/broker.ts';
import { runAtmGit } from './commands/git-governance.ts';
import { runIntegration } from './commands/integration.ts';
import { runPlan } from './commands/plan.ts';
import { runActor } from './commands/actor.ts';
import { runBootstrap } from './commands/bootstrap-entry.ts';
import { runStart } from './commands/start.ts';
import { runTasks } from './commands/tasks.ts';
import { runATMChart } from './commands/atm-chart.ts';

type CliRunner = (argv: string[]) => Promise<CommandResult | object> | CommandResult | object;

/**
 * The npm package is an adopter-facing facade. The framework runner keeps the
 * complete command surface in atm.ts; this registry is intentionally explicit
 * so the published bundle has a measurable, reviewable boundary.
 */
export const publicCliCommandNames = [
  'next', 'doctor', 'guide', 'init', 'create', 'taskflow', 'welcome',
  'status', 'verify', 'orient', 'evidence', 'lock', 'broker', 'git',
  'integration', 'plan', 'actor', 'bootstrap', 'start', 'tasks', 'atm-chart'
] as const;

export const publicCliCommandRunners: Record<string, CliRunner> = {
  next: runNext,
  doctor: runDoctor,
  guide: runGuide,
  init: runInit,
  create: runCreate,
  taskflow: runTaskflow,
  welcome: runWelcome,
  status: runStatus,
  verify: runVerify,
  orient: runOrient,
  evidence: runEvidence,
  lock: runLock,
  broker: runBroker,
  git: runAtmGit,
  integration: runIntegration,
  plan: runPlan,
  actor: runActor,
  bootstrap: runBootstrap,
  start: runStart,
  tasks: runTasks,
  'atm-chart': runATMChart
};

export async function runPublicCli(
  argv = process.argv.slice(2),
  io = { stdout: process.stdout, stderr: process.stderr }
) {
  applyOutputProjectionFlagsFromArgv(argv);
  const [commandName, ...rawCommandArgs] = argv;
  const outputFormat = selectOutputFormat(argv, io);
  const commandArgs = stripFormatFlags(rawCommandArgs);

  if (!commandName || commandName === '--help' || commandName === '--json' || commandName === '--pretty') {
    const result = enrichCommandResult(createPublicHelpResult(process.cwd()));
    writeResult(result, io.stdout, outputFormat);
    return result.exitCode;
  }

  if (commandName === '--version' || commandName === '-v') {
    const result = enrichCommandResult(createVersionResult(process.cwd()));
    writeResult(result, io.stdout, outputFormat);
    return result.exitCode;
  }

  if (commandName === 'help') {
    const targetCommand = commandArgs.find((arg) => !arg.startsWith('-'));
    if (!targetCommand) {
      const result = enrichCommandResult(createPublicHelpResult(process.cwd()));
      writeResult(result, io.stdout, outputFormat);
      return result.exitCode;
    }
    return writeHelp(targetCommand, commandArgs, io, outputFormat);
  }

  const runner = publicCliCommandRunners[commandName];
  if (!runner) {
    const result = enrichCommandResult(makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Command ${commandName} is not part of the published adopter runtime.`)],
      evidence: {
        publicSurface: 'adopter-core',
        availableCommands: [...publicCliCommandNames].sort()
      }
    }));
    writeResult(result, io.stderr, outputFormat);
    return result.exitCode;
  }

  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    return writeHelp(commandName, commandArgs, io, outputFormat);
  }

  if (commandName !== 'doctor') {
    const trustIntegrity = checkStartupIntegrity(resolveBundledIntegrityRoot());
    if (!trustIntegrity.ok) {
      const result = enrichCommandResult(makeResult({
        ok: false,
        command: commandName,
        cwd: process.cwd(),
        messages: [message('error', 'ATM_RELEASE_INTEGRITY_FAILED', 'Bundled ATM release integrity check failed; refusing to run non-read-only commands.', { mode: trustIntegrity.mode })],
        evidence: { trustIntegrity }
      }));
      writeResult(result, io.stderr, outputFormat);
      return result.exitCode;
    }
  }

  const knownBadStatus = checkStartupKnownBadVersion();
  if (!knownBadStatus.ok && !isKnownBadReadOnlyCommand(commandName, commandArgs)) {
    const result = enrichCommandResult(makeResult({
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
    }));
    writeResult(result, io.stderr, outputFormat);
    return result.exitCode;
  }

  try {
    const rawResult = await runner(commandArgs);
    const result = enrichCommandResult(rawResult as CommandResult);
    writeResult(result, result.ok ? io.stdout : io.stderr, outputFormat);
    return result.exitCode;
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError('ATM_CLI_UNHANDLED', error instanceof Error ? error.message : String(error), {
        details: { stack: error instanceof Error ? error.stack ?? null : null }
      });
    const result = enrichCommandResult(makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', cliError.code, cliError.message, cliError.details)],
      evidence: { publicSurface: 'adopter-core' }
    }), { cliErrorExitCode: cliError.exitCode });
    writeResult(result, io.stderr, outputFormat);
    return result.exitCode;
  }
}

function writeHelp(
  commandName: string,
  commandArgs: readonly string[],
  io: { stdout: { write(value: string): void }; stderr: { write(value: string): void } },
  outputFormat: 'json' | 'pretty'
) {
  const spec = publicCliCommandNames.includes(commandName as typeof publicCliCommandNames[number])
    ? getCommandSpec(commandName)
    : null;
  const result = spec
    ? enrichCommandResult(makeHelpResult(spec, process.cwd(), commandArgs.find((arg) => !arg.startsWith('-'))))
    : enrichCommandResult(makeResult({
        ok: false,
        command: 'help',
        cwd: process.cwd(),
        messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Command ${commandName} is not part of the published adopter runtime.`)],
        evidence: { publicSurface: 'adopter-core', availableCommands: [...publicCliCommandNames].sort() }
      }));
  writeResult(result, result.ok ? io.stdout : io.stderr, outputFormat);
  return result.exitCode;
}

function createPublicHelpResult(cwd: string) {
  return makeResult({
    ok: true,
    command: 'help',
    cwd,
    messages: [message('info', 'ATM_CLI_HELP', 'Use "node atm.mjs <command> --help" for command details.')],
    evidence: {
      publicSurface: 'adopter-core',
      commands: [...publicCliCommandNames]
        .map((command) => ({ command, summary: getCommandSpec(command)?.summary ?? 'Published adopter command' }))
        .sort((left, right) => left.command.localeCompare(right.command)),
      outputModes: ['json', 'pretty']
    }
  });
}

function createVersionResult(cwd: string) {
  const version = readFrameworkVersion();
  const runnerMode = describeRunnerMode(cwd);
  const runnerSourceDrift = inspectRunnerSourceDrift(cwd);
  return makeResult({
    ok: true,
    command: 'version',
    cwd,
    messages: [
      message('info', 'ATM_CLI_VERSION', `ATM framework version ${version}.`),
      ...(runnerSourceDrift.syncRequired
        ? [message('warning', 'ATM_RUNNER_SOURCE_DRIFT', runnerSourceDrift.advisory, runnerSourceDrift)]
        : [])
    ],
    evidence: { frameworkVersion: version, runnerMode, runnerSourceDrift, publicSurface: 'adopter-core' }
  });
}

function stripFormatFlags(argv: readonly string[]) {
  return argv.filter((arg) => arg !== '--json' && arg !== '--pretty');
}

function selectOutputFormat(argv: readonly string[], io: { stdout?: { isTTY?: boolean } | null; stderr?: unknown }) {
  if (argv.includes('--json')) return 'json' as const;
  if (argv.includes('--pretty')) return 'pretty' as const;
  return io.stdout?.isTTY ? 'pretty' as const : 'json' as const;
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  process.exitCode = await runPublicCli();
}
