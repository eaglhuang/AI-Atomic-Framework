#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBootstrap } from './commands/bootstrap-entry.mjs';
import { runCreate } from './commands/create.mjs';
import { runCreateMap } from './commands/create-map.mjs';
import { runGuide } from './commands/guide.mjs';
import { runInit } from './commands/init.mjs';
import { runSelfHostAlphaAsync } from './commands/self-host-alpha.mjs';
import { runSpec } from './commands/spec.mjs';
import { runStatus } from './commands/status.mjs';
import { runUpgrade } from './commands/upgrade.mjs';
import { runTestAsync } from './commands/test.mjs';
import { runValidate } from './commands/validate.mjs';
import { runVerify } from './commands/verify.mjs';
import { runRegistryDiff } from './commands/registry-diff.mjs';
import { runReview } from './commands/review.mjs';
import { CliError, makeResult, message, writeResult } from './commands/shared.mjs';

export const cliCommandRunners = {
  bootstrap: runBootstrap,
  create: runCreate,
  'create-map': runCreateMap,
  guide: runGuide,
  init: runInit,
  'self-host-alpha': runSelfHostAlphaAsync,
  spec: runSpec,
  status: runStatus,
  upgrade: runUpgrade,
  test: runTestAsync,
  validate: runValidate,
  verify: runVerify,
  'registry-diff': runRegistryDiff,
  review: runReview
};

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const [commandName, ...commandArgs] = argv;

  if (!commandName || commandName === '--help' || commandName === 'help') {
    const result = makeResult({
      ok: true,
      command: 'help',
      cwd: process.cwd(),
      messages: [message('info', 'ATM_CLI_HELP', 'Available commands: bootstrap, create, create-map, guide, init, review, self-host-alpha, spec, status, upgrade, test, validate, verify.')],
      evidence: {
        commands: Object.keys(cliCommandRunners),
        outputFormat: 'json'
      }
    });
    writeResult(result, io.stdout);
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
    writeResult(result, io.stderr);
    return 2;
  }

  try {
    const result = await runner(commandArgs);
    writeResult(result, result.ok ? io.stdout : io.stderr);
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
    writeResult(result, io.stderr);
    return cliError.exitCode;
  }
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  process.exitCode = await runCli();
}