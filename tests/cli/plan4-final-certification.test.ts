import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const auditPath = path.join(root, 'governance-optimization/plan-3x-4x-objective-audit-2026-07-31.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

assert.equal(audit.schemaId, 'atm.fourPlanCertificate.v1');
assert.equal(audit.decision.failClosed, true);
assert.equal(audit.rows.length, 4);

for (const row of audit.rows) {
  assert.ok(['3.0', '3.1', '3.2', '4.0'].includes(row.plan));
  assert.ok(Array.isArray(row.evidenceTuples) && row.evidenceTuples.length > 0, `${row.plan} needs evidence tuples`);
  assert.ok(Array.isArray(row.nonClaims) && row.nonClaims.length > 0, `${row.plan} needs an explicit non-claim`);
  for (const tuple of row.evidenceTuples) {
    assert.equal(typeof tuple.kind, 'string');
    assert.equal(typeof tuple.expectedTaskId, 'string');
    assert.equal(typeof tuple.source, 'string');
    assert.ok(!tuple.source.includes('..'), `evidence source must stay inside the repository: ${tuple.source}`);
    const source = path.join(root, tuple.source);
    assert.ok(fs.existsSync(source), `missing evidence source: ${tuple.source}`);
    const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
    assert.equal(receipt.taskId, tuple.expectedTaskId, `wrong evidence task for ${tuple.source}`);
  }
}

const sharedControls = [audit.backlogCensus, audit.releasePushProvenance, audit.independentReview];
for (const control of sharedControls) {
  assert.equal(typeof control.nonClaim, 'string');
}

const certificateCanBeProven =
  audit.rows.every((row: { status: string }) => row.status === 'proven') &&
  audit.unknownRows.length === 0 &&
  audit.unresolvedRows.length === 0 &&
  sharedControls.every((control: { status: string }) => control.status === 'proven') &&
  audit.legacyAuthority.reversible === true;

assert.equal(audit.status, certificateCanBeProven ? 'proven' : 'not-certified');
assert.equal(audit.legacyAuthority.retired, certificateCanBeProven);
assert.equal(audit.legacyAuthority.reversible, true);

const matrix = fs.readFileSync(path.join(root, 'governance-optimization/plan-3x-4x-objective-evidence-matrix-2026-07-31.md'), 'utf8');
for (const plan of ['3.0', '3.1', '3.2', '4.0']) assert.ok(matrix.includes(`| ${plan} |`));
assert.ok(matrix.includes('fail-closed certification input'));
console.log(`plan4 final certification: ${audit.status}`);
