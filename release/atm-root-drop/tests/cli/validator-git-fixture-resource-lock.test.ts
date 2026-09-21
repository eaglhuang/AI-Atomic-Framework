import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8')) as {
  validators: Array<{ name: string; resourceLocks?: string[] }>;
};

const validators = new Map(config.validators.map((validator) => [validator.name, validator]));
const governanceCommands = validators.get('validate-governance-commands');
const gitHooks = validators.get('validate-git-hooks-enforcement');

assert.ok(governanceCommands, 'validate-governance-commands must remain registered');
assert.ok(gitHooks, 'validate-git-hooks-enforcement must remain registered');
assert.ok(
  governanceCommands.resourceLocks?.includes('git-worktree'),
  'validate-governance-commands must serialize with other Git-worktree fixtures'
);
assert.ok(
  gitHooks.resourceLocks?.includes('git-worktree'),
  'validate-git-hooks-enforcement must retain the shared Git-worktree lock'
);

console.log('[validator-git-fixture-resource-lock] ok');
