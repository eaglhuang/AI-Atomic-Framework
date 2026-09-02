import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRunnerSourceSeal, listReleaseSourceFiles } from '../../scripts/build-root-drop-release.ts';
import { inspectRunnerSourceDrift } from '../../packages/cli/src/commands/framework-development/closure-packet-schema.ts';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-root-drop-source-list-'));

try {
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'ATM Test']);
  git(repo, ['config', 'user.email', 'atm-test@example.invalid']);

  const existing = path.join(repo, 'packages', 'cli', 'dist', 'atm.js');
  const stale = path.join(repo, 'packages', 'cli', 'dist', 'commands', '__tests__', 'stale.spec.d.ts');
  mkdirSync(path.dirname(existing), { recursive: true });
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(existing, 'export const atm = true;\n', 'utf8');
  writeFileSync(stale, 'export {};\n', 'utf8');
  git(repo, ['add', 'packages/cli/dist/atm.js', 'packages/cli/dist/commands/__tests__/stale.spec.d.ts']);
  unlinkSync(stale);

  assert.equal(existsSync(stale), false, 'fixture stale declaration must be absent from worktree');
  const files = listReleaseSourceFiles(repo);

  assert.ok(files.includes('packages/cli/dist/atm.js'), 'existing tracked release source should remain included');
  assert.equal(
    files.includes('packages/cli/dist/commands/__tests__/stale.spec.d.ts'),
    false,
    'missing tracked generated output must not be copied into root-drop release'
  );

  const scopeManifest = path.join(repo, 'scripts', 'AtmCore', 'runner-build-scope.json');
  const cliSource = path.join(repo, 'packages', 'cli', 'src', 'atm.ts');
  mkdirSync(path.dirname(scopeManifest), { recursive: true });
  mkdirSync(path.dirname(cliSource), { recursive: true });
  writeFileSync(scopeManifest, `${JSON.stringify({
    schemaId: 'atm.runnerBuildScope.v1',
    specVersion: '0.1.0',
    policy: { mode: 'test', generatedArtifactWriter: 'test', sourceAgentRule: 'test' },
    runnerAffectingSourceRoots: ['packages/cli/src/', 'scripts/AtmCore/'],
    buildChainScripts: [],
    buildConfigPaths: [],
    rootLaunchers: [],
    schemaRoots: [],
    generatedArtifacts: ['packages/cli/dist/'],
    nonCorePlanningUtilities: []
  })}\n`, 'utf8');
  writeFileSync(cliSource, 'export const source = true;\n', 'utf8');
  git(repo, ['add', 'packages/cli/src/atm.ts', 'scripts/AtmCore/runner-build-scope.json']);
  git(repo, ['commit', '-m', 'seal inputs']);
  const seal = buildRunnerSourceSeal(repo, [
    'packages/cli/src/atm.ts',
    'scripts/AtmCore/runner-build-scope.json'
  ]);
  assert.equal(seal.schemaId, 'atm.runnerSourceSeal.v1');
  assert.deepEqual(seal.files, ['packages/cli/src/atm.ts', 'scripts/AtmCore/runner-build-scope.json']);
  assert.match(seal.digest, /^sha256:[a-f0-9]{64}$/);
  const expectedHash = createHash('sha256');
  const blobIds = new Map(
    git(repo, ['ls-files', '-s'])
      .split(/\r?\n/)
      .map((line) => line.match(/^\d+\s+([0-9a-f]+)\s+\d+\t(.+)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[2], match[1]] as const)
  );
  for (const relativePath of seal.files) {
    const content = readFileSync(path.join(repo, relativePath));
    expectedHash.update(String(Buffer.byteLength(relativePath))).update(':').update(relativePath);
    const blobId = blobIds.get(relativePath);
    if (blobId) expectedHash.update('git:').update(blobId);
    else expectedHash.update(String(content.byteLength)).update(':').update(content);
  }
  assert.equal(seal.digest, `sha256:${expectedHash.digest('hex')}`, 'seal must use the same clean-Git/blob fallback digest that the frozen runner verifies');
  const rootDropManifest = path.join(repo, 'release', 'atm-root-drop', 'release-manifest.json');
  const frozenRunner = path.join(repo, 'release', 'atm-onefile', 'atm.mjs');
  mkdirSync(path.dirname(rootDropManifest), { recursive: true });
  mkdirSync(path.dirname(frozenRunner), { recursive: true });
  writeFileSync(rootDropManifest, `${JSON.stringify({ runnerSourceSeal: seal })}\n`, 'utf8');
  writeFileSync(frozenRunner, '#!/usr/bin/env node\n', 'utf8');
  const drift = inspectRunnerSourceDrift(repo);
  assert.equal(drift.sourceSeal.present, true, 'drift inspection must discover the root-drop release manifest');
  assert.equal(drift.sourceSeal.valid, true, 'a fresh root-drop source seal must validate against the same source bytes');

  console.log('ok: root-drop release source list excludes stale tracked generated outputs');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
