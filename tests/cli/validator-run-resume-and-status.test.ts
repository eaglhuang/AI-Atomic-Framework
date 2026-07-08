// ATM-BUG-2026-07-07-054 (OPT-11) regression test.
//
// `scripts/run-validators.ts` already had `--run-id`/`--resume` + a
// fingerprint-gated receipt-reuse mechanism, but there was no read-only way
// to ask "did this run finish?" without re-invoking it, no bound on a hung
// validator child process, and no automated proof that resuming an
// interrupted run only re-executes the outstanding validators (not
// everything). Confirm:
//   1. `--status --run-id <id>` on an unknown run reports `found: false`.
//   2. `--status` on a fully completed run reports `completed: true`.
//   3. After simulating an interruption (one validator's receipt reset to
//      `pending`), `--status` reports it as outstanding, and `--resume`
//      reuses the already-passed validator's receipt (0 duration, not
//      re-executed) while actually re-running only the outstanding one, and
//      the final coherent summary + status both show everything passed.
//   4. `--validator-timeout-ms` bounds a validator and records `status:
//      'timeout'` in its receipt distinctly from an ordinary failure.
//
// Runnable directly via:
//   node --strip-types tests/cli/validator-run-resume-and-status.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(root, 'scripts', 'run-validators.ts');
const runsRoot = path.join(root, '.atm', 'runtime', 'validator-runs');

function runValidators(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, ['--strip-types', runnerPath, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; status?: number };
    return { stdout: String(execError.stdout ?? ''), status: execError.status ?? 1 };
  }
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const filterValidators = 'validate-terminology,validate-neutrality-scanner';
const runId = `opt11-test-resume-${process.pid}`;
const timeoutRunId = `opt11-test-timeout-${process.pid}`;
const runDir = path.join(runsRoot, runId);
const timeoutRunDir = path.join(runsRoot, timeoutRunId);

try {
  rmSync(runDir, { recursive: true, force: true });
  rmSync(timeoutRunDir, { recursive: true, force: true });

  // --- Scenario 1: --status on a run id that was never created.
  const missingStatus = runValidators(['standard', '--status', '--run-id', 'opt11-test-does-not-exist']);
  assert.equal(missingStatus.status, 1, 'status query for an unknown run must exit non-zero');
  const missingStatusJson = JSON.parse(missingStatus.stdout);
  assert.equal(missingStatusJson.found, false, 'unknown run id must report found: false');

  // --- Scenario 2: run both validators to completion, then confirm --status.
  const firstRun = runValidators(['standard', '--filter', filterValidators, '--run-id', runId, '--json']);
  assert.equal(firstRun.status, 0, `initial run must pass: ${firstRun.stdout}`);
  const firstSummary = JSON.parse(firstRun.stdout);
  assert.equal(firstSummary.failed, 0, `initial run must have zero failures: ${JSON.stringify(firstSummary.validators?.map((entry: any) => [entry.name, entry.ok]))}`);

  const completedStatus = JSON.parse(runValidators(['standard', '--status', '--run-id', runId]).stdout);
  assert.equal(completedStatus.found, true, 'completed run must be found by status query');
  assert.equal(completedStatus.completed, true, `completed run must report completed: true, got ${JSON.stringify(completedStatus)}`);
  assert.deepEqual(completedStatus.outstandingValidators, [], 'completed run must have no outstanding validators');

  // --- Scenario 3: simulate an interruption by resetting one receipt to
  // 'pending' (as if the process were killed before that validator finished),
  // then confirm --status sees it as outstanding and --resume only re-runs it.
  const neutralityReceiptPath = path.join(runDir, 'receipts', 'validate-neutrality-scanner.json');
  const neutralityReceiptBeforeReset = readJson(neutralityReceiptPath);
  writeJson(neutralityReceiptPath, {
    ...neutralityReceiptBeforeReset,
    status: 'pending',
    result: undefined,
    attempts: []
  });

  const interruptedStatus = JSON.parse(runValidators(['standard', '--status', '--run-id', runId]).stdout);
  assert.equal(interruptedStatus.completed, false, 'simulated interruption must report completed: false');
  assert.ok(
    interruptedStatus.outstandingValidators.includes('validate-neutrality-scanner'),
    `expected validate-neutrality-scanner to be outstanding, got ${JSON.stringify(interruptedStatus.outstandingValidators)}`
  );
  assert.ok(interruptedStatus.resumeCommand, 'interrupted run must surface a resume command');

  const resumedRun = runValidators(['standard', '--filter', filterValidators, '--resume', runId, '--json']);
  assert.equal(resumedRun.status, 0, `resumed run must pass: ${resumedRun.stdout}`);
  const resumedSummary = JSON.parse(resumedRun.stdout);
  const resumedTerminology = resumedSummary.validators.find((entry: any) => entry.name === 'validate-terminology');
  const resumedNeutrality = resumedSummary.validators.find((entry: any) => entry.name === 'validate-neutrality-scanner');
  assert.ok(resumedTerminology?.resumedFromReceipt === true, `already-passed validator must be reused from its receipt, not re-run: ${JSON.stringify(resumedTerminology)}`);
  assert.equal(resumedTerminology?.durationMs, 0, 'reused receipt result must report zero duration (it was not re-executed)');
  assert.ok(
    resumedNeutrality && resumedNeutrality.resumedFromReceipt !== true && resumedNeutrality.ok === true,
    `outstanding validator must actually re-run and pass: ${JSON.stringify(resumedNeutrality)}`
  );
  assert.equal(resumedSummary.failed, 0, 'resumed run must produce a single coherent summary with zero failures');

  const finalStatus = JSON.parse(runValidators(['standard', '--status', '--run-id', runId]).stdout);
  assert.equal(finalStatus.completed, true, `post-resume status must report completed: true, got ${JSON.stringify(finalStatus)}`);
  assert.deepEqual(finalStatus.outstandingValidators, [], 'post-resume status must have no outstanding validators');

  // --- Scenario 4: --validator-timeout-ms bounds a hung/slow validator and
  // records a distinct 'timeout' receipt status (not an ordinary 'failed').
  const timeoutRun = runValidators(['standard', '--filter', 'validate-terminology', '--run-id', timeoutRunId, '--validator-timeout-ms', '1', '--json']);
  assert.notEqual(timeoutRun.status, 0, 'a validator forced past its timeout budget must fail the run');
  const timeoutReceiptPath = path.join(timeoutRunDir, 'receipts', 'validate-terminology.json');
  assert.ok(existsSync(timeoutReceiptPath), 'expected a receipt to be written for the timed-out validator');
  const timeoutReceipt = readJson(timeoutReceiptPath);
  assert.equal(timeoutReceipt.status, 'timeout', `expected receipt status 'timeout', got ${JSON.stringify(timeoutReceipt.status)}`);
  assert.equal(timeoutReceipt.result?.timedOut, true, 'timed-out result must be flagged distinctly from an ordinary failure');

  console.log('[validator-run-resume-and-status:test] ok');
} finally {
  rmSync(runDir, { recursive: true, force: true });
  rmSync(timeoutRunDir, { recursive: true, force: true });
}
