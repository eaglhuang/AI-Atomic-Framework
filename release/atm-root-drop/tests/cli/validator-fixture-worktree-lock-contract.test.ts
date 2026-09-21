import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8'));

for (const name of [
  'validate-governance-commands',
  'validate-external-golden',
  'validate-self-hosting-alpha'
]) {
  const validator = config.validators.find((entry: any) => entry.name === name);
  assert.ok(validator, `${name} must remain registered`);
  assert.ok(
    validator.resourceLocks?.includes('fixture-worktree'),
    `${name} must serialize full fixture worktrees with other fixture validators`,
  );
}

console.log('[validator-fixture-worktree-lock-contract] ok');
