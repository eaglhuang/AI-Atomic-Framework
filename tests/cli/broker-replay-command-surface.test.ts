import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const atmDev = path.join(root, 'atm.dev.mjs');

const status = spawnSync(process.execPath, [atmDev, 'broker', 'replay', 'status', '--json'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(status.status, 1, 'broker replay status must fail closed while closure evidence is incomplete');
const statusReport = parseJsonOutput(status.stdout, status.stderr);
assert.equal(statusReport.command, 'broker');
assert.equal(statusReport.evidence.schemaId, 'atm.brokerReplayStatus.v1');
assert.equal(statusReport.evidence.verdict, 'remain-open');
assert.deepEqual(statusReport.evidence.publicFrozenCliSurface.actions, ['status', 'run', 'dogfood']);
assert.ok(statusReport.evidence.blockers.some((entry: string) => entry.includes('real-dogfood-registered-candidates')));
assert.ok(statusReport.evidence.blockers.some((entry: string) => entry.includes('command-backed-420-cell-matrix')));

const dogfood = spawnSync(process.execPath, [atmDev, 'broker', 'replay', 'dogfood', '--json'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(dogfood.status, 1, 'broker replay dogfood must fail closed without two registered candidates');
const dogfoodReport = parseJsonOutput(dogfood.stdout, dogfood.stderr);
assert.equal(dogfoodReport.evidence.action, 'replay-dogfood');
assert.equal(dogfoodReport.evidence.verdict, 'remain-open');
assert.ok(dogfoodReport.messages.some((entry: any) => entry.code === 'ATM_BROKER_REPLAY_DOGFOOD_BLOCKED'));

console.log('[broker-replay-command-surface.test] ok');

function parseJsonOutput(stdout: string, stderr: string) {
  const output = (stdout || stderr).trim();
  assert.notEqual(output, '', 'expected CLI JSON on stdout or stderr');
  return JSON.parse(output);
}
