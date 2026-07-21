import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hasCommandBackedCellEvidence } from '../../packages/cli/src/commands/broker/replay/command-backed-matrix.ts';

const root = process.cwd();
const script = path.join(root, 'scripts/diagnose-plan3-evidence-closure.ts');

const blocked = spawnSync(process.execPath, ['--strip-types', script, '--json'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(blocked.status, 1, 'diagnostic must fail closed when Plan 3 closure evidence is incomplete');
const blockedReport = JSON.parse(blocked.stdout);
assert.equal(blockedReport.schemaId, 'atm.plan3EvidenceClosureDiagnostic.v1');
assert.equal(blockedReport.verdict, 'remain-open');
assert.ok(blockedReport.blockers.some((entry: string) => entry.includes('real-dogfood-registered-candidates')));
assert.equal(blockedReport.blockers.some((entry: string) => entry.includes('frozen-cli-replay-surface')), false);
assert.ok(blockedReport.blockers.some((entry: string) => entry.includes('command-backed-420-cell-matrix')));
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
  'a successful command receipt with timing and output digests must satisfy the command-backed closure contract'
);

const allowed = spawnSync(process.execPath, ['--strip-types', script, '--json', '--allow-inconclusive'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(allowed.status, 0, 'allow-inconclusive mode must make the diagnostic report consumable by larger validators');
const allowedReport = JSON.parse(allowed.stdout);
assert.equal(allowedReport.verdict, 'remain-open');
assert.deepEqual(allowedReport.blockers, blockedReport.blockers);

console.log('[plan3-evidence-closure-diagnostic.test] ok');
