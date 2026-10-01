import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../../scripts/run-validators.ts', import.meta.url));
function run(profile: string, filter: string) {
  const result = spawnSync(process.execPath, ['--strip-types', runner, profile, '--filter', filter, '--json'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { status: result.status, summary: JSON.parse(result.stdout) };
}

for (const filter of ['audit-nonexistent-validator', 'tag:audit-nonexistent-tag']) {
  const { status, summary } = run('test', filter);
  assert.notEqual(status, 0, `empty explicit filter ${filter} must not pass`);
  assert.equal(summary.total, 0);
  assert.equal(summary.passed, 0);
  assert.equal(summary.failed, 0, 'selection failure is not a fabricated executed test');
  assert.equal(summary.taskLevelOk, false);
  assert.equal(summary.currentTaskOk, false);
  assert.equal(summary.notRunReason, 'empty-explicit-filter');
}
const positive = run('quick', 'validate-product-charter');
assert.equal(positive.status, 0);
assert.equal(positive.summary.total, 1);
assert.equal(positive.summary.passed, 1);
assert.equal(positive.summary.taskLevelOk, true);
console.log('[validator-empty-selection] ok');
