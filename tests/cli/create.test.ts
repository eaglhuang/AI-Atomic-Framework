import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-cli-create-');
try {
  const dryRun = runAtm(['create', '--cwd', tempRoot, '--bucket', 'fixture', '--title', 'CliDryRun', '--description', 'CLI dry-run.', '--dry-run']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.parsed.ok, true);
  assert.equal(dryRun.parsed.evidence.dryRun, true);
  assert.equal(dryRun.parsed.evidence.atomId, 'ATM-FIXTURE-0001');
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), false);

  const create = runAtm(['create', '--cwd', tempRoot, '--bucket', 'fixture', '--title', 'CliCreate', '--description', 'CLI create.', '--logical-name', 'atom.fixture-cli-create']);
  assert.equal(create.exitCode, 0);
  assert.equal(create.parsed.ok, true);
  assert.equal(create.parsed.evidence.atomId, 'ATM-FIXTURE-0001');
  assert.equal(existsSync(path.join(tempRoot, create.parsed.evidence.sourcePath)), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), true);

  const idempotent = runAtm(['create', '--cwd', tempRoot, '--bucket', 'FIXTURE', '--title', 'CliCreate', '--description', 'CLI create.', '--logical-name', 'atom.fixture-cli-create']);
  assert.equal(idempotent.exitCode, 0);
  assert.equal(idempotent.parsed.evidence.idempotent, true);

  const missing = runAtm(['create', '--cwd', tempRoot, '--bucket', 'FIXTURE', '--title', 'Missing Description']);
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.parsed.ok, false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-create:test] ok (4 acceptance checks)');

function runAtm(args: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}
