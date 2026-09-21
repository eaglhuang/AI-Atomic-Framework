import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this as a command-backed regression test: the validator owns the
// isolated fixture and exercises the same public sync path used by release
// automation (sync, skip, dry-run, backup, and pinned-runner metadata).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const validator = path.join(root, 'scripts', 'validate-internal-release-sync.ts');
const result = spawnSync(
  process.execPath,
  ['--strip-types', validator, '--mode', 'validate'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);

assert.equal(
  result.status,
  0,
  `internal release sync validator failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
);
assert.match(
  result.stdout,
  /ok \(sync, skip, dry-run, backup, and metadata verified\)/,
  'validator must report all internal release sync scenarios as verified'
);

console.log('[internal-release-sync.test] ok');
