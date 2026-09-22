// Runs every tests/cli/*.test.ts file that is not quarantined, so tests that no
// validator lists still run in CI. A test fails the sweep when it exits non-zero,
// times out, or leaves the worktree dirty. Quarantined tests must name a reason
// and a disposition; the sweep also fails when a quarantined test starts passing
// cleanly, so the quarantine cannot silently outlive its reason.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface QuarantineEntry {
  readonly test: string;
  /** `failing-on-main`: fails on main and has not been root-caused yet. */
  readonly reason: 'failing-on-main' | 'stale-assertion' | 'writes-tracked-files' | 'environment-dependent' | 'too-slow';
  readonly detail: string;
  readonly disposition: 'triage' | 'fix' | 'delete' | 'move-to-slow-profile';
}

export interface SweepConfig {
  readonly schemaId: 'atm.cliTestSweep.v1';
  readonly testDir: string;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly quarantine: readonly QuarantineEntry[];
  /** Tests that share state with other tests; they run one at a time after the parallel batches. */
  readonly serial: ReadonlyArray<{ readonly test: string; readonly detail: string }>;
}

export interface TestResult {
  readonly test: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly dirtied: string[];
  readonly durationMs: number;
  readonly stderrTail: string;
}

export interface SweepBatchTrace {
  readonly tests: readonly string[];
  readonly execution: 'parallel' | 'serial';
  readonly attempt: 'initial' | 'retry';
  readonly durationMs: number;
  readonly dirtyRetry: boolean;
}

export interface SweepRunOptions {
  readonly onBatch?: (trace: SweepBatchTrace) => void;
}

// 'stale-source-digest' is distinct from 'stale-assertion': the test's own
// expectations still hold, and what has drifted is a report's recorded binding
// to a source that was refreshed without recompiling it. The two send a reader
// to different places -- one to the test, one to whoever owns the report chain.
const REASONS = new Set(['failing-on-main', 'stale-assertion', 'stale-source-digest', 'writes-tracked-files', 'environment-dependent', 'too-slow']);
const DISPOSITIONS = new Set(['triage', 'fix', 'delete', 'move-to-slow-profile']);

export function validateConfig(config: SweepConfig, available: readonly string[]): string[] {
  const errors: string[] = [];
  if (config.schemaId !== 'atm.cliTestSweep.v1') errors.push('schemaId must be atm.cliTestSweep.v1');
  if (!(config.timeoutMs > 0) || !Number.isSafeInteger(config.concurrency) || config.concurrency < 1) errors.push('timeoutMs and concurrency must be positive');
  const seen = new Set<string>();
  for (const entry of config.quarantine) {
    if (seen.has(entry.test)) errors.push(`duplicate quarantine entry ${entry.test}`);
    seen.add(entry.test);
    if (!available.includes(entry.test)) errors.push(`quarantined test ${entry.test} does not exist`);
    if (!REASONS.has(entry.reason)) errors.push(`quarantined test ${entry.test} has unknown reason ${entry.reason}`);
    if (!DISPOSITIONS.has(entry.disposition)) errors.push(`quarantined test ${entry.test} has unknown disposition ${entry.disposition}`);
    if (typeof entry.detail !== 'string' || entry.detail.trim().length === 0) errors.push(`quarantined test ${entry.test} needs a detail`);
  }
  for (const entry of config.serial ?? []) {
    if (!available.includes(entry.test)) errors.push(`serial test ${entry.test} does not exist`);
    if (seen.has(entry.test)) errors.push(`test ${entry.test} is both quarantined and serial`);
    if (typeof entry.detail !== 'string' || entry.detail.trim().length === 0) errors.push(`serial test ${entry.test} needs a detail`);
  }
  return errors;
}

/** A failure is anything other than a clean exit that leaves the worktree unchanged. */
export function isClean(result: TestResult): boolean {
  return result.exitCode === 0 && !result.timedOut && result.dirtied.length === 0;
}

function worktreeState(root: string): Set<string> {
  const out = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  return new Set(out.stdout.split('\n').filter(Boolean));
}

function runOne(root: string, testDir: string, test: string, timeoutMs: number): Promise<Omit<TestResult, 'dirtied'>> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--strip-types', path.join(testDir, test)], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ test, exitCode: code, timedOut, durationMs: Date.now() - started, stderrTail: stderr.slice(-600) });
    });
  });
}

