import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { captureIndexRestorationSnapshot } from './index-restoration.ts';
import { INDEX_SNAPSHOT_READ_LIMITS, parseIndexSnapshotOutput, readCompleteIndexSnapshot } from './index-snapshot-read.ts';

const sha1 = 'a'.repeat(40);
const record = (name: string, metadata = `100644 ${sha1} 0`) => `${metadata}\t${name}\0`;
function rejectsCapture(run: () => unknown, reason: string): void {
  assert.throws(run, (error: unknown) => {
    const value = error as { code: string; details: { nestedFailure: { boundary: string; reason: string }; snapshotCaptured: boolean } };
    assert.equal(value.code, 'ATM_GIT_COMMIT_FAILED');
    assert.equal(value.details.nestedFailure.boundary, 'index-snapshot');
    assert.equal(value.details.nestedFailure.reason, reason);
    assert.equal(value.details.snapshotCaptured, false);
    return true;
  });
}

assert.equal(parseIndexSnapshotOutput(Buffer.alloc(0)).size, 0);
const unusualNames = [' leading', 'trailing ', 'tab\tname', 'line\nname', 'return\rname', 'quote"name', 'back\\slash', '雪', '\ufeffbom', '  '];
const unusual = parseIndexSnapshotOutput(Buffer.from(unusualNames.map((name) => record(name)).join('')));
assert.deepEqual([...unusual.keys()], unusualNames);
for (const mode of ['100644', '100755', '120000', '160000']) {
  assert.deepEqual(parseIndexSnapshotOutput(Buffer.from(record('mode', `${mode} ${sha1} 0`))).get('mode'), { mode, objectId: sha1, stage: '0' });
}
assert.equal(parseIndexSnapshotOutput(Buffer.from(record('sha256', `100644 ${'b'.repeat(64)} 0`))).get('sha256')?.objectId.length, 64);
for (const [output, reason] of [
  [record('valid') + 'incomplete', 'unterminated-record'],
  [record('valid') + '\0', 'malformed-record'],
  [record('valid') + 'malformed\0', 'malformed-record'],
  [record('bad', `040000 ${sha1} 0`), 'malformed-record'],
  [record('bad', `100644 ${'x'.repeat(40)} 0`), 'malformed-record'],
  [record('bad', `100644 ${'0'.repeat(40)} 0`), 'invalid-object-id'],
  [record('valid') + record('sha256', `100644 ${'b'.repeat(64)} 0`), 'invalid-object-id'],
  [record('dup') + record('dup'), 'duplicate-path'],
  ...['', '/absolute', 'a//b', './a', '../a', 'a/../b', 'a/./b', 'a/'].map((name) => [record(name), 'invalid-path']),
  ...['1', '2', '3'].map((stage) => [record('valid') + record('conflict', `100644 ${sha1} ${stage}`), 'unmerged-index'])
]) rejectsCapture(() => parseIndexSnapshotOutput(Buffer.from(output)), reason);
rejectsCapture(() => parseIndexSnapshotOutput(Buffer.concat([Buffer.from(record('valid') + `100644 ${sha1} 0\t`), Buffer.from([0xc3, 0x28, 0])])), 'invalid-utf8');
rejectsCapture(() => parseIndexSnapshotOutput(Buffer.alloc(INDEX_SNAPSHOT_READ_LIMITS.maxBytes + 1)), 'output-limit');
const excessiveEntries = Buffer.from(Array.from({ length: INDEX_SNAPSHOT_READ_LIMITS.maxEntries + 1 }, (_, index) => record(`f${index}`)).join(''));
rejectsCapture(() => parseIndexSnapshotOutput(excessiveEntries), 'entry-limit');

// A subprocess error may expose a valid-looking stdout prefix; never parse it.
const originalExec = childProcess.execFileSync;
try {
  childProcess.execFileSync = ((_executable, args, options) => {
    assert.deepEqual(args, ['-C', '/capture-fixture', 'ls-files', '--stage', '-z']);
    const settings = options as childProcess.ExecFileSyncOptions;
    assert.equal(settings.maxBuffer, INDEX_SNAPSHOT_READ_LIMITS.maxBytes);
    assert.equal(settings.timeout, INDEX_SNAPSHOT_READ_LIMITS.timeoutMs);
    assert.equal(settings.killSignal, 'SIGKILL');
    assert.equal(settings.encoding, 'buffer');
    assert.equal(settings.env, process.env, 'candidate GIT_INDEX_FILE environment must remain intact');
    return Buffer.from(record('complete'));
  }) as typeof execFileSync;
  syncBuiltinESMExports();
  assert.equal(readCompleteIndexSnapshot('/capture-fixture').size, 1);
  for (const failure of [{ code: 'ENOBUFS' }, { code: 'ETIMEDOUT', signal: 'SIGKILL' }, { status: 128 }, { code: 'ENOENT' }]) {
    childProcess.execFileSync = (() => { throw Object.assign(new Error('synthetic process failure'), failure, { stdout: Buffer.from(record('partial')) }); }) as typeof execFileSync;
    syncBuiltinESMExports();
    rejectsCapture(() => readCompleteIndexSnapshot('/capture-fixture'), 'process-failed');
  }
} finally {
  childProcess.execFileSync = originalExec;
  syncBuiltinESMExports();
}

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-large-index-snapshot-'));
function git(args: readonly string[], input?: string): Buffer {
  return execFileSync('git', ['-C', root, ...args], {
    input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
  });
}
try {
  git(['init', '-q']);
  const oid = git(['hash-object', '-w', '--stdin'], 'fixture\n').toString().trim();
  const names = Array.from({ length: 28_000 }, (_, index) => `padding/${String(index).padStart(5, '0')}-${'x'.repeat(130)}.txt`);
  git(['update-index', '--index-info'], names.map((name) => `100644 ${oid}\t${name}\n`).join(''));
  const bytes = git(['ls-files', '--stage', '-z']);
  assert(bytes.length > 5 * 1024 * 1024, 'real Git output must exceed the old 1 MiB process buffer');
  const before = readFileSync(path.join(root, '.git/index'));
  const snapshot = captureIndexRestorationSnapshot(root);
  assert.equal(snapshot.entries.size, names.length);
  for (const name of names) assert.deepEqual(snapshot.entries.get(name), { mode: '100644', objectId: oid, stage: '0' });
  assert.deepEqual(readFileSync(path.join(root, '.git/index')), before, 'capture must not modify the index');
  // Git on Windows may reject names its filesystem cannot represent. The
  // parser-only identity assertions above remain unconditional on every host.
  if (process.platform !== 'win32') {
    git(['update-index', '-z', '--index-info'], unusualNames.map((name) => `100644 ${oid}\t${name}\0`).join(''));
    const exact = captureIndexRestorationSnapshot(root);
    for (const name of unusualNames) assert.deepEqual(exact.entries.get(name), { mode: '100644', objectId: oid, stage: '0' });
  }
  git(['update-index', '--index-info'], `100644 ${oid} 1\tconflict.txt\n100644 ${oid} 2\tconflict.txt\n`);
  const unmerged = readFileSync(path.join(root, '.git/index'));
  rejectsCapture(() => captureIndexRestorationSnapshot(root), 'unmerged-index');
  assert.deepEqual(readFileSync(path.join(root, '.git/index')), unmerged, 'unmerged capture refusal must retain every stage');
  console.log(`index-snapshot-read: complete ${snapshot.entries.size}-entry / ${bytes.length}-byte real Git snapshot passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
