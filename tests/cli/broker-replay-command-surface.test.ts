import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const atmDev = path.join(root, 'atm.dev.mjs');

const status = spawnSync(process.execPath, [atmDev, 'broker', 'replay', 'status', '--json'], {
  cwd: root,
  encoding: 'utf8'
});
// The verdict follows the live closure evidence: it was incomplete when this
// test was written and is complete now, so assert the rule instead of the
// moment. remain-open must fail closed; ready-to-close must exit 0 with no
// blockers left.
const statusReport = parseJsonOutput(status.stdout, status.stderr);
assert.equal(statusReport.command, 'broker');
assert.equal(statusReport.evidence.schemaId, 'atm.brokerReplayStatus.v1');
const verdict = statusReport.evidence.verdict;
assert.ok(['remain-open', 'ready-to-close'].includes(verdict), `unexpected verdict ${verdict}`);
assert.equal(status.status, verdict === 'remain-open' ? 1 : 0, 'an open replay must fail closed');
// The surface may grow; the three frozen actions must never disappear.
for (const action of ['status', 'run', 'dogfood']) {
  assert.ok(statusReport.evidence.publicFrozenCliSurface.actions.includes(action), `frozen replay action ${action} must stay published`);
}
if (verdict === 'remain-open') {
  assert.ok(
    statusReport.evidence.blockers.some((entry: string) => entry.includes('missing-lifecycle-class:') || entry.includes('INV-ATM-') || entry.includes('real-dogfood-registered-candidates') || entry.includes('command-backed-420-cell-matrix')),
    'status blockers must expose exact semantic or availability gaps'
  );
} else {
  assert.deepEqual(statusReport.evidence.blockers, [], 'a replay ready to close cannot carry blockers');
}
assert.ok(Array.isArray(statusReport.evidence.missingLifecycleClasses));
assert.equal(statusReport.evidence.status?.finalVerdict, verdict);

const dogfood = spawnSync(process.execPath, [atmDev, 'broker', 'replay', 'dogfood', '--json'], {
  cwd: root,
  encoding: 'utf8'
});
const dogfoodReport = parseJsonOutput(dogfood.stdout, dogfood.stderr);
assert.equal(dogfoodReport.evidence.action, 'replay-dogfood');
if (dogfood.status === 0) {
  // Candidate cards may exist, but dogfood success alone must not imply Plan 3 closure.
  const statusAfter = spawnSync(process.execPath, [atmDev, 'broker', 'replay', 'status', '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  const statusAfterReport = parseJsonOutput(statusAfter.stdout, statusAfter.stderr);
  assert.equal(statusAfterReport.evidence.verdict, verdict, 'a dogfood run alone must not move the closure verdict');
} else {
  assert.equal(dogfoodReport.evidence.verdict, verdict, 'a blocked dogfood must report the same verdict as status');
  assert.ok(dogfoodReport.messages.some((entry: any) => entry.code === 'ATM_BROKER_REPLAY_DOGFOOD_BLOCKED'));
}

console.log('[broker-replay-command-surface.test] ok');

function parseJsonOutput(stdout: string, stderr: string) {
  const output = (stdout || stderr).trim();
  assert.notEqual(output, '', 'expected CLI JSON on stdout or stderr');
  return JSON.parse(output);
}
