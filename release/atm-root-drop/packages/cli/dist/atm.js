#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAtomize } from './commands/atomize.js';
import { runATMChart } from './commands/atm-chart.js';
import { runBaseline } from './commands/baseline.js';
import { runBatch } from './commands/batch.js';
import { runBootstrap } from './commands/bootstrap-entry.js';
import { runBudget } from './commands/budget.js';
import { runCandidates } from './commands/candidates.js';
import { runCreate } from './commands/create.js';
import { runCreateMap } from './commands/create-map.js';
import { runDoctor } from './commands/doctor.js';
import { runEmergency } from './commands/emergency.js';
import { runExplain } from './commands/explain.js';
import { runExperience } from './commands/experience.js';
import { runEvidence } from './commands/evidence.js';
import { runFrameworkMode } from './commands/framework-development.js';
import { runGuard } from './commands/guard.js';
import { runGitHooks, runHook } from './commands/hook.js';
import { runAtmGit } from './commands/git-governance.js';
import { runGuide } from './commands/guide.js';
import { runHandoff } from './commands/handoff.js';
import { runInit } from './commands/init.js';
import { runInternalRelease } from './commands/internal-release.js';
import { runIntegration } from './commands/integration.js';
import { runLane } from './commands/lane.js';
import { runLock } from './commands/lock.js';
import { runNext } from './commands/next.js';
import { runOrient } from './commands/orient.js';
import { runPolice } from './commands/police.js';
import { runQuickfix } from './commands/quickfix.js';
import { runResidue } from './commands/residue.js';
import { runSelfHostAlphaAsync } from './commands/self-host-alpha.js';
import { runSpec } from './commands/spec.js';
import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runTasks } from './commands/tasks.js';
import { runUpgrade } from './commands/upgrade.js';
import { runTestAsync } from './commands/test.js';
import { runTelemetry } from './commands/telemetry.js';
import { runTeam } from './commands/team.js';
import { runValidate } from './commands/validate.js';
import { runVerify } from './commands/verify.js';
import { runWelcome } from './commands/welcome.js';
import { runRegistryDiff } from './commands/registry-diff.js';
import { runRegistry } from './commands/registry.js';
import { runReplacementLane } from './commands/replacement-lane.js';
import { runRollback } from './commands/rollback.js';
import { runReview } from './commands/review.js';
import { runReviewAdvisory } from './commands/review-advisory.js';
import { runMigrate } from './commands/migrate.js';
import { runAgentPack } from './commands/agent-pack.js';
import { runActor } from './commands/actor.js';
import { runAtomRef } from './commands/atom-ref.js';
import { runAtomCapsule } from './commands/atom-capsule.js';
import { runMapCapsule } from './commands/map-capsule.js';
import { runRescue } from './commands/rescue.js';
import { runDaemon } from './commands/daemon.js';
import { runCache } from './commands/cache.js';
import { runHealthReport } from './commands/health-report.js';
import { runTaskflow } from './commands/taskflow.js';
import { runTaskView } from './commands/task-view.js';
import { getCommandSpec, listCommandSpecs } from './commands/command-specs.js';
import { applyOutputProjectionFlagsFromArgv, CliError, enrichCommandResult, makeHelpResult, makeResult, message, readFrameworkVersion, writeResult } from './commands/shared.js';
import { checkStartupKnownBadVersion, isKnownBadReadOnlyCommand } from './startup-known-bad.js';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from './startup-integrity.js';
import { runIdentity } from './commands/identity.js';
import { runBroker } from './commands/broker.js';
import { runRoute } from './commands/route.js';
import { inspectRunnerSourceDrift } from './commands/framework-development/closure-packet-schema.js';
import { describeRunnerMode } from './commands/next/runner-mode.js';
export const cliCommandRunners = {
    atomize: runAtomize,
    'atm-chart': runATMChart,
    baseline: runBaseline,
    batch: runBatch,
    bootstrap: runBootstrap,
    budget: runBudget,
    candidates: runCandidates,
    create: runCreate,
    'create-map': runCreateMap,
    doctor: runDoctor,
    emergency: runEmergency,
    explain: runExplain,
    experience: runExperience,
    evidence: runEvidence,
    'framework-mode': runFrameworkMode,
    git: runAtmGit,
    guard: runGuard,
    hook: runHook,
    guide: runGuide,
    handoff: runHandoff,
    init: runInit,
    'internal-release': runInternalRelease,
    'git-hooks': runGitHooks,
    integration: runIntegration,
    lane: runLane,
    lock: runLock,
    next: runNext,
    orient: runOrient,
    police: runPolice,
    quickfix: runQuickfix,
    residue: runResidue,
    'self-host-alpha': runSelfHostAlphaAsync,
    spec: runSpec,
    start: runStart,
    status: runStatus,
    tasks: runTasks,
    upgrade: runUpgrade,
    telemetry: runTelemetry,
    team: runTeam,
    test: runTestAsync,
    validate: runValidate,
    verify: runVerify,
    welcome: runWelcome,
    registry: runRegistry,
    'registry-diff': runRegistryDiff,
    'replacement-lane': runReplacementLane,
    rollback: runRollback,
    review: runReview,
    'review-advisory': runReviewAdvisory,
    migrate: runMigrate,
    'agent-pack': runAgentPack,
    actor: runActor,
    'atom-ref': runAtomRef,
    'atom-capsule': runAtomCapsule,
    'map-capsule': runMapCapsule,
    rescue: runRescue,
    daemon: runDaemon,
    cache: runCache,
    'health-report': runHealthReport,
    identity: runIdentity,
    taskflow: runTaskflow,
    'task-view': runTaskView,
    broker: runBroker,
    route: runRoute
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
        const result = enrichCommandResult(makeHelpResult(spec, process.cwd()));
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
        const result = enrichCommandResult(rawResult);
        writeResult(result, result.ok ? io.stdout : io.stderr, outputFormat);
        return result.exitCode;
    }
    catch (error) {
        const cliError = error instanceof CliError
            ? error
            : new CliError('ATM_CLI_UNHANDLED', error instanceof Error ? error.message : String(error));
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
function createGlobalHelpResult(cwd) {
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
function createVersionResult(cwd) {
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
function stripFormatFlags(argv) {
    return argv.filter((arg) => arg !== '--json' && arg !== '--pretty');
}
function selectOutputFormat(argv, io) {
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
