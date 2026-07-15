import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'packages/cli/src/commands/git-governance.ts',
  'packages/cli/src/commands/git-governance/implementation.ts',
  'packages/cli/src/commands/git-governance/commit-bundle-filter.ts',
  'packages/cli/src/commands/git-governance/commit-scope-policy.ts',
  'packages/cli/src/commands/git-governance/governance-residue-policy.ts',
  'packages/cli/src/commands/git-governance/validate-atom-file-size.ts'
];

for (const file of files) {
  const absolute = path.join(root, file);
  assert.equal(existsSync(absolute), true, `${file} should exist`);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/).filter((line) => line.length > 0).length;
  assert.ok(lines <= 600, `${file} should stay at or below 600 non-empty lines; got ${lines}`);
}

const facade = readFileSync(path.join(root, 'packages/cli/src/commands/git-governance.ts'), 'utf8');
assert.match(facade, /from '\.\/git-governance\/implementation\.ts'/);
assert.match(facade, /runAtmGit/);
assert.match(facade, /resolveTaskScopedCommitBundle/);

const atomMap = JSON.parse(readFileSync(path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'), 'utf8'));
const mappings = Array.isArray(atomMap.mappings) ? atomMap.mappings : [];
const mappedPaths = new Set(mappings.map((entry: { path_pattern?: unknown }) => String(entry.path_pattern ?? '')));
assert.ok(mappedPaths.has('packages/cli/src/commands/git-governance.ts'), 'facade should remain mapped in owner-shard-cli');
assert.ok(mappedPaths.has('packages/cli/src/commands/git-governance/implementation.ts'), 'implementation should be mapped in owner-shard-cli');
