import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-fresh-command-replay-receipts.json', 'utf8'));

assert.equal(report.schemaId, 'atm.plan3xFreshCommandReplayReceipts.v1');
assert.equal(report.status, 'fresh-command-replay-partially-consumed');
assert.equal(report.familyDisposition.proofFamilyId, 'fresh-command-replay-needed');
assert.equal(report.familyDisposition.sourceRowCount, 4);
assert.equal(report.familyDisposition.focusedCommandsExecuted, 28);
assert.equal(report.familyDisposition.commandsGreen, 28);
assert.equal(report.familyDisposition.rowsConsumedIntoSourceReplay, 46);
assert.equal(report.familyDisposition.rowsCertifiedCompleteByTheseReceipts, 0);
assert.equal(report.familyDisposition.remainingRowsInFamily, 4);
assert.equal(report.commandRuns.length, 28);
assert.ok(report.commandRuns.every((entry: any) => entry.exitCode === 0));
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'positive-row-receipts',
  'source-replay-row-recompute',
  'objective-verdict-recompute'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-plan3x-fresh-command-replay-receipts.ts'], { stdio: 'pipe' });
console.log('plan3x-fresh-command-replay-receipts.test.ts: ok');
