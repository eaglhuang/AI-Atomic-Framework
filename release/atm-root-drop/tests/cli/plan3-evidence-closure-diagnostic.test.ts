import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasCommandBackedCellEvidence } from '../../packages/cli/src/commands/broker/replay/command-backed-matrix.ts';
import {
  classifyClosureReceipt,
  evaluatePlan3SemanticClosure,
  isSemanticallyValidClosureWorkload,
  loadPlan3FakeGreenFixture
} from '../../packages/cli/src/commands/broker/replay/closure-policy.ts';

const root = process.cwd();
const script = path.join(root, 'scripts/diagnose-plan3-evidence-closure.ts');
const incompleteRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-plan3-incomplete-'));
mkdirSync(path.join(incompleteRepo, 'packages/cli/src/commands/command-specs'), { recursive: true });
mkdirSync(path.join(incompleteRepo, 'packages/cli/src/commands/broker'), { recursive: true });
mkdirSync(path.join(incompleteRepo, 'scripts'), { recursive: true });
writeFileSync(path.join(incompleteRepo, 'packages/cli/src/commands/command-specs/broker.spec.ts'), 'export const brokerActions = ["replay"];\n', 'utf8');
writeFileSync(path.join(incompleteRepo, 'packages/cli/src/commands/broker/implementation.ts'), 'export const supports = "broker replay";\n', 'utf8');
writeFileSync(path.join(incompleteRepo, 'scripts/run-paired-ab-v4.ts'), 'const serialBase = 1; const armFactor = 1; const throughputFactor = 1; const costFactor = 1;\n', 'utf8');

const blocked = spawnSync(process.execPath, ['--strip-types', script, '--json'], {
  cwd: incompleteRepo,
  encoding: 'utf8'
});
assert.equal(blocked.status, 1, 'diagnostic must fail closed when Plan 3 closure evidence is incomplete');
const blockedReport = JSON.parse(blocked.stdout);
assert.equal(blockedReport.schemaId, 'atm.plan3EvidenceClosureDiagnostic.v1');
assert.equal(blockedReport.verdict, 'remain-open');
assert.ok(blockedReport.blockers.some((entry: string) => entry.includes('real-dogfood-registered-candidates')));
assert.equal(blockedReport.blockers.some((entry: string) => entry.includes('frozen-cli-replay-surface')), false);
assert.ok(blockedReport.blockers.some((entry: string) => entry.includes('command-backed-420-cell-matrix')));
assert.ok(blockedReport.blockers.some((entry: string) => entry.includes('missing-lifecycle-class:') || entry.includes('INV-ATM-')));
assert.equal(
  blockedReport.checks.find((entry: any) => entry.name === 'frozen-cli-replay-surface')?.ok,
  true,
  'diagnostic must recognize the public broker replay CLI surface'
);
assert.equal(
  blockedReport.checks.find((entry: any) => entry.name === 'formula-generated-matrix-disclosed')?.ok,
  true,
  'diagnostic must explicitly disclose formula-generated matrix source'
);
assert.equal(
  hasCommandBackedCellEvidence({ commandDigest: 'sha256:'.padEnd(71, 'a') }),
  false,
  'digest-only replay cells must not satisfy the command-backed closure contract'
);
assert.equal(
  hasCommandBackedCellEvidence({
    workloadReceipts: [{
      command: 'node atm.mjs --version',
      exitCode: 0,
      startedAtMs: 1,
      finishedAtMs: 2,
      stdoutDigest: `sha256:${'a'.repeat(64)}`,
      stderrDigest: `sha256:${'b'.repeat(64)}`
    }]
  }),
  true,
  'receipt shape may still recognize a successful command envelope'
);
assert.equal(
  isSemanticallyValidClosureWorkload('node atm.mjs --version'),
  false,
  'version workloads must be rejected as semantic closure evidence'
);
assert.equal(
  classifyClosureReceipt({
    command: 'node atm.mjs --version',
    exitCode: 0,
    startedAtMs: 1,
    finishedAtMs: 2,
    stdoutDigest: `sha256:${'a'.repeat(64)}`,
    stderrDigest: `sha256:${'b'.repeat(64)}`
  }),
  'weak-workload'
);

const allowed = spawnSync(process.execPath, ['--strip-types', script, '--json', '--allow-inconclusive'], {
  cwd: incompleteRepo,
  encoding: 'utf8'
});
assert.equal(allowed.status, 0, 'allow-inconclusive mode must make the diagnostic report consumable by larger validators');
const allowedReport = JSON.parse(allowed.stdout);
assert.equal(allowedReport.verdict, 'remain-open');
assert.deepEqual(allowedReport.blockers, blockedReport.blockers);

const current = spawnSync(process.execPath, ['--strip-types', script, '--json'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(current.status, 1, 'current weak repository evidence must fail closed');
const currentReport = JSON.parse(current.stdout);
assert.equal(currentReport.verdict, 'remain-open', 'current fake-green repository must remain-open under semantic closure policy');
assert.ok(currentReport.blockers.some((entry: string) => entry.includes('missing-lifecycle-class:')));
assert.ok(currentReport.blockers.some((entry: string) => entry.includes('INV-ATM-008')));
assert.ok(currentReport.blockers.some((entry: string) => entry.includes('INV-ATM-009')));
assert.ok(currentReport.blockers.some((entry: string) => entry.includes('INV-ATM-010') || entry.includes('evidence-disposition:superseded-for-plan-closure')));
assert.equal(
  currentReport.checks.find((entry: any) => entry.name === 'formula-generated-matrix-disclosed')?.ok,
  true,
  'formula disclosure remains informational and must not alone convert remain-open into ready-to-close'
);

const fixture = loadPlan3FakeGreenFixture(root);
assert.ok(fixture, 'locked fake-green fixture must exist');
const fixtureReport = evaluatePlan3SemanticClosure({
  cwd: root,
  fixture,
  useLiveEvidence: false
});
assert.equal(fixtureReport.verdict, 'remain-open');
assert.ok(fixtureReport.invariantFindings.some((entry) => entry.code === 'INV-ATM-008'));
assert.ok(fixtureReport.invariantFindings.some((entry) => entry.code === 'INV-ATM-009'));
assert.ok(fixtureReport.missingLifecycleClasses.includes('executed-dogfood-lifecycle'));
assert.ok(fixtureReport.dispositionFindings.includes('superseded-for-plan-closure'));

console.log('[plan3-evidence-closure-diagnostic.test] ok');
