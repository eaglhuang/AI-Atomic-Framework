#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommandSpec, listCommandSpecs } from './commands/command-specs.ts';
import { applyOutputProjectionFlagsFromArgv, CliError, enrichCommandResult, makeHelpResult, makeResult, message, readFrameworkVersion, writeResult, type CommandResult } from './commands/shared.ts';
import { checkStartupKnownBadVersion, isKnownBadReadOnlyCommand } from './startup-known-bad.ts';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from './startup-integrity.ts';
import { runIdentity } from './commands/identity.ts';
import { runBroker } from './commands/broker.ts';
import { runRoute } from './commands/route.ts';
import { inspectRunnerSourceDrift } from './commands/framework-development/closure-packet-schema.ts';
import { describeRunnerMode } from './commands/next/runner-mode.ts';

type CliRunner = (argv: string[]) => Promise<CommandResult | object> | CommandResult | object;
function lazyRunner(modulePath: string, exportName: string): CliRunner {
  return async (argv) => {
    const module = await import(modulePath) as Record<string, unknown>;
    const runner = module[exportName];
    if (typeof runner !== 'function') throw new Error(`CLI runner export ${exportName} missing from ${modulePath}`);
    return (runner as CliRunner)(argv);
  };
}

export const cliCommandRunners: Record<string, CliRunner> = {
  atomize: lazyRunner('./commands/atomize.ts', 'runAtomize'),
  'atm-chart': lazyRunner('./commands/atm-chart.ts', 'runATMChart'),
  baseline: lazyRunner('./commands/baseline.ts', 'runBaseline'),
  batch: lazyRunner('./commands/batch.ts', 'runBatch'),
  bootstrap: lazyRunner('./commands/bootstrap-entry.ts', 'runBootstrap'),
  budget: lazyRunner('./commands/budget.ts', 'runBudget'),
  candidates: lazyRunner('./commands/candidates.ts', 'runCandidates'),
  create: lazyRunner('./commands/create.ts', 'runCreate'),
  'create-map': lazyRunner('./commands/create-map.ts', 'runCreateMap'),
  doctor: lazyRunner('./commands/doctor.ts', 'runDoctor'),
  emergency: lazyRunner('./commands/emergency.ts', 'runEmergency'),
  explain: lazyRunner('./commands/explain.ts', 'runExplain'),
  experience: lazyRunner('./commands/experience.ts', 'runExperience'),
  evidence: lazyRunner('./commands/evidence.ts', 'runEvidence'),
  'framework-mode': lazyRunner('./commands/framework-development.ts', 'runFrameworkMode'),
  git: lazyRunner('./commands/git-governance.ts', 'runAtmGit'),
  guard: lazyRunner('./commands/guard.ts', 'runGuard'),
  hook: lazyRunner('./commands/hook.ts', 'runHook'),
  guide: lazyRunner('./commands/guide.ts', 'runGuide'),
  handoff: lazyRunner('./commands/handoff.ts', 'runHandoff'),
  init: lazyRunner('./commands/init.ts', 'runInit'),
  'internal-release': lazyRunner('./commands/internal-release.ts', 'runInternalRelease'),
  'git-hooks': lazyRunner('./commands/hook.ts', 'runGitHooks'),
  integration: lazyRunner('./commands/integration.ts', 'runIntegration'),
  lane: lazyRunner('./commands/lane.ts', 'runLane'),
  lock: lazyRunner('./commands/lock.ts', 'runLock'),
  next: lazyRunner('./commands/next.ts', 'runNext'),
  orient: lazyRunner('./commands/orient.ts', 'runOrient'),
  plan: lazyRunner('./commands/plan.ts', 'runPlan'),
  police: lazyRunner('./commands/police.ts', 'runPolice'),
  quickfix: lazyRunner('./commands/quickfix.ts', 'runQuickfix'),
  residue: lazyRunner('./commands/residue.ts', 'runResidue'),
  'self-host-alpha': lazyRunner('./commands/self-host-alpha.ts', 'runSelfHostAlphaAsync'),
  spec: lazyRunner('./commands/spec.ts', 'runSpec'),
  start: lazyRunner('./commands/start.ts', 'runStart'),
  status: lazyRunner('./commands/status.ts', 'runStatus'),
  tasks: lazyRunner('./commands/tasks.ts', 'runTasks'),
  upgrade: lazyRunner('./commands/upgrade.ts', 'runUpgrade'),
  telemetry: lazyRunner('./commands/telemetry.ts', 'runTelemetry'),
  team: lazyRunner('./commands/team.ts', 'runTeam'),
  test: lazyRunner('./commands/test.ts', 'runTestAsync'),
  validate: lazyRunner('./commands/validate.ts', 'runValidate'),
  verify: lazyRunner('./commands/verify.ts', 'runVerify'),
  welcome: lazyRunner('./commands/welcome.ts', 'runWelcome'),
  registry: lazyRunner('./commands/registry.ts', 'runRegistry'),
  'registry-diff': lazyRunner('./commands/registry-diff.ts', 'runRegistryDiff'),
  'replacement-lane': lazyRunner('./commands/replacement-lane.ts', 'runReplacementLane'),
  rollback: lazyRunner('./commands/rollback.ts', 'runRollback'),
  review: lazyRunner('./commands/review.ts', 'runReview'),
  'review-advisory': lazyRunner('./commands/review-advisory.ts', 'runReviewAdvisory'),
  migrate: lazyRunner('./commands/migrate.ts', 'runMigrate'),
  'agent-pack': lazyRunner('./commands/agent-pack.ts', 'runAgentPack'),
  actor: lazyRunner('./commands/actor.ts', 'runActor'),
  'atom-ref': lazyRunner('./commands/atom-ref.ts', 'runAtomRef'),
  'atom-capsule': lazyRunner('./commands/atom-capsule.ts', 'runAtomCapsule'),
  'map-capsule': lazyRunner('./commands/map-capsule.ts', 'runMapCapsule'),
  rescue: lazyRunner('./commands/rescue.ts', 'runRescue'),
  daemon: lazyRunner('./commands/daemon.ts', 'runDaemon'),
  cache: lazyRunner('./commands/cache.ts', 'runCache'),
  cleanup: lazyRunner('./commands/cleanup/index.ts', 'runCleanup'),
  'health-report': lazyRunner('./commands/health-report.ts', 'runHealthReport'),
  identity: lazyRunner('./commands/identity.ts', 'runIdentity'),
  taskflow: lazyRunner('./commands/taskflow.ts', 'runTaskflow'),
  'task-view': lazyRunner('./commands/task-view.ts', 'runTaskView'),
  broker: lazyRunner('./commands/broker.ts', 'runBroker'),
  route: lazyRunner('./commands/route.ts', 'runRoute'),
  'write-ticket': lazyRunner('./commands/write-ticket.ts', 'runWriteTicket')
};

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  applyOutputProjectionFlagsFromArgv(argv);
  const [commandName, ...rawCommandArgs] = argv;
  const outputFormat = selectOutputFormat(argv, io);
  const commandArgs = stripFormatFlags(rawCommandArgs);

  if (!commandName || commandName === '--help' || commandName === '--json' || commandName === '--pretty') {
    const result = enrichCommandResult(createGlobalHelpResult(process.cwd()));
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
      const result = enrichCommandResult(createGlobalHelpResult(process.cwd()));
      writeResult(result, io.stdout, outputFormat);
      return result.exitCode;
    }
    const spec = getCommandSpec(targetCommand);
    if (!spec) {
      const result = enrichCommandResult(makeResult({
        ok: false,
        command: 'help',
        cwd: process.cwd(),
        messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Unknown command: ${targetCommand}`)],
        evidence: {
          commands: Object.keys(cliCommandRunners)
        }
      }));
      writeResult(result, io.stderr, outputFormat);
      return result.exitCode;
    }
    const result = enrichCommandResult(makeHelpResult(spec, process.cwd()));
    writeResult(result, io.stdout, outputFormat);
    return result.exitCode;
  }

  const runner = cliCommandRunners[commandName];
  if (!runner) {
    const result = enrichCommandResult(makeResult({
      ok: false,
      command: commandName,
      cwd: process.cwd(),
      messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', `Unknown command: ${commandName}`)],
      evidence: {
        commands: Object.keys(cliCommandRunners)
      }
    }));
    writeResult(result, io.stderr, outputFormat);
    return result.exitCode;
  }

  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    const spec = getCommandSpec(commandName);
    if (!spec) {
      const result = enrichCommandResult(makeResult({
        ok: false,
        command: commandName,
        cwd: process.cwd(),
        messages: [message('error', 'ATM_CLI_HELP_NOT_FOUND', `No help spec found for ${commandName}.`)],
        evidence: {}
      }));
      writeResult(result, io.stderr, outputFormat);
      return result.exitCode;
    }
    // ATM-GOV-0364: `atm tasks import --help` asks about `import`, not about
    // every flag registered under `tasks`. The first bare token is the
    // subcommand the caller is actually asking about.
    const helpSubcommand = commandArgs.find((arg) => !arg.startsWith('-'));
    const result = enrichCommandResult(makeHelpResult(spec, process.cwd(), helpSubcommand));
    writeResult(result, io.stdout, outputFormat);
    return result.exitCode;
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
      evidence: {}
    }), { cliErrorExitCode: cliError.exitCode });
    writeResult(result, io.stderr, outputFormat);
    return result.exitCode;
  }
}

function createGlobalHelpResult(cwd: string) {
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
    evidence: {
      frameworkVersion: version,
      runnerMode,
      runnerSourceDrift
    }
  });
}

function stripFormatFlags(argv: string[]) {
  return argv.filter((arg) => arg !== '--json' && arg !== '--pretty');
}

function selectOutputFormat(argv: string[], io: { stdout?: { isTTY?: boolean } | null; stderr?: unknown }) {
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
