import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const analyzer = join(root, 'scripts/analyze-captain-parallel-ledger.ts');

const output = execFileSync(process.execPath, ['--strip-types', analyzer, '--validate', '--require-sealed-cohorts'], { cwd: root, encoding: 'utf8' });
const report = JSON.parse(output);
const v4 = report.planPerformanceReport.realPairedAbV4;

assert.equal(v4.schemaId, 'atm.realPairedAbV4.v1');
assert.equal(v4.crossCardConsumption.consumedTaskCount, 8);
assert.deepEqual(v4.crossCardConsumption.missingTasks, []);
assert.equal(v4.gitArmIsolation.disposableRepo, true);
assert.equal(v4.gitArmIsolation.liveFrameworkWorktree, false);
assert.equal(v4.gitArmIsolation.brokerBypass, false);
assert.equal(v4.rollbackReceipt.verified, true);
assert.equal(report.planPerformanceReport.rolloutVerdict.overall, 'inconclusive');
assert.match(report.planPerformanceReport.dataDrivenDecision.reason, /inconclusive/);
assert.ok(report.planPerformanceReport.dataDrivenDecision.missingData.some((entry: string) => entry.includes('supplemental samples')));

for (const method of v4.validationMethods) {
  assert.ok(method.sourceDigest.startsWith('sha256:'), `${method.method} must retain a source digest`);
  assert.equal(method.verdict, 'inconclusive');
}

const badDir = mkdtempSync(join(tmpdir(), 'atm-gov-0202-'));
const badManifest = join(badDir, 'bad-sealed-cohorts.json');
writeFileSync(badManifest, JSON.stringify({ schemaId: 'atm.realPairedAbV4SealedCohorts.v1', benchmarkConfigDigest: 'sha256:bad' }, null, 2), 'utf8');
const failed = spawnSync(process.execPath, ['--strip-types', analyzer, '--validate', '--require-sealed-cohorts', '--sealed-cohorts', badManifest], { cwd: root, encoding: 'utf8' });
assert.notEqual(failed.status, 0);
assert.match(failed.stderr, /unconsumed dependency summaries|missing .* required cells/);

console.log('real-paired-ab-v4 ok');
