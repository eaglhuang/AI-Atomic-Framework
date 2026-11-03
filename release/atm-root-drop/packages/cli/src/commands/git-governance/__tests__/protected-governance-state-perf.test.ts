import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { inspectProtectedGovernanceStateDestructiveChanges as inspect } from '../protected-governance-state.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-protected-diff-perf-'));
const ledger = '.atm/history/tasks/TASK-OWNER.json';
const event = '.atm/history/task-events/TASK-OWNER/line\n[one]*.json';
const calls: { args: readonly string[]; index?: string }[] = [];
let deleted: string[] = [ledger, event];
let probeFailure: Error | null = null;
const stub = mock.method(childProcess, 'execFileSync', (_git: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
  calls.push({ args, index: options.env?.GIT_INDEX_FILE });
  if (probeFailure) throw probeFailure;
  return deleted.join('\0') + '\0';
});
syncBuiltinESMExports();
const saved = { enabled: process.env.ATM_GIT_TIMING, file: process.env.ATM_GIT_TIMING_FILE };
try {
  delete process.env.ATM_GIT_TIMING;
  assert.equal(inspect({ cwd, taskId: 'writer', commitFiles: ['src/change.ts'] }).ok, true);
  assert.equal(inspect({ cwd, taskId: 'writer', commitFiles: [] }).ok, true);
  assert.equal(calls.length, 0, 'ordinary commits and empty candidates spawn no deletion diffs');
  process.env.ATM_GIT_TIMING = '1';
  process.env.ATM_GIT_TIMING_FILE = path.join(cwd, 'timing.jsonl');
  for (const index of ['session-a', 'session-b']) {
    const report = inspect({ cwd, taskId: 'writer', env: { GIT_INDEX_FILE: index }, commitFiles: [event, ledger, ledger, 'src/change.ts'] });
    assert.deepEqual(report.violations.map((entry) => entry.path).sort(), [event, ledger].sort());
    assert.equal(report.ok, false);
  }
  assert.equal(calls.length, 4, 'exactly two diffs per inspected snapshot, regardless of duplicate paths');
  for (const call of calls) {
    assert.equal(call.args[0], '--literal-pathspecs');
    assert.ok(call.args.includes('-z'), 'Git output is NUL-delimited');
    assert.deepEqual([...call.args.slice(call.args.indexOf('--') + 1)].sort(), [event, ledger].sort());
  }
  assert.deepEqual(calls.map((call) => call.index), ['session-a', 'session-a', 'session-b', 'session-b']);
  deleted = [];
  assert.equal(inspect({ cwd, taskId: 'writer', env: { GIT_INDEX_FILE: 'session-a' }, commitFiles: [ledger] }).ok, true,
    'a changed index must never reuse a cached deletion report');
  const timing = readFileSync(process.env.ATM_GIT_TIMING_FILE, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(timing.length, 6);
  assert.ok(timing.every((entry) => entry.elapsedMs >= 0 && entry.pid === process.pid));
  deleted = [ledger];
  assert.equal(inspect({ cwd, taskId: 'writer' }).ok, false, 'omitted commitFiles retains repository-wide protection');
  assert.ok(!calls.at(-1)!.args.includes('--'), 'unbounded inspection remains unbounded');
  for (const failure of [
    Object.assign(new Error('exit failure'), { status: 128 }),
    Object.assign(new Error('killed'), { signal: 'SIGTERM' }),
    Object.assign(new Error('overflow'), { code: 'ENOBUFS' })
  ]) {
    probeFailure = failure;
    assert.throws(() => inspect({ cwd, taskId: 'writer', commitFiles: [ledger] }),
      (error: any) => error.code === 'ATM_GIT_PROTECTED_STATE_INSPECTION_FAILED',
      'an unavailable deletion probe must block the commit');
  }
} finally {
  stub.mock.restore();
  syncBuiltinESMExports();
  for (const [key, value] of [['ATM_GIT_TIMING', saved.enabled], ['ATM_GIT_TIMING_FILE', saved.file]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
}
console.log('[protected-governance-state-perf] ok');
