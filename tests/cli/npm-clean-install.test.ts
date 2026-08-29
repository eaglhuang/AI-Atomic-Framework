import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const validator = path.join(root, 'scripts', 'validate-npm-clean-install.ts');
const releaseWorkflow = path.join(root, '.github', 'workflows', 'release-npm.yml');
const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'package-skeleton.fixture.json'), 'utf8')) as {
  packages: { name: string; directory: string; publishFiles?: string[] }[];
  publishClosure?: { publishedPackages?: string[] };
};
const publishedPackages = fixture.publishClosure?.publishedPackages ?? [];

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

// The npm product is a single self-contained CLI tarball. The publish closure
// is the one authority for what may reach npm, and the workflow must neither
// omit a member of it nor list a workspace outside it.
assert.equal(publishedPackages.length, 1, 'the fixture must declare exactly one published package');
assert.deepEqual(publishedPackages, ['@ai-atomic-framework/cli']);
for (const packageName of publishedPackages) {
  assert.ok(workflow.includes(`"${packageName}"`), `release workflow must include ${packageName}`);
}
for (const packageSpec of fixture.packages) {
  if (publishedPackages.includes(packageSpec.name)) continue;
  assert.doesNotMatch(
    workflow,
    new RegExp(`^\\s*"${packageSpec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*$`, 'm'),
    `${packageSpec.name} is outside the publish closure and must not be listed for publish`
  );
}

// A clean isolated install is only a release gate if the release actually runs
// it before publishing, so the workflow wiring is asserted, not assumed.
const smokeIndex = workflow.indexOf('scripts/validate-npm-clean-install.ts');
const publishIndex = workflow.indexOf('Publish public workspace closure');
assert.ok(smokeIndex > -1, 'release workflow must run the clean-install smoke validator');
assert.ok(publishIndex > -1, 'release workflow must retain the publish step');
assert.ok(smokeIndex < publishIndex, 'the clean-install smoke must gate publish, not follow it');

const validatorSource = readFileSync(validator, 'utf8');
assert.match(validatorSource, /integration', 'add', 'codex'/, 'the clean-install validator must exercise a real installed integration');
assert.match(validatorSource, /REQUIRED_ROUTER_REFERENCE/, 'the clean-install validator must guard router companion files');

console.log('[npm-clean-install:test] ok');
