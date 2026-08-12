import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observeEvidenceRunProcess } from '../../packages/cli/src/commands/evidence/verbs/run.ts';
import { runEvidenceRun } from '../../packages/cli/src/commands/evidence/verbs/run.ts';
import { createObservedValidationReceipt } from '../../packages/cli/src/commands/evidence/observed-source-loader.ts';
import { resolveAutoEvidenceValidationContract } from '../../packages/cli/src/commands/taskflow/auto-evidence-mapper.ts';
import { resolveClosePreflightValidationContract } from '../../packages/cli/src/commands/taskflow/close-preflight.ts';
import { inspectObservedTaskEvidence } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';

const observation = observeEvidenceRunProcess({
  command: 'node --strip-types tests/cli/observed-evidence-production-callers.test.ts',
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  processError: null
});

assert.equal(observation.status, 'observed');
assert.deepEqual(observation.sourceIds, ['evidence-run-process']);
assert.equal(typeof observation.valueDigest, 'string');
assert.deepEqual(observation.value, {
  command: 'node --strip-types tests/cli/observed-evidence-production-callers.test.ts',
  exitCode: 0,
  stdoutSha256: 'sha256:2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df',
  stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  processError: null
});

const failedObservation = observeEvidenceRunProcess({
  command: 'node missing-script.ts',
  exitCode: 1,
  stdout: '',
  stderr: 'missing-script',
  processError: null
});
assert.equal(failedObservation.status, 'observed');
assert.deepEqual(failedObservation.value, {
  command: 'node missing-script.ts',
  exitCode: 1,
  stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  stderrSha256: 'sha256:086207f3edc7c872f28306e7b7f86ca1f2a484d90bbabba64e1618bfbca91265',
  processError: null
});

const validationTask = { requiredTestCaseIds: ['observed-process'] };
const validationChangeSet = { changedFiles: ['packages/cli/src/commands/evidence/verbs/run.ts'] };
const validationCatalog = { cases: [{ caseId: 'observed-process', command: 'node -e "process.exit(0)"' }] };
const adapters = [resolveAutoEvidenceValidationContract, resolveClosePreflightValidationContract];
for (const adapter of adapters) {
  const success = adapter(validationTask, validationChangeSet, validationCatalog, {
    receipts: [createObservedValidationReceipt({
      caseId: 'observed-process',
      run: { command: 'node -e "process.exit(0)"', exitCode: 0, stdoutSha256: 'sha256:stdout', stderrSha256: 'sha256:stderr' }
    })]
  });
  assert.equal(success.freshnessInputs[0]?.status, 'fresh');

  const forgedPass = adapter(validationTask, validationChangeSet, validationCatalog, {
    receipts: [{
      ...createObservedValidationReceipt({
        caseId: 'observed-process',
        run: { command: 'node missing.ts', exitCode: 1, stdoutSha256: 'sha256:stdout', stderrSha256: 'sha256:stderr' }
      }),
      status: 'passed'
    }]
  });
  assert.equal(forgedPass.freshnessInputs[0]?.status, 'failed', 'observed exit code must override a caller-supplied pass claim');

  const validReceipt = createObservedValidationReceipt({
    caseId: 'observed-process',
    run: { command: 'node -e "process.exit(0)"', exitCode: 0, stdoutSha256: 'sha256:stdout', stderrSha256: 'sha256:stderr' }
  });
  const digestMismatch = adapter(validationTask, validationChangeSet, validationCatalog, {
    receipts: [{ ...validReceipt, status: 'passed', observedOutcome: { ...validReceipt.observedOutcome!, valueDigest: 'sha256:bad' } }]
  });
  assert.equal(digestMismatch.freshnessInputs[0]?.status, 'missing', 'a malformed observed digest must fail closed');

  const unavailable = adapter(validationTask, validationChangeSet, validationCatalog, {
    receipts: [{ ...validReceipt, status: 'passed', observedOutcome: { ...validReceipt.observedOutcome!, status: 'unavailable', value: null, valueDigest: null } }]
  });
  assert.equal(unavailable.freshnessInputs[0]?.status, 'missing', 'an unavailable observation must not inherit a pass claim');
}

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-observed-production-'));
try {
  const normalResult = runEvidenceRun([
    '--task', 'TASK-OBS-0331',
    '--cwd', cwd,
    '--actor', 'observed-evidence-test',
    '--command', 'node -e "process.exit(0)"',
    '--validators', 'observed-evidence-production-callers',
    '--json'
  ]);
  const normalOutcomes = normalResult.evidence?.observedCommandOutcomes as Array<{ value?: { exitCode?: number } }>;
  assert.equal(normalOutcomes.length, 1);
  assert.equal(normalOutcomes[0]?.value?.exitCode, 0);
  const closeObservation = inspectObservedTaskEvidence(cwd, 'TASK-OBS-0331');
  assert.equal(closeObservation.status, 'observed', 'close orchestration must derive its digest from persisted command facts');
  assert.equal(closeObservation.commandRunCount, 1);
  assert.match(closeObservation.digest ?? '', /^sha256:[a-f0-9]{64}$/);

  const result = runEvidenceRun([
    '--task', 'TASK-OBS-0331',
    '--cwd', cwd,
    '--actor', 'observed-evidence-test',
    '--command', 'node -e "process.exit(0)"',
    '--validators', 'observed-evidence-production-callers',
    '--tdd-phase', 'green',
    '--tdd-case-id', 'test_observed_evidence_production_callers_0331',
    '--tdd-test-digest', 'sha256:observed-evidence-production-callers',
    '--tdd-acceptance', 'ACC-1',
    '--tdd-public-seam', 'atm.evidenceRun.v1',
    '--tdd-baseline-sha', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '--tdd-candidate-sha', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '--tdd-executed-cases', '1',
    '--tdd-assertions', '1',
    '--json'
  ]);
  const outcome = result.evidence?.observedCommandOutcome as { value?: { exitCode?: number; command?: string } };
  assert.equal(outcome.value?.exitCode, 0);
  assert.equal(outcome.value?.command, 'node -e "process.exit(0)"');

  writeFileSync(path.join(cwd, '.atm', 'history', 'evidence', 'TASK-OBS-0331.bundle-manifest.json'), JSON.stringify({
    schemaId: 'atm.evidenceBundleManifest.v1', taskId: 'TASK-OBS-0331', updatedAt: new Date().toISOString(), updatedBy: 'test',
    freshValidationPasses: [], staleValidationPasses: [], commandRuns: [{ command: 'node invalid.ts' }], artifactPaths: []
  }));
  assert.equal(inspectObservedTaskEvidence(cwd, 'TASK-OBS-0331').status, 'invalid', 'close-side inspection must reject incomplete persisted command facts');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log('observed evidence production callers: ok');
