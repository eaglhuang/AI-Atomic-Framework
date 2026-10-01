import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeProcessOutcome } from '../../packages/cli/src/commands/evidence/observed-source-loader.ts';
import { runEvidenceRun } from '../../packages/cli/src/commands/evidence/verbs/run.ts';

for (const [result, expected] of [
  [{ status: 0 }, true],
  [{ status: 7 }, false],
  [{ status: null, error: new Error('spawn failed') }, false],
  [{ status: null, signal: 'SIGTERM' }, false],
  [{ status: null }, false],
  [{ status: 0, signal: 'SIGTERM' }, false],
  [{ status: 0, error: new Error('spawn failed') }, false]
] as const) {
  const outcome = normalizeProcessOutcome(result);
  assert.equal(outcome.commandOk, expected);
  assert.equal(outcome.exitCode === 0, expected);
  assert.equal(outcome.processExitStatus, result.status);
}

if (process.platform !== 'win32') {
  const result = spawnSync('/bin/sh', ['-c', 'kill -TERM $$'], { encoding: 'utf8' });
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(normalizeProcessOutcome(result).commandOk, false);
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-signal-evidence-'));
  try {
    assert.throws(() => runEvidenceRun(['--cwd', cwd, '--task', 'TASK-SIGNAL-0001',
      '--actor', 'signal-validator', '--command', 'kill -TERM $$', '--validators', 'signal-control', '--json']),
    (error: any) => error.code === 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND');
    const diagnostic = runEvidenceRun(['--cwd', cwd, '--task', 'TASK-SIGNAL-0001',
      '--actor', 'signal-validator', '--command', 'kill -TERM $$', '--kind', 'failure', '--json']);
    const manifest = diagnostic.evidence?.bundleManifest as any;
    const persisted = JSON.parse(readFileSync(path.join(cwd, String(diagnostic.evidence?.evidencePath)), 'utf8'));
    const run = persisted.evidence.flatMap((entry: any) => entry.details?.commandRuns ?? entry.commandRuns ?? [])
      .find((entry: any) => entry.command === 'kill -TERM $$');
    assert.notEqual(run.exitCode, 0);
    assert.equal(run.processExitStatus, null);
    assert.equal(run.processSignal, 'SIGTERM');
    assert.equal(manifest.freshValidationPasses.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
console.log('ok: subprocess outcome controls passed');
