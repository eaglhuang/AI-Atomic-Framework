import assert from 'node:assert/strict';
import { runCli } from '../../packages/cli/src/atm.ts';
import {
  enrichCommandResult,
  makeResult,
  message
} from '../../packages/cli/src/commands/shared.ts';

function captureCli(args: string[]) {
  let stdout = '';
  let stderr = '';
  const exitCodePromise = runCli(args, {
    stdout: { write(chunk: string) { stdout += chunk; return true; } },
    stderr: { write(chunk: string) { stderr += chunk; return true; } }
  } as any);
  return exitCodePromise.then((exitCode) => ({
    exitCode,
    stdout,
    stderr,
    payload: JSON.parse((stdout || stderr).trim())
  }));
}

// === unit: severity taxonomy ===
const advisory = enrichCommandResult(makeResult({
  ok: true,
  command: 'upgrade',
  cwd: process.cwd(),
  messages: [message('warn', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'blocked gates', {})]
}));
assert.equal(advisory.severity, 'advisory');
assert.equal(advisory.exitCode, 0);
assert.equal(advisory.blocking, false);

const blocked = enrichCommandResult(makeResult({
  ok: false,
  command: 'next',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'switch repo', {})],
  evidence: { nextAction: { status: 'blocked' } }
}));
assert.equal(blocked.severity, 'blocked');
assert.equal(blocked.exitCode, 1);
assert.equal(blocked.blocking, true);

const usage = enrichCommandResult(makeResult({
  ok: false,
  command: 'help',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_CLI_UNKNOWN_COMMAND', 'unknown', {})]
}));
assert.equal(usage.severity, 'usage-error');
assert.equal(usage.exitCode, 2);
assert.equal(usage.blocking, true);

const failure = enrichCommandResult(makeResult({
  ok: false,
  command: 'doctor',
  cwd: process.cwd(),
  messages: [message('error', 'ATM_DOCTOR_GIT_EVIDENCE_MISSING', 'missing evidence', {})]
}));
assert.equal(failure.severity, 'failure');
assert.equal(failure.exitCode, 1);
assert.equal(failure.blocking, true);

const success = enrichCommandResult(makeResult({
  ok: true,
  command: 'status',
  cwd: process.cwd(),
  messages: [message('info', 'ATM_STATUS_READY', 'ready', {})]
}));
assert.equal(success.severity, 'success');
assert.equal(success.exitCode, 0);
assert.equal(success.blocking, false);

// === smoke: process exit + JSON contract ===
const help = await captureCli(['help', '--json']);
assert.equal(help.exitCode, 0);
assert.equal(help.payload.ok, true);
assert.equal(help.payload.severity, 'success');
assert.equal(help.payload.exitCode, 0);
assert.equal(help.payload.blocking, false);
assert.ok(help.payload.diagnostics);

const unknown = await captureCli(['not-a-real-command', '--json']);
assert.equal(unknown.exitCode, 2);
assert.equal(unknown.payload.ok, false);
assert.equal(unknown.payload.severity, 'usage-error');
assert.equal(unknown.payload.exitCode, 2);
assert.equal(unknown.payload.blocking, true);
assert.ok(unknown.payload.diagnostics.errorCodes.includes('ATM_CLI_UNKNOWN_COMMAND'));

console.log('[cli-result-contract:test] ok');
