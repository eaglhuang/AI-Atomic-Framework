import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const repro = spawnSync(process.execPath, [
  path.join(root, 'scripts/repro/bug-atm-0045-planning-root-preference.mjs')
], {
  cwd: root,
  encoding: 'utf8'
});

if (repro.status !== 0) {
  console.error(repro.stdout);
  console.error(repro.stderr);
  throw new Error('[validate-planning-root-canonical-preference] repro failed');
}

const unit = spawnSync(process.execPath, [
  '--strip-types',
  path.join(root, 'packages/cli/src/commands/next/__tests__/planning-root-preference.test.ts')
], {
  cwd: root,
  encoding: 'utf8'
});

assert.equal(unit.status, 0, unit.stderr || unit.stdout);

console.log('[validate-planning-root-canonical-preference] ok');