export async function runSweep(root: string, config: SweepConfig, only?: readonly string[], options: SweepRunOptions = {}, attempt: SweepBatchTrace['attempt'] = 'initial'): Promise<TestResult[]> {
  const testDir = path.join(root, config.testDir);
  const tests = only ?? readdirSync(testDir).filter((name) => name.endsWith('.test.ts')).sort();
  const results: TestResult[] = [];
  // Dirty detection needs a stable baseline, so concurrent tests are attributed
  // as a batch and a dirty batch is rerun one test at a time to find the writer.
  for (let index = 0; index < tests.length; index += config.concurrency) {
    const batch = tests.slice(index, index + config.concurrency);
    const before = worktreeState(root);
    const batchStarted = Date.now();
    const outcomes = await Promise.all(batch.map((test) => runOne(root, testDir, test, config.timeoutMs)));
    const added = [...worktreeState(root)].filter((line) => !before.has(line));
    const dirtyRetry = added.length > 0 && batch.length > 1;
    options.onBatch?.({
      tests: batch,
      execution: batch.length === 1 ? 'serial' : 'parallel',
      attempt,
      durationMs: Date.now() - batchStarted,
      dirtyRetry,
    });
    if (added.length === 0 || batch.length === 1) {
      for (const outcome of outcomes) results.push({ ...outcome, dirtied: batch.length === 1 ? added : [] });
      continue;
    }
    spawnSync('git', ['stash', 'push', '--include-untracked', '--quiet'], { cwd: root });
    spawnSync('git', ['stash', 'drop', '--quiet'], { cwd: root });
    for (const test of batch) {
      const [single] = await runSweep(root, config, [test], options, 'retry');
      results.push(single);
      if (single.dirtied.length) {
        spawnSync('git', ['stash', 'push', '--include-untracked', '--quiet'], { cwd: root });
        spawnSync('git', ['stash', 'drop', '--quiet'], { cwd: root });
      }
    }
  }
  return results;
}

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = path.join(root, 'scripts/cli-test-sweep.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as SweepConfig;
  const available = readdirSync(path.join(root, config.testDir)).filter((name) => name.endsWith('.test.ts'));
  const configErrors = validateConfig(config, available);
  if (configErrors.length) {
    console.error(JSON.stringify({ ok: false, configErrors }, null, 2));
    process.exitCode = 1;
    return;
  }
  // Writes made by tests are discarded between batches, so a dirty worktree would lose work.
  if (worktreeState(root).size > 0) {
    console.error('the CLI test sweep needs a clean worktree: it attributes and discards the writes tests make');
    process.exitCode = 1;
    return;
  }
  const quarantined = new Set(config.quarantine.map((entry) => entry.test));
  const includeQuarantine = process.argv.includes('--check-quarantine');
  const batches: SweepBatchTrace[] = [];
  const startedAt = Date.now();
  const selected = available.filter((test) => includeQuarantine ? quarantined.has(test) : !quarantined.has(test)).sort();
  const serial = new Set((config.serial ?? []).map((entry) => entry.test));
  const results = [
    ...await runSweep(root, config, selected.filter((test) => !serial.has(test)), { onBatch: (trace) => batches.push(trace) }),
    ...await runSweep(root, { ...config, concurrency: 1 }, selected.filter((test) => serial.has(test)), { onBatch: (trace) => batches.push(trace) }),
  ];
  const failures = results.filter((result) => includeQuarantine ? isClean(result) : !isClean(result));
  const slowTests = [...results]
    .sort((left, right) => right.durationMs - left.durationMs || left.test.localeCompare(right.test))
    .slice(0, 20)
    .map(({ test, durationMs, exitCode, timedOut, dirtied }) => ({ test, durationMs, exitCode, timedOut, dirtied }));
  const slowBatches = [...batches]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 20);
  const summary = {
    ok: failures.length === 0,
    mode: includeQuarantine ? 'check-quarantine' : 'sweep',
    ran: results.length,
    quarantined: quarantined.size,
    totalDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    wallClockDurationMs: Date.now() - startedAt,
    timing: {
      parallelBatches: batches.filter((batch) => batch.execution === 'parallel').length,
      serialBatches: batches.filter((batch) => batch.execution === 'serial').length,
      dirtyRetryBatches: batches.filter((batch) => batch.dirtyRetry).length,
      initialBatches: batches.filter((batch) => batch.attempt === 'initial').length,
      retryBatches: batches.filter((batch) => batch.attempt === 'retry').length,
      slowTests,
      slowBatches,
    },
    failures: failures.map((result) => includeQuarantine
      ? { test: result.test, problem: 'quarantined test now passes cleanly; remove it from the quarantine' }
      : { test: result.test, exitCode: result.exitCode, timedOut: result.timedOut, dirtied: result.dirtied, stderrTail: result.stderrTail }),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
