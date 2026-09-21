// The guard under test: an incomplete Plan 3.2 replay must keep the terminal
// verdict not-complete and fail closed. Plan 3.2 itself has since completed, so
// running the validator against live data can never satisfy a guard that
// requires an incomplete replay. Feed it fixtures instead, and also assert that
// it refuses a replay whose counts do not add up.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atm-plan32-terminal-'));
const replayPath = (name: string, replay: unknown): string => {
  const target = path.join(scratch, `${name}.json`);
  writeFileSync(target, `${JSON.stringify(replay, null, 2)}\n`, 'utf8');
  return target;
};
// The validator exits non-zero when it rejects a replay, which is the point,
// so read its receipt either way.
const run = (input: string) => {
  const result = spawnSync('node', [
    '--strip-types', 'scripts/validate-plan32-terminal-verdict-fail-closed.ts', '--input', input, '--json'
  ], { encoding: 'utf8' });
  const receipt = JSON.parse(result.stdout);
  assert.equal(result.status, receipt.ok ? 0 : 1, 'the exit code must follow the receipt');
  return receipt;
};

try {
  const incomplete = run(replayPath('incomplete', {
    schemaId: 'atm.planObjectiveReplay.v1',
    planId: '3.2',
    denominator: 29,
    statusCounts: { verified: 11, 'not-complete': 18 },
    verdict: 'not-complete'
  }));
  assert.equal(incomplete.schemaId, 'atm.plan32TerminalVerdictFailClosedValidation.v1');
  assert.equal(incomplete.ok, true, JSON.stringify(incomplete.findings));
  assert.equal(incomplete.verified + incomplete.notComplete, incomplete.denominator);
  assert.equal(incomplete.verdict, 'not-complete');
  assert.equal(incomplete.failClosed, true, 'an incomplete replay must fail closed');

  const wrongVerdict = run(replayPath('wrong-verdict', {
    schemaId: 'atm.planObjectiveReplay.v1',
    planId: '3.2',
    denominator: 29,
    statusCounts: { verified: 11, 'not-complete': 18 },
    verdict: 'complete'
  }));
  assert.equal(wrongVerdict.ok, false, 'an incomplete replay claiming complete must be rejected');
  assert.ok(wrongVerdict.findings.some((finding: string) => finding.includes('terminal verdict')));

  const badCounts = run(replayPath('bad-counts', {
    schemaId: 'atm.planObjectiveReplay.v1',
    planId: '3.2',
    denominator: 29,
    statusCounts: { verified: 11, 'not-complete': 1 },
    verdict: 'not-complete'
  }));
  assert.equal(badCounts.ok, false, 'counts that do not sum to the denominator must be rejected');
  assert.ok(badCounts.findings.some((finding: string) => finding.includes('sum to denominator')));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('plan32-terminal-verdict-fail-closed.test.ts: ok');
