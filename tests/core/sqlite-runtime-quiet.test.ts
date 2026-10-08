import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Every ATM command used to print Node's SQLite ExperimentalWarning on
// supported Node 24 releases because node:sqlite was imported statically.
// Loading it through loadDatabaseSync must work, stay quiet about SQLite,
// and leave every other warning untouched.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtime = pathToFileURL(path.join(root, 'packages', 'core', 'src', 'broker', 'sqlite-runtime.ts')).href;
const script = `
const { loadDatabaseSync } = await import(${JSON.stringify(runtime)});
const DatabaseSync = loadDatabaseSync();
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (v INTEGER)');
db.prepare('INSERT INTO t VALUES (?)').run(7);
console.log(db.prepare('SELECT v FROM t').get().v);
db.close();
process.emitWarning('other warning still shown');
`;
const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr);
assert.equal(run.stdout.trim(), '7');
assert.doesNotMatch(run.stderr, /SQLite is an experimental feature/);
assert.match(run.stderr, /other warning still shown/);

// The steward modules must not import node:sqlite at load time.
const steward = pathToFileURL(path.join(root, 'packages', 'core', 'src', 'broker', 'steward-apply-queue.ts')).href;
const lock = pathToFileURL(path.join(root, 'packages', 'core', 'src', 'broker', 'steward-kernel-lock.ts')).href;
const importOnly = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', `await import(${JSON.stringify(steward)}); await import(${JSON.stringify(lock)});`], { encoding: 'utf8' });
assert.equal(importOnly.status, 0, importOnly.stderr);
assert.doesNotMatch(importOnly.stderr, /SQLite is an experimental feature/);

console.log('[sqlite-runtime-quiet] ok');
