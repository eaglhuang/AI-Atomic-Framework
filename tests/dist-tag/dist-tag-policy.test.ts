import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNpmDistTag } from '../../scripts/validate-dist-tag.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

assert.equal(resolveNpmDistTag('1.2.3').distTag, 'latest');
assert.equal(resolveNpmDistTag('1.2.3-beta.0').distTag, 'next');
assert.equal(resolveNpmDistTag('1.2.3-alpha.0').distTag, 'beta');
assert.equal(resolveNpmDistTag('1.2.3', 'lts').distTag, 'lts');
assert.notEqual(resolveNpmDistTag('1.2.3-beta.0').distTag, 'latest');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-create-tag-'));
const createResult = spawnSync(process.execPath, [
  '--strip-types',
  path.join(root, 'packages', 'create-atm', 'src', 'index.ts'),
  'tag-next-fixture',
  '--cwd', tempRoot,
  '--tag', 'next',
  '--json'
], {
  cwd: root,
  encoding: 'utf8'
});

assert.equal(createResult.status, 0, createResult.stderr || createResult.stdout);
const payload = JSON.parse(createResult.stdout);
assert.equal(payload.evidence.distTag.requestedTag, 'next');
assert.equal(payload.evidence.distTag.tier, 'beta');
assert.equal(payload.evidence.distTag.expectedCliPrerelease, 'beta');

const selectionPath = path.join(tempRoot, 'tag-next-fixture', '.atm', 'runtime', 'dist-tag.json');
assert.equal(existsSync(selectionPath), true);
const selection = JSON.parse(readFileSync(selectionPath, 'utf8'));
assert.equal(selection.requestedTag, 'next');
assert.equal(selection.tier, 'beta');

console.log('[dist-tag-test] ok');
