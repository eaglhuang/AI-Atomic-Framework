import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCliNpmRuntime } from '../../scripts/build-cli-npm-runtime.ts';
import { withPrivateCliNpmPackage } from '../../scripts/lib/private-cli-npm-package.ts';

const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-output-'));
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}
try {
  const cli = path.join(fixture, 'packages/cli');
  const dist = path.join(cli, 'dist');
  mkdirSync(dist, { recursive: true });
  mkdirSync(path.join(cli, 'src'), { recursive: true });
  const metadata = JSON.stringify({ name: 'atm-fixture', version: '1.0.0', type: 'module', files: ['dist/npm-runtime'],
    atmArtifactBudget: { schemaId: 'atm.cliArtifactBudget.v1', budget: { maxPackedBytes: 100000, maxPackedEntries: 100, maxInstalledPathChars: 180 } } }) + '\n';
  writeFileSync(path.join(cli, 'package.json'), metadata);
  writeFileSync(path.join(cli, 'README.md'), 'Fixture package\n');
  writeFileSync(path.join(dist, 'index.js'), 'export const marker = true;\n');
  writeFileSync(path.join(dist, 'atm-public.js'), 'export const publicCliCommandNames = ["next"]; export const runPublicCli = () => 0;\n');
  writeFileSync(path.join(dist, 'asset.json'), '{"retained":true}\n');
  writeFileSync(path.join(cli, 'src/asset.json'), '{"retained":true}\n');
  mkdirSync(path.join(fixture, 'templates'), { recursive: true });
  writeFileSync(path.join(fixture, 'templates/atom.spec.template.json'), '{}\n');
  writeFileSync(path.join(fixture, 'templates/atom.test.template.ts'), '// fixture\n');
  mkdirSync(path.join(dist, 'templates'), { recursive: true });
  cpSync(path.join(fixture, 'templates/atom.spec.template.json'), path.join(dist, 'templates/atom.spec.template.json'));
  cpSync(path.join(fixture, 'templates/atom.test.template.ts'), path.join(dist, 'templates/atom.test.template.ts'));
  mkdirSync(path.join(dist, 'schemas'), { recursive: true });
  writeFileSync(path.join(dist, 'schemas/atomic-spec.schema.json'), '{}\n');
  const core = path.join(fixture, 'packages/core');
  mkdirSync(path.join(core, 'src/telemetry'), { recursive: true });
  writeFileSync(path.join(core, 'package.json'), '{"name":"atm-core-fixture","files":["dist"]}\n');
  writeFileSync(path.join(core, 'src/index.ts'), "export { freshDependency } from './telemetry/observed-coverage.ts';\n");
  writeFileSync(path.join(core, 'src/telemetry/observed-coverage.ts'), 'export const freshDependency = 42;\n');
  writeFileSync(path.join(cli, 'src/index.ts'), "export { freshDependency } from '../../core/src/index.ts'; export const marker = 'fresh-source';\n");
  writeFileSync(path.join(cli, 'src/atm-public.ts'), 'export const publicCliCommandNames = ["next"]; export const runPublicCli = () => 0;\n');
  mkdirSync(path.join(fixture, 'schemas'), { recursive: true });
  writeFileSync(path.join(fixture, 'schemas/fixture.schema.json'), '{"fresh":true}\n');
  writeFileSync(path.join(cli, 'src/schema-path.ts'), "export const schema = 'schemas/fixture.schema.json';\n");
  mkdirSync(path.join(dist, 'npm-runtime'), { recursive: true });
  writeFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'existing canonical output\n');
  writeFileSync(path.join(dist, 'npm-runtime/manifest.json'), '{"old":true}\n');
  const skillRelativeRoot = '_vendor/integrations-core/templates/skills';
  const authoredSkills = fileURLToPath(new URL('../../templates/skills/', import.meta.url));
  const skillFiles: string[] = [];
  for (const entry of readdirSync(authoredSkills)) {
    if (!entry.endsWith('.skill.md')) continue;
    const auxiliary = entry.replace(/\.skill\.md$/, '.files');
    if (!existsSync(path.join(authoredSkills, auxiliary))) continue;
    for (const file of [path.join(authoredSkills, entry), ...filesUnder(path.join(authoredSkills, auxiliary))]) {
      const relative = path.relative(authoredSkills, file).replace(/\\/g, '/');
      const target = path.join(dist, skillRelativeRoot, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(file, target);
      skillFiles.push(`${skillRelativeRoot}/${relative}`);
    }
  }
  assert(skillFiles.length > 0, 'fixture must exercise authored shipped Skill assets');
  const legacyAsset = '_vendor/agent-pack-claude-code/templates/legacy.md';
  mkdirSync(path.dirname(path.join(dist, legacyAsset)), { recursive: true });
  writeFileSync(path.join(dist, legacyAsset), 'duplicate legacy pack\n');
  const outputs = ['private-a', 'private-b'].map(name => path.join(fixture, name, 'packages/cli/dist/npm-runtime'));
  const manifests = await Promise.all(outputs.map(outputRoot => buildCliNpmRuntime({ repositoryRoot: fixture, outputRoot })));
  assert.deepEqual(manifests[0], manifests[1]);
  assert.equal(readFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'utf8'), 'existing canonical output\n');
  assert.equal(existsSync(path.join(dist, '.npm-runtime-entry.mjs')), false);
  for (const output of outputs) {
    assert.equal((await import(pathToFileURL(path.join(output, 'runtime.mjs')).href)).marker, true);
    assert.equal(readFileSync(path.join(output, 'data/asset.json'), 'utf8'), '{"retained":true}\n');
    assert.equal(existsSync(path.join(output, 'data/npm-runtime/runtime.mjs')), false);
    assert.equal(existsSync(path.join(output, 'data/npm-runtime/manifest.json')), false);
    assert.equal(existsSync(path.join(output, 'data', legacyAsset)), false, 'non-shipped legacy pack must remain excluded');
    const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.layoutRoot, 'data');
    assert.equal(manifest.moduleIdentity, 'original-dist-relative-url');
    for (const file of skillFiles) {
      const assetPath = `data/${file}`;
      assert(existsSync(path.join(output, assetPath)), `shipped Skill reference closure is missing ${assetPath}`);
      const bytes = readFileSync(path.join(dist, file));
      assert.deepEqual(readFileSync(path.join(output, assetPath)), bytes);
      const entry = manifest.files.find((candidate: { path: string }) => candidate.path === assetPath);
      assert.equal(entry?.kind, 'immutable-runtime-asset');
      assert.equal(entry?.bytes, bytes.length);
      assert.equal(entry?.sha256, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    }
  }
  const packedSkillRoot = path.resolve(outputs[0], '../..');
  writeFileSync(path.join(packedSkillRoot, 'package.json'), metadata);
  const packedSkillArgs = ['pack', '--dry-run', '--ignore-scripts', '--json', '--loglevel', 'silent'];
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const packedSkill = JSON.parse(execFileSync(process.platform === 'win32' ? process.execPath : 'npm',
    process.platform === 'win32' ? [npmCli, ...packedSkillArgs] : packedSkillArgs,
    { cwd: packedSkillRoot, encoding: 'utf8', windowsHide: true }))[0];
  const packedSkillPaths = new Set(packedSkill.files.map((entry: { path: string }) => entry.path));
  for (const file of skillFiles) assert(packedSkillPaths.has(`dist/npm-runtime/data/${file}`));
  assert(!packedSkillPaths.has(`dist/npm-runtime/data/${legacyAsset}`));
  // Exercise the shipped-content validator, including self-consistent corrupted
  // asset/manifest bytes: matching a manifest is not enough to match the source.
  const validationRoot = path.resolve(packedSkillRoot, '../..');
  const validator = path.join(validationRoot, 'scripts/validate-adopter-artifact-manifest.ts');
  mkdirSync(path.dirname(validator), { recursive: true });
  cpSync(fileURLToPath(new URL('../../scripts/validate-adopter-artifact-manifest.ts', import.meta.url)), validator);
  cpSync(authoredSkills, path.join(validationRoot, 'templates/skills'), { recursive: true });
  const validate = () => execFileSync(process.execPath, ['--strip-types', validator], { encoding: 'utf8', stdio: 'pipe' });
  const validation = JSON.parse(validate());
  assert.equal(validation.skillCompanionFiles, skillFiles.filter(file => file.includes('.files/')).length);
  const companionPath = `data/${skillFiles.find(file => file.includes('.files/'))!}`;
  const companionFile = path.join(outputs[0], companionPath);
  const originalCompanion = readFileSync(companionFile);
  const manifestFile = path.join(outputs[0], 'manifest.json');
  const originalManifest = readFileSync(manifestFile);
  rmSync(companionFile);
  assert.throws(validate, /missing a shipped Skill companion/);
  writeFileSync(companionFile, 'corrupted reference\n');
  const corruptedManifest = JSON.parse(originalManifest.toString('utf8'));
  const entry = corruptedManifest.files.find((file: { path: string }) => file.path === companionPath);
  entry.bytes = Buffer.byteLength('corrupted reference\n');
  entry.sha256 = `sha256:${createHash('sha256').update('corrupted reference\n').digest('hex')}`;
  writeFileSync(manifestFile, JSON.stringify(corruptedManifest));
  assert.throws(validate, /Skill companion differs from its source or manifest/);
  writeFileSync(companionFile, originalCompanion);
  writeFileSync(manifestFile, originalManifest);
  assert.equal(JSON.parse(validate()).ok, true);
  await assert.rejects(buildCliNpmRuntime({ repositoryRoot: fixture, outputRoot: dist }), /must not overlap/);
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
  let retainedPath = '';
  await assert.rejects(withPrivateCliNpmPackage(fixture, async packageRoot => {
    retainedPath = packageRoot;
    assert.equal(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'), metadata);
    assert.equal(readFileSync(path.join(packageRoot, 'README.md'), 'utf8'), 'Fixture package\n');
    assert(existsSync(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')));
    const runtime = await import(pathToFileURL(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')).href);
    assert.equal(runtime.marker, 'fresh-source');
    assert.equal(runtime.freshDependency, 42);
    assert.equal(readFileSync(path.join(packageRoot, 'dist/npm-runtime/data/schemas/fixture.schema.json'), 'utf8'), '{"fresh":true}\n');
    throw new Error('consumer failure');
  }), /consumer failure/);
  assert.equal(existsSync(retainedPath), false);
  await withPrivateCliNpmPackage(fixture, async packageRoot => {
    retainedPath = packageRoot;
    const packArgs = ['pack', '--ignore-scripts', '--json', '--loglevel', 'silent'];
    const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const packed = JSON.parse(execFileSync(process.platform === 'win32' ? process.execPath : 'npm',
      process.platform === 'win32' ? [npmCli, ...packArgs] : packArgs,
      { cwd: packageRoot, encoding: 'utf8', windowsHide: true }));
    const packedPaths = packed[0].files.map((entry: { path: string }) => entry.path);
    assert(packedPaths.includes('package.json'));
    assert(packedPaths.includes('README.md'));
    assert(packedPaths.includes('dist/npm-runtime/runtime.mjs'));
    assert(packedPaths.includes('dist/npm-runtime/data/asset.json'));
    assert(!packedPaths.some((name: string) => name.includes('data/npm-runtime/')));
  });
  assert.equal(existsSync(retainedPath), false);
  assert.equal(readFileSync(path.join(dist, 'npm-runtime/runtime.mjs'), 'utf8'), 'existing canonical output\n');
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
  assert.equal(existsSync(path.join(core, 'dist')), false);
  const parallelPaths = await Promise.all([0, 1].map(() => withPrivateCliNpmPackage(fixture, async packageRoot => {
    assert.equal((await import(pathToFileURL(path.join(packageRoot, 'dist/npm-runtime/runtime.mjs')).href)).freshDependency, 42);
    return packageRoot;
  })));
  assert.notEqual(parallelPaths[0], parallelPaths[1]);
  assert(parallelPaths.every(packageRoot => !existsSync(packageRoot)));
  assert.throws(() => execFileSync(process.execPath, ['--strip-types', path.resolve('scripts/build-package-dist.ts'),
    '--repository-root', fixture, '--output-root', fixture], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }), /must not overlap/);
  assert.equal(readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export const marker = true;\n');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('[cli-npm-runtime-output-isolation] ok');
