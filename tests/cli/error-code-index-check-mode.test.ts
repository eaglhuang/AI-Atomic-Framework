/** `generate:error-codes --check` must not rewrite generated projections. */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';

const targets = [
  'docs/ERROR_CODES.md',
  'packages/core/src/error-code-registry.generated.ts'
];
const before = targets.map((filePath) => ({ filePath, mtimeMs: statSync(filePath).mtimeMs, bytes: readFileSync(filePath) }));

const result = spawnSync(process.execPath, ['--strip-types', 'scripts/generate-error-code-index.ts', '--check'], { encoding: 'utf8' });
assert.ok([0, 1].includes(result.status ?? -1), `unexpected --check exit: ${result.status}`);
if (result.status === 1) assert.match(String(result.stderr), /stale generated file/);

for (const snapshot of before) {
  const after = statSync(snapshot.filePath);
  assert.equal(after.mtimeMs, snapshot.mtimeMs, `${snapshot.filePath} was rewritten by --check`);
  assert.deepEqual(readFileSync(snapshot.filePath), snapshot.bytes, `${snapshot.filePath} changed during --check`);
}

console.log('[error-code-index-check-mode.test] ok');
