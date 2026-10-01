import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyValidatorEvidenceState } from '../../packages/cli/src/commands/evidence/missing-report.ts';
import { runEvidenceRun } from '../../packages/cli/src/commands/evidence/verbs/run.ts';

const SHA = `sha256:${'a'.repeat(64)}`;

function passRecord(gate: string, at: string, freshness = 'fresh') {
  return {
    createdAt: at,
    evidenceFreshness: freshness,
    details: {
      validationPasses: [gate],
      commandRuns: [{ command: `npm run ${gate}`, exitCode: 0, stdoutSha256: SHA, stderrSha256: SHA, validators: [gate], finishedAt: at }]
    }
  };
}

function failRecord(gate: string, at: string) {
  return {
    createdAt: at,
    evidenceType: 'failure',
    details: {
      commandRuns: [{ command: `npm run ${gate}`, exitCode: 1, stdoutSha256: SHA, stderrSha256: SHA, validators: [gate], finishedAt: at }]
    }
  };
}

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:00:00.000Z';

// pass -> fail: the later failure is the current verdict.
assert.equal(classifyValidatorEvidenceState([passRecord('typecheck', T1), failRecord('typecheck', T2)], 'typecheck'), 'failed-run');
// fail -> pass: a later success clears the earlier failure; history does not lock the gate forever.
assert.equal(classifyValidatorEvidenceState([failRecord('typecheck', T1), passRecord('typecheck', T2)], 'typecheck'), 'pass');
// Out-of-order writes follow observation time, not array position.
assert.equal(classifyValidatorEvidenceState([failRecord('typecheck', T2), passRecord('typecheck', T1)], 'typecheck'), 'failed-run');
assert.equal(classifyValidatorEvidenceState([passRecord('typecheck', T2), failRecord('typecheck', T1)], 'typecheck'), 'pass');
// A failure of one gate does not overwrite another gate.
assert.equal(classifyValidatorEvidenceState([passRecord('typecheck', T1), failRecord('lint', T2)], 'typecheck'), 'pass');
// A non-fresh positive after a failure is not promoted to a current pass.
assert.equal(classifyValidatorEvidenceState([failRecord('typecheck', T1), passRecord('typecheck', T2, 'historical-reference')], 'typecheck'), 'stale');

// Writer: a refused failing validator run is persisted as a failure observation, so the
// earlier pass stops being current, and a later real pass restores it.
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-current-verdict-'));
try {
  const base = ['--cwd', cwd, '--task', 'TASK-VERDICT-0001', '--actor', 'verdict-probe', '--validators', 'verdict-probe', '--runner-kind', 'dev-source', '--json'];
  const records = () => JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'evidence-ledger', 'bundles', 'TASK-VERDICT-0001.json'), 'utf8')).evidence;
  const manifest = () => JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'evidence', 'TASK-VERDICT-0001.bundle-manifest.json'), 'utf8'));

  runEvidenceRun([...base, '--command', 'node -e "process.exit(0)"']);
  assert.equal(classifyValidatorEvidenceState(records(), 'verdict-probe'), 'pass');

  assert.throws(() => runEvidenceRun([...base, '--command', 'node -e "process.exit(7)"']),
    (error: any) => error.code === 'ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND' && error.details?.persistedFailureObservation === true);
  const afterFailure = records();
  assert.equal(afterFailure.length, 2, 'the failed run is kept as an observation');
  assert.equal(afterFailure[1].details.validationPasses, undefined, 'a failed run never records a pass');
  assert.equal(classifyValidatorEvidenceState(afterFailure, 'verdict-probe'), 'failed-run');
  assert.equal(manifest().freshValidationPasses.includes('verdict-probe'), false);

  runEvidenceRun([...base, '--command', 'node -e "process.exit(0)"']);
  assert.equal(classifyValidatorEvidenceState(records(), 'verdict-probe'), 'pass');
  assert.equal(manifest().freshValidationPasses.includes('verdict-probe'), true);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: validator current verdict follows the latest real observation');
