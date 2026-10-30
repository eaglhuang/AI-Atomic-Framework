// The CLI test sweep must fail on a failing test, a timeout, or a test that
// writes into the worktree, and its quarantine must carry a reason for every
// entry. Uses a temporary git fixture; it never runs the real test suite.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtmResultLine } from '../../scripts/lib/atm-result-line.ts';
import { isClean, runSweep, resolveSweepConcurrency, validateConfig, type SweepBatchTrace, type SweepConfig } from '../../scripts/run-cli-test-sweep.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-sweep-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '--quiet');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'fixture');
mkdirSync(path.join(fixture, 'tests'));
const tests: Record<string, string> = {
  'pass.test.ts': 'console.log("ok"); console.error("diagnostic");',
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

const streamLog = `${fixture}.log`;
try {
  const loggedResults = await runSweep(fixture, config, ['pass.test.ts'], { logFile: streamLog });
  assert.equal(isClean(loggedResults[0]), true);
  assert.match(readFileSync(streamLog, 'utf8'), /ok/);
  assert.match(readFileSync(streamLog, 'utf8'), /diagnostic/);
} finally {
  rmSync(streamLog, { force: true });
}

// A free slot must start queued work while a slower file is still running.
// The slow file waits for the queued file: fixed batches time out here.
const poolSignals = mkdtempSync(path.join(os.tmpdir(), 'atm-sweep-pool-signals-'));
try {
  const marker = path.join(poolSignals, 'queued-started');
  const events = path.join(poolSignals, 'events');
  const eventCode = (event: string) => `appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(event + '\n')});`;
  const bodies: Record<string, string> = {
    'pool-a-slow.test.ts': `import {appendFileSync,existsSync} from 'node:fs'; ${eventCode('start:slow')} const timer=setInterval(()=>{if(existsSync(${JSON.stringify(marker)})){clearInterval(timer);${eventCode('end:slow')}}},10);`,
    'pool-b-fast.test.ts': `import {appendFileSync} from 'node:fs'; ${eventCode('start:fast')} ${eventCode('end:fast')}`,
    'pool-c-queued.test.ts': `import {appendFileSync,writeFileSync} from 'node:fs'; ${eventCode('start:queued')} writeFileSync(${JSON.stringify(marker)},'ready'); ${eventCode('end:queued')}`,
  };
  for (const [name, body] of Object.entries(bodies)) writeFileSync(path.join(fixture, 'tests', name), body);
  git('add', 'tests'); git('commit', '--quiet', '-m', 'pool scheduling fixture');
  const poolResults = await runSweep(fixture, { ...config, concurrency: 2 }, Object.keys(bodies));
  assert.ok(poolResults.every(isClean), 'queued work releases the slow file without a timeout');
  const observed = readFileSync(events, 'utf8').trim().split('\n');
  assert.ok(observed.indexOf('start:queued') < observed.indexOf('end:slow'), 'slots are replenished before slow files finish');
  let active = 0, maximum = 0;
  for (const event of observed) { active += event.startsWith('start:') ? 1 : -1; maximum = Math.max(maximum, active); }
  assert.equal(active, 0); assert.ok(maximum <= 2, 'the declared worker bound is preserved');
  assert.equal(resolveSweepConcurrency(8, 2), 4);
  assert.equal(resolveSweepConcurrency(8, 8), 8);
  assert.equal(resolveSweepConcurrency(1, 8), 1);
  // A descendant inheriting stderr must not hold the sweep open after timeout.
  const parentPidFile = path.join(poolSignals, 'timeout-parent');
  const childReady = path.join(poolSignals, 'timeout-child-ready');
  const descendantCode = `require('node:fs').writeFileSync(${JSON.stringify(childReady)},'ready');setInterval(()=>{},1000);`;
  const timeoutCode = `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(parentPidFile)},String(process.pid));spawn(process.execPath,['-e',${JSON.stringify(descendantCode)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
  writeFileSync(path.join(fixture, 'tests', 'pool-descendant.test.ts'), timeoutCode);
  git('add', 'tests'); git('commit', '--quiet', '-m', 'timeout process tree fixture');
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const timed = await Promise.race([
      runSweep(fixture, { ...config, concurrency: 1 }, ['pool-descendant.test.ts']),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('descendant held sweep stderr open')), 15000); }),
    ]);
    assert.equal(readFileSync(childReady, 'utf8'), 'ready', 'the inheriting descendant actually started');
    assert.equal(timed[0].timedOut, true, 'the unchanged deadline terminates the whole test group');
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (process.platform !== 'win32') {
      try { process.kill(-Number(readFileSync(parentPidFile, 'utf8')), 'SIGKILL'); } catch { /* reaped */ }
    }
  }

} finally { rmSync(poolSignals, { recursive: true, force: true }); }

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

// A serial writer must remain reportable without running the next test or
// mutating its evidence. Otherwise the next clean-worktree check hides it.
const serialStashes = git('stash', 'list').toString();
const serialResults = await runSweep(fixture, { ...config, concurrency: 1 }, ['writer.test.ts', 'pass.test.ts']);
assert.equal(serialResults.length, 1, 'stop after a serial writer');
assert.deepEqual(serialResults[0].dirtied, [' M tracked.txt']);
assert.equal(isClean(serialResults[0]), false);
assert.equal(readFileSync(path.join(fixture, 'tracked.txt'), 'utf8'), 'changed\n');
assert.equal(git('stash', 'list').toString(), serialStashes, 'no recovery mutation on serial stop');

// Recovery must never sweep away pre-existing tracked/untracked user work.
const stashBefore = git('stash', 'list').toString();
writeFileSync(path.join(fixture, 'tracked.txt'), 'user WIP\n');
writeFileSync(path.join(fixture, 'user-untracked.txt'), 'untracked WIP\n');
await assert.rejects(runSweep(fixture, config, ['pass.test.ts', 'writer.test.ts']), /clean.*worktree/i);
assert.equal(readFileSync(path.join(fixture, 'tracked.txt'), 'utf8'), 'user WIP\n');
assert.equal(readFileSync(path.join(fixture, 'user-untracked.txt'), 'utf8'), 'untracked WIP\n');
assert.equal(git('stash', 'list').toString(), stashBefore, 'user stash history must remain unchanged');

// Exercise the public report path in another disposable repository. Serial
// writers must produce JSON, not erase attribution with an admission throw.
const reportFixture = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-sweep-report-'));
try {
  const reportGit = (...args: string[]) => execFileSync('git', args, { cwd: reportFixture, stdio: ['ignore', 'pipe', 'pipe'] });
  reportGit('init', '--quiet');
  reportGit('config', 'user.email', 'fixture@example.invalid');
  reportGit('config', 'user.name', 'fixture');
  mkdirSync(path.join(reportFixture, 'scripts'));
  mkdirSync(path.join(reportFixture, 'tests'));
  writeFileSync(path.join(reportFixture, 'scripts/run-cli-test-sweep.ts'), readFileSync(path.join(frameworkRoot, 'scripts/run-cli-test-sweep.ts')));
  writeFileSync(path.join(reportFixture, 'scripts/cli-test-sweep.config.json'), JSON.stringify({ ...config, concurrency: 1 }));
  writeFileSync(path.join(reportFixture, 'tests/a-writer.test.ts'), `${tests['writer.test.ts']}\n`);
  writeFileSync(path.join(reportFixture, 'tests/b-pass.test.ts'), `${tests['pass.test.ts']}\n`);
  writeFileSync(path.join(reportFixture, 'tracked.txt'), 'original\n');
  reportGit('add', '.');
  reportGit('commit', '--quiet', '-m', 'fixture');
  mkdirSync(path.join(reportFixture, 'scripts/lib'));
  writeFileSync(path.join(reportFixture, 'scripts/lib/atm-result-line.ts'), readFileSync(path.join(frameworkRoot, 'scripts/lib/atm-result-line.ts')));
  reportGit('add', 'scripts/lib/atm-result-line.ts');
  reportGit('commit', '--quiet', '-m', 'logging helper fixture');
  const reportRun = spawnSync(process.execPath, ['--strip-types', 'scripts/run-cli-test-sweep.ts'], { cwd: reportFixture, encoding: 'utf8' });
  assert.equal(reportRun.status, 1, reportRun.stderr);
  const report = JSON.parse(reportRun.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.ran, 1);
  assert.deepEqual(report.skippedTests, ['b-pass.test.ts']);
  assert.equal(report.failures[0].test, 'a-writer.test.ts');
  assert.deepEqual(report.failures[0].dirtied, [' M tracked.txt']);
  assert.equal(readFileSync(path.join(reportFixture, 'tracked.txt'), 'utf8'), 'changed\n');
  writeFileSync(path.join(reportFixture, 'tracked.txt'), 'original\n');
  const logFile = `${reportFixture}.log`;
  try {
    const logged = spawnSync(process.execPath, ['--strip-types', 'scripts/run-cli-test-sweep.ts', '--log-file', logFile], { cwd: reportFixture, encoding: 'utf8' });
    assert.equal(logged.status, 1, logged.stderr);
    assert.equal(logged.stderr, '');
    assert.equal(logged.stdout.trim().split('\n').length, 1);
    const result = parseAtmResultLine(logged.stdout.trim());
    assert.equal(result?.code, 'SWEEP_FAILED');
    assert.match(result?.hint ?? '', /a-writer.test.ts/);
    assert.match(readFileSync(logFile, 'utf8'), /"failures"/);
    const priorLog = readFileSync(logFile, 'utf8');
    writeFileSync(path.join(reportFixture, 'tracked.txt'), 'original\n');
    const success = spawnSync(process.execPath, ['--strip-types', 'scripts/run-cli-test-sweep.ts', '--check-quarantine'], {
      cwd: reportFixture, encoding: 'utf8', env: { ...process.env, ATM_SWEEP_LOG_FILE: logFile }
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stderr, '');
    assert.equal(success.stdout.trim().split('\n').length, 1);
    assert.equal(parseAtmResultLine(success.stdout.trim())?.code, 'SWEEP_OK');
    assert.ok(readFileSync(logFile, 'utf8').startsWith(priorLog), 'sweep log must append');
  } finally {
    rmSync(logFile, { force: true });
  }
} finally {
  rmSync(reportFixture, { recursive: true, force: true });
}

rmSync(fixture, { recursive: true, force: true });
console.log('[cli-test-sweep.test] ok');
