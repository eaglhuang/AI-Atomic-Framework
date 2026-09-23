// The CLI test sweep must fail on a failing test, a timeout, or a test that
// writes into the worktree, and its quarantine must carry a reason for every
// entry. Uses a temporary git fixture; it never runs the real test suite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isClean, runSweep, validateConfig, type SweepBatchTrace, type SweepConfig } from '../../scripts/run-cli-test-sweep.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-sweep-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '--quiet');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'fixture');
mkdirSync(path.join(fixture, 'tests'));
const tests: Record<string, string> = {
  'pass.test.ts': 'console.log("ok");',
  'fail.test.ts': 'process.exit(3);',
  'hang.test.ts': 'setTimeout(() => {}, 60000);',
  'writer.test.ts': 'import { writeFileSync } from "node:fs"; writeFileSync("tracked.txt", "changed\\n");',
};
for (const [name, body] of Object.entries(tests)) writeFileSync(path.join(fixture, 'tests', name), `${body}\n`);
writeFileSync(path.join(fixture, 'tracked.txt'), 'original\n');
git('add', '.');
git('commit', '--quiet', '-m', 'fixture');

const config: SweepConfig = { schemaId: 'atm.cliTestSweep.v1', testDir: 'tests', timeoutMs: 5000, concurrency: 4, quarantine: [], serial: [] };
const traces: SweepBatchTrace[] = [];
const results = await runSweep(fixture, config, Object.keys(tests).sort(), { onBatch: (trace) => traces.push(trace) });
const byName = Object.fromEntries(results.map((result) => [result.test, result]));
assert.equal(isClean(byName['pass.test.ts']), true);
assert.equal(byName['fail.test.ts'].exitCode, 3);
assert.equal(isClean(byName['fail.test.ts']), false);
assert.equal(byName['hang.test.ts'].timedOut, true, 'a test that never exits is stopped at the timeout');
assert.equal(isClean(byName['hang.test.ts']), false);
assert.deepEqual(byName['writer.test.ts'].dirtied, [' M tracked.txt'], 'the writer is attributed even when it ran in a parallel batch');
assert.equal(isClean(byName['writer.test.ts']), false, 'a test that writes into the worktree fails the sweep');
assert.equal(byName['pass.test.ts'].dirtied.length, 0, 'tests that share a batch with the writer are not blamed');
assert.equal(readFileSync(path.join(fixture, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n'), 'original\n', 'writes made by tests are discarded');
assert.ok(traces.some((trace) => trace.attempt === 'initial' && trace.dirtyRetry), 'a dirty parallel batch is recorded before retry');
assert.ok(traces.some((trace) => trace.attempt === 'retry' && trace.execution === 'serial' && trace.tests.includes('writer.test.ts')), 'the dirty writer retry is recorded as serial');

const available = Object.keys(tests);
assert.deepEqual(validateConfig({ ...config, quarantine: [{ test: 'fail.test.ts', reason: 'failing-on-main', detail: 'exit 3', disposition: 'triage' }] }, available), []);
assert.match(validateConfig({ ...config, quarantine: [{ test: 'fail.test.ts', reason: 'failing-on-main', detail: ' ', disposition: 'triage' }] }, available).join(), /needs a detail/);
assert.match(validateConfig({ ...config, quarantine: [{ test: 'gone.test.ts', reason: 'failing-on-main', detail: 'x', disposition: 'triage' }] }, available).join(), /does not exist/);
assert.match(validateConfig({ ...config, quarantine: [{ test: 'fail.test.ts', reason: 'flaky' as never, detail: 'x', disposition: 'triage' }] }, available).join(), /unknown reason/);
assert.match(validateConfig({
  ...config,
  quarantine: [{ test: 'fail.test.ts', reason: 'failing-on-main', detail: 'x', disposition: 'triage' }],
  serial: [{ test: 'fail.test.ts', detail: 'x' }],
}, available).join(), /both quarantined and serial/);

// The committed configuration itself must be valid.
const committed = JSON.parse(readFileSync(path.join(frameworkRoot, 'scripts/cli-test-sweep.config.json'), 'utf8')) as SweepConfig;
const committedTests = execFileSync('git', ['ls-files', committed.testDir], { cwd: frameworkRoot, encoding: 'utf8' })
  .split('\n').filter((file) => file.endsWith('.test.ts')).map((file) => path.basename(file));
assert.deepEqual(validateConfig(committed, committedTests), []);

rmSync(fixture, { recursive: true, force: true });
console.log('[cli-test-sweep.test] ok');
