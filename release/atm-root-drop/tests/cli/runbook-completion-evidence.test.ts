import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compileRunbookCompletion, DEFAULT_PLANNING_ROOT, effectiveEvidenceContracts, independentExitContracts, isDeclaredPublicationDelta, isPublicationOnlyDelta, semanticTaskCardDigest } from '../../scripts/compile-runbook-completion-evidence.ts';
import { validateReport } from '../../scripts/validate-runbook-completion-evidence.ts';

const sha = 'a'.repeat(40);
assert.equal(DEFAULT_PLANNING_ROOT.endsWith('3KLife'), true);
assert.equal(isPublicationOnlyDelta('invalid', 'also-invalid'), false, 'invalid publication snapshots must fail closed');
const planningContract = 'task_id: ATM-GOV-9999\nstatus: planned\nvalidators:\n  - npm run typecheck\nscopePaths:\n  - scripts/example.ts\n';
const lifecycleOnlyCloseback = 'task_id: ATM-GOV-9999\nstatus: done\nvalidators:\n  - npm run typecheck\nscopePaths:\n  - scripts/example.ts\ncompleted_at: "2026-08-14T00:00:00Z"\ndelivery_commit: deadbeef\n';
assert.equal(semanticTaskCardDigest(planningContract), semanticTaskCardDigest(lifecycleOnlyCloseback), 'lifecycle-only closeback must not change the planning contract snapshot');
assert.notEqual(semanticTaskCardDigest(planningContract), semanticTaskCardDigest(planningContract.replace('npm run typecheck', 'npm run validate:cli')), 'validator changes must invalidate the planning contract snapshot');
assert.equal(
  isDeclaredPublicationDelta([
    'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
    'docs/reports/reviews/plan-3x-4x-runbook-release-review.json',
    '.atm/history/evidence/ATM-GOV-0376.json'
  ], [
    'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
    'docs/reports/reviews/plan-3x-4x-runbook-release-review.json'
  ]),
  true,
  'a sealed publication bundle may replay its declared outputs and durable receipts'
);
assert.equal(
  isDeclaredPublicationDelta([
    'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
    'scripts/compile-runbook-completion-evidence.ts'
  ], ['docs/reports/plan-3x-4x-runbook-completion-evidence.json']),
  false,
  'an undeclared source change must invalidate a publication snapshot'
);
const validator = (command: string) => ({ contractId: `fixture/${command}`, taskId: 'fixture', taskCardPath: 'fixture', taskCardDigest: 'fixture', command });
const primaryContract = {
  taskId: 'ATM-GOV-9000', wave: 'Wave 0', phase: 'correction-wave-0', validators: [validator('node replay.ts')], registered: true,
  publicSeams: ['atm.example.v1'], deliverables: ['docs/reports/example.json'], causalDependencies: [], observationDependencies: []
};
const replayContract = {
  taskId: 'ATM-GOV-9001', wave: 'Wave 0', phase: 'correction-wave-0', validators: [validator('node replay.ts')], registered: false,
  publicSeams: ['atm.example.v1'], deliverables: ['docs/reports/example.json'], causalDependencies: [], observationDependencies: []
};
const replaySuccessorContract = {
  taskId: 'ATM-GOV-9003', wave: 'Wave 0', phase: 'correction-wave-0', validators: [validator('node replay.ts')], registered: false,
  publicSeams: ['atm.example.v1'], deliverables: ['docs/reports/example.json'], causalDependencies: ['ATM-GOV-9001'], observationDependencies: []
};
const exitContract = {
  taskId: 'ATM-GOV-9002', wave: 'Wave 0', phase: 'correction-wave-0', validators: [validator('node observe.ts')], registered: false,
  publicSeams: ['atm.example.v1'], deliverables: ['tests/example.test.ts'], causalDependencies: [], observationDependencies: ['ATM-GOV-9001']
};
const effectiveContracts = effectiveEvidenceContracts([primaryContract], [primaryContract, replayContract, exitContract]);
assert.deepEqual(effectiveContracts.map((contract) => contract.taskId), ['ATM-GOV-9001'], 'only a unique same-seam artifact replay may replace a stale primary receipt');
assert.deepEqual(
  effectiveEvidenceContracts([primaryContract], [primaryContract, replayContract, replaySuccessorContract, exitContract]).map((contract) => contract.taskId),
  ['ATM-GOV-9003'],
  'a replay chain must select its unique causal leaf rather than fail due to multiple historical candidates'
);
assert.deepEqual(
  independentExitContracts(effectiveContracts, [primaryContract, replayContract, exitContract], 'Wave 0').map((contract) => contract.taskId),
  ['ATM-GOV-9002'],
  'a Wave exit must consume a downstream observer rather than reuse the replay receipt'
);
// Use synthetic wave numbers so repository evidence cannot hydrate this isolated fixture.
const source = ['## Wave 98 — Preserve', '- [ ] first requirement', '退出條件：first exit', '## Wave 99 — Restore', '- [x] second requirement', '退出條件：second exit'].join('\n');
const report = compileRunbookCompletion(source, sha, sha, sha);
assert.equal(report.rows.length, 2);
assert.equal(report.waveExits.length, 2);
assert.equal(report.overallVerdict, 'not-complete');
assert.deepEqual(report.unresolvedIds, ['RB-001', 'RB-002', 'EXIT-01', 'EXIT-02']);
assert.deepEqual(report.unknownIds, []);
validateReport(report, source);
const declaredBundle = compileRunbookCompletion(source, sha, sha, sha, undefined, undefined, [], [
  'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
  'docs/reports/reviews/plan-3x-4x-runbook-release-review.json'
]);
assert.deepEqual(
  declaredBundle.authority.publicationBundle,
  {
    schemaId: 'atm.sealedProjectionPublicationBundle.v1',
    artifactPaths: [
      'docs/reports/plan-3x-4x-runbook-completion-evidence.json',
      'docs/reports/reviews/plan-3x-4x-runbook-release-review.json'
    ]
  },
  'publication authority must persist an exact data-declared artifact bundle'
);
assert.throws(
  () => compileRunbookCompletion(source, sha, sha, sha, undefined, undefined, [], ['scripts/not-a-report.ts']),
  /publication artifacts/,
  'publication declarations must reject non-report paths'
);

