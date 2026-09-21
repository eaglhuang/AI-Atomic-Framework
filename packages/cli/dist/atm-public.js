#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCommandSpec } from './commands/command-specs.js';
import { applyOutputProjectionFlagsFromArgv, CliError, enrichCommandResult, makeHelpResult, makeResult, message, readFrameworkVersion, writeResult } from './commands/shared.js';
import { checkStartupKnownBadVersion, isKnownBadReadOnlyCommand } from './startup-known-bad.js';
import { checkStartupIntegrity, resolveBundledIntegrityRoot } from './startup-integrity.js';
import { inspectRunnerSourceDrift } from './commands/framework-development/closure-packet-schema.js';
import { describeRunnerMode } from './commands/next/runner-mode.js';
import { runNext } from './commands/next.js';
import { runDoctor } from './commands/doctor.js';
import { runGuide } from './commands/guide.js';
import { runInit } from './commands/init.js';
import { runCreate } from './commands/create.js';
import { runTaskflow } from './commands/taskflow.js';
import { runWelcome } from './commands/welcome.js';
import { runStatus } from './commands/status.js';
import { runVerify } from './commands/verify.js';
import { runOrient } from './commands/orient.js';
import { runEvidence } from './commands/evidence.js';
import { runLock } from './commands/lock.js';
import { runBroker } from './commands/broker.js';
import { runAtmGit } from './commands/git-governance.js';
import { runIntegration } from './commands/integration.js';
import { runPlan } from './commands/plan.js';
import { runActor } from './commands/actor.js';
import { runBootstrap } from './commands/bootstrap-entry.js';
import { runStart } from './commands/start.js';
import { runTasks } from './commands/tasks.js';
import { runATMChart } from './commands/atm-chart.js';
/**
 * The npm package is an adopter-facing facade. The framework runner keeps the
 * complete command surface in atm.ts; this registry is intentionally explicit
 * so the published bundle has a measurable, reviewable boundary.
 */
export const publicCliCommandRunners = {
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
export const publicCliCommandNames = Object.keys(publicCliCommandRunners);
export async function runPublicCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
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
    const runner = Object.hasOwn(publicCliCommandRunners, commandName)
        ? publicCliCommandRunners[commandName]
        : undefined;
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
        const result = enrichCommandResult(rawResult);
        writeResult(result, result.ok ? io.stdout : io.stderr, outputFormat);
        return result.exitCode;
    }
    catch (error) {
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
function writeHelp(commandName, commandArgs, io, outputFormat) {
    const spec = publicCliCommandNames.includes(commandName)
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
function createPublicHelpResult(cwd) {
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
        evidence: { frameworkVersion: version, runnerMode, runnerSourceDrift, publicSurface: 'adopter-core' }
    });
}
function stripFormatFlags(argv) {
    return argv.filter((arg) => arg !== '--json' && arg !== '--pretty');
}
function selectOutputFormat(argv, io) {
    if (argv.includes('--json'))
        return 'json';
    if (argv.includes('--pretty'))
        return 'pretty';
    return io.stdout?.isTTY ? 'pretty' : 'json';
}
const isDirectRun = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
if (isDirectRun) {
    process.exitCode = await runPublicCli();
}
