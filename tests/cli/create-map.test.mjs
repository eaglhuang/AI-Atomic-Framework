import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-create-map-'));
const members = JSON.stringify([{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }]);
const entrypoints = JSON.stringify(['ATM-FIXTURE-0001']);
const qualityTargets = JSON.stringify({ requiredChecks: 1, promoteGateRequired: true });
try {
  const dryRun = runAtm(['create-map', '--cwd', tempRoot, '--members', members, '--entrypoints', entrypoints, '--quality-targets', qualityTargets, '--dry-run']);
  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.parsed.ok, true);
  assert.equal(dryRun.parsed.evidence.dryRun, true);
  assert.equal(dryRun.parsed.evidence.mapId, 'ATM-MAP-0001');
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), false);

  const create = runAtm(['create-map', '--cwd', tempRoot, '--members', members, '--entrypoints', entrypoints, '--quality-targets', qualityTargets]);
  assert.equal(create.exitCode, 0);
  assert.equal(create.parsed.ok, true);
  assert.equal(create.parsed.evidence.mapId, 'ATM-MAP-0001');
  assert.equal(existsSync(path.join(tempRoot, create.parsed.evidence.specPath)), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), true);

  const idempotent = runAtm(['create-map', '--cwd', tempRoot, '--members', members, '--entrypoints', entrypoints, '--quality-targets', qualityTargets]);
  assert.equal(idempotent.exitCode, 0);
  assert.equal(idempotent.parsed.evidence.idempotent, true);

  const missing = runAtm(['create-map', '--cwd', tempRoot, '--members', members, '--entrypoints', entrypoints]);
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.parsed.ok, false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-create-map:test] ok (4 acceptance checks)');

function runAtm(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'packages/cli/src/atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}