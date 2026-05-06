#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './commands/init.mjs';
import { runStatus } from './commands/status.mjs';
import { runValidate } from './commands/validate.mjs';
import { CliError, makeResult, message, writeResult } from './commands/shared.mjs';

export const cliCommandRunners = {
  init: runInit,
  status: runStatus,
  validate: runValidate
};

export function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const [commandName, ...commandArgs] = argv;

  if (!commandName || commandName === '--help' || commandName === 'help') {
    const result = makeResult({
      ok: true,
      command: 'help',
      cwd: process.cwd(),
      messages: [message('info', 'ATM_CLI_HELP', 'Available commands: init, status, validate.')],
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
    const result = runner(commandArgs);
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
  process.exitCode = runCli();
}