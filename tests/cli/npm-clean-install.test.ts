import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const validator = path.join(root, 'scripts', 'validate-npm-clean-install.ts');

assert.ok(existsSync(validator), 'clean-install validator must exist');
for (const [directory, expectedFiles] of [
  ['packages/cli', ['dist']],
  ['packages/create-atm', ['dist', 'README.md']]
] as const) {
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.files, expectedFiles, `${directory} must publish only its runtime allowlist`);
}

console.log('[npm-clean-install:test] ok');
