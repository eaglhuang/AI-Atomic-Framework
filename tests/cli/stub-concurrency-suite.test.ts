// #367: Product CI runs the CLI sweep on every PR, including all four required
// path families. Keep this discoverable and out of quarantine. Fixtures use
// independent temporary repositories, so the normal parallel sweep is safe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = spawnSync('timeout', ['170', 'bash',
  'research/paper-v2/prereg-v3-smoke/kit/test/run-concurrency-suite.sh'], {
  cwd: root, encoding: 'utf8', timeout: 175_000, maxBuffer: 4 * 1024 * 1024
});
assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
process.stdout.write(result.stdout);
