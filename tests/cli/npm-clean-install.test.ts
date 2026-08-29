import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const validator = path.join(root, 'scripts', 'validate-npm-clean-install.ts');
const releaseWorkflow = path.join(root, '.github', 'workflows', 'release-npm.yml');
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'package-skeleton.fixture.json'), 'utf8')) as {
  packages: { name: string; directory: string; publishFiles?: string[] }[];
};

assert.ok(existsSync(validator), 'clean-install validator must exist');
for (const packageSpec of fixture.packages) {
  const expectedFiles = packageSpec.publishFiles ?? ['dist'];
  const directory = packageSpec.directory;
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.files, expectedFiles, `${directory} must publish only its runtime allowlist`);
}
for (const [directory, binName] of [
  ['packages/cli', 'atm'],
  ['packages/create-atm', 'create-atm']
] as const) {
  const manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
  assert.doesNotMatch(manifest.bin?.[binName] ?? '', /^\.\//, `${directory} bin must survive npm publish without auto-correction`);
}

const workflow = readFileSync(releaseWorkflow, 'utf8');
const publishLines = workflow.split(/\r?\n/).filter((line) => line.includes('npm publish'));
assert.ok(publishLines.length >= 2, 'release workflow must publish in both dry-run and release branches');
for (const line of publishLines) {
  assert.match(line, /--workspace "\$workspace"/, 'release workflow must publish one explicit workspace at a time');
  assert.match(line, /--include-workspace-root=false/, 'release workflow must not publish the private repository root');
}
assert.match(workflow, /PUBLIC_WORKSPACES=\(/, 'release workflow must declare the explicit public workspace closure');
assert.match(workflow, /for workspace in "\$\{PUBLIC_WORKSPACES\[@\]\}"; do/, 'release workflow must iterate the explicit public workspace closure');
assert.match(workflow, /npm view "\$workspace@\$release_version" version --json/, 'release workflow must skip versions already published during a recovery rerun');
assert.doesNotMatch(workflow, /npm publish --workspaces/, 'release workflow must not publish example workspaces');
for (const packageSpec of fixture.packages) {
  assert.ok(workflow.includes(`"${packageSpec.name}"`), `release workflow must include ${packageSpec.name}`);
}

console.log('[npm-clean-install:test] ok');