const forged = structuredClone(report);
forged.rows[0].status = 'proven';
assert.throws(() => validateReport(forged, source), /caller-authored green/);
const omitted = structuredClone(report);
omitted.rows.pop();
assert.throws(() => validateReport(omitted, source), /count drift/);
const falseGreen = structuredClone(report);
falseGreen.overallVerdict = 'complete';
assert.throws(() => validateReport(falseGreen, source), /complete verdict/);

const liveHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const ownedTuple = {
  command: 'node --strip-types tests/cli/example.test.ts',
  exitCode: 0,
  outputDigest: `sha256:${'b'.repeat(64)}`,
  artifactPaths: ['scripts/compile-runbook-completion-evidence.ts'],
  observedAt: '2026-08-13T00:00:00.000Z',
  sourceCommit: liveHead,
  evidenceOwner: 'ATM-GOV-9999',
  validatorContractId: 'atm.taskCardValidator/ATM-GOV-9999/' + 'c'.repeat(64)
};
const testContract = {
  contractId: ownedTuple.validatorContractId,
  taskId: 'ATM-GOV-9999',
  taskCardPath: 'scripts/compile-runbook-completion-evidence.ts',
  taskCardDigest: semanticTaskCardDigest(readFileSync('scripts/compile-runbook-completion-evidence.ts', 'utf8')),
  command: ownedTuple.command
};
const foreignOwner = structuredClone(report);
foreignOwner.authority.targetHead = liveHead;
foreignOwner.validatorContracts = [testContract];
foreignOwner.rows[0].status = 'proven';
foreignOwner.rows[0].coverageOwners = ['ATM-GOV-9998'];
foreignOwner.rows[0].evidence = [ownedTuple];
foreignOwner.unresolvedIds = foreignOwner.unresolvedIds.filter((id: string) => id !== foreignOwner.rows[0].itemId);
assert.throws(() => validateReport(foreignOwner, source), /foreign evidence owner/);

const reusedWaveReceipt = structuredClone(report);
reusedWaveReceipt.authority.targetHead = liveHead;
reusedWaveReceipt.validatorContracts = [testContract];
reusedWaveReceipt.rows[0].status = 'proven';
reusedWaveReceipt.rows[0].coverageOwners = ['ATM-GOV-9999'];
reusedWaveReceipt.rows[0].evidence = [ownedTuple];
reusedWaveReceipt.waveExits[0].status = 'proven';
reusedWaveReceipt.waveExits[0].coverageOwners = ['ATM-GOV-9999'];
reusedWaveReceipt.waveExits[0].evidence = [ownedTuple];
reusedWaveReceipt.unresolvedIds = reusedWaveReceipt.unresolvedIds.filter((id: string) => ![reusedWaveReceipt.rows[0].itemId, reusedWaveReceipt.waveExits[0].itemId].includes(id));
assert.throws(() => validateReport(reusedWaveReceipt, source), /wave exit reuses basis evidence/);
const finalSource = ['## Wave 10 — Certification', '- [ ] final requirement', '退出條件：final exit'].join('\n');
const finalReport = compileRunbookCompletion(finalSource, sha, sha, sha, { proven: false, diagnostics: ['final-certificate-not-proven'] });
assert.deepEqual(finalReport.unresolvedIds, ['RB-001', 'EXIT-01']);
assert.deepEqual(finalReport.rows[0].diagnostics, ['final-certificate-not-proven']);

// Validation must compare against live inputs without rewriting the canonical
// report. A green validator over a silently regenerated file is not freshness
// evidence and recreates the false-green condition this runbook corrects.
const canonicalPath = 'docs/reports/plan-3x-4x-runbook-completion-evidence.json';
const beforeValidate = readFileSync(canonicalPath, 'utf8');
execFileSync(process.execPath, ['--strip-types', 'scripts/compile-runbook-completion-evidence.ts', '--mode', 'validate'], {
  stdio: 'pipe'
});
assert.equal(readFileSync(canonicalPath, 'utf8'), beforeValidate, 'validate mode must be read-only');
execFileSync(process.execPath, ['--strip-types', 'scripts/validate-runbook-completion-evidence.ts'], {
  stdio: 'pipe'
});
console.log('[runbook-completion-evidence] ok');
