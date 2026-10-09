import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = path.join(root, 'packages', 'cli');
const runtimeRoot = path.join(cliRoot, 'dist', 'npm-runtime');
const packageJson = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) as Record<string, any>;
const budget = packageJson.atmArtifactBudget;

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

function fail(message: string): never {
  throw new Error(`[adopter-artifact-manifest] ${message}`);
}

const expectedPublishFiles = ['dist/npm-runtime'];
if (JSON.stringify(packageJson.files) !== JSON.stringify(expectedPublishFiles)) {
  fail(`CLI npm manifest must publish only ${expectedPublishFiles.join(', ')}.`);
}
if (!budget || budget.schemaId !== 'atm.cliArtifactBudget.v1') {
  fail('CLI package must declare atm.cliArtifactBudget.v1.');
}
const files = filesUnder(runtimeRoot);
if (files.length === 0) fail('CLI npm runtime is missing; build packages before validating the artifact.');
const relative = files.map((file) => path.relative(runtimeRoot, file).replace(/\\/g, '/'));
const forbidden = relative.filter((file) => /(^|\/)__tests__(\/|$)|\.test\.[cm]?[jt]s$|(^|\/)(fixtures)(\/|$)/.test(file));
if (forbidden.length > 0) fail(`CLI dist contains forbidden adopter files: ${forbidden.slice(0, 8).join(', ')}`);
for (const required of ['atm.mjs', 'runtime.mjs', 'index.js', 'index.d.ts', 'manifest.json']) {
  if (!relative.includes(required)) fail(`CLI npm runtime is missing ${required}.`);
}
const manifest = JSON.parse(readFileSync(path.join(runtimeRoot, 'manifest.json'), 'utf8'));
const layoutRoot = manifest.layoutRoot ?? 'layout';
if (!['data', 'layout'].includes(layoutRoot)) fail('CLI npm runtime has an unsupported layout root.');
// Adoption templates are a runtime data asset: `atm init` walks up from the
// loaded module until it finds templates/root-drop, so inside the tarball that
// walk has to terminate in dist/. Compare against the authored template tree
// rather than a hand-listed subset, so a template added later cannot silently
// stay behind in the monorepo. This fails right after build, instead of waiting
// for the far more expensive isolated clean-install gate to notice.
const authoredTemplateRoot = path.join(root, 'templates', 'root-drop');
if (existsSync(authoredTemplateRoot)) {
  const bundledTemplates = new Set(
    relative
      .filter((file) => file.startsWith(`${layoutRoot}/templates/root-drop/`))
      .map((file) => file.slice(`${layoutRoot}/templates/root-drop/`.length))
  );
  const missingTemplates = filesUnder(authoredTemplateRoot)
    .map((file) => path.relative(authoredTemplateRoot, file).replace(/\\/g, '/'))
    .filter((file) => !bundledTemplates.has(file));
  if (missingTemplates.length > 0) {
    fail(`CLI dist is missing ${missingTemplates.length} adoption template file(s) that atm init needs after a clean install: ${missingTemplates.slice(0, 6).join(', ')}`);
  }
}
if (manifest.schemaId !== 'atm.cliNpmRuntimeManifest.v1' || manifest.moduleIdentity !== 'original-dist-relative-url') {
  fail('CLI npm runtime manifest must seal the bundled module-identity contract.');
}
const listedPaths = new Set((manifest.files ?? []).map((entry: any) => String(entry.path)));
const unlisted = relative.filter((file) => file !== 'manifest.json' && !listedPaths.has(file));
if (unlisted.length > 0) fail(`CLI npm runtime contains unlisted files: ${unlisted.slice(0, 8).join(', ')}`);
const unexplained = (manifest.files ?? []).filter((entry: any) => !['runtime-entrypoint', 'immutable-runtime-asset'].includes(entry.kind));
if (unexplained.length > 0) fail(`CLI npm runtime contains files without a runtime reason: ${unexplained.slice(0, 8).map((entry: any) => entry.path).join(', ')}`);
// A shipped Skill's companion tree is part of its runtime contract. Compare
// the authored inventory, not a hand-kept list of current reference filenames;
// only select Skills whose entry template is included in this distribution.
const skillAssetPrefix = `${layoutRoot}/_vendor/integrations-core/templates/skills/`;
const authoredSkillsRoot = path.join(root, 'templates/skills');
let skillCompanionFiles = 0;
if (existsSync(authoredSkillsRoot)) {
  for (const skill of readdirSync(authoredSkillsRoot).filter(file => file.endsWith('.skill.md'))) {
    if (!relative.includes(`${skillAssetPrefix}${skill}`)) continue;
    const companionDirectory = skill.replace(/\.skill\.md$/, '.files');
    for (const sourcePath of filesUnder(path.join(authoredSkillsRoot, companionDirectory))) {
      const assetPath = skillAssetPrefix + path.relative(authoredSkillsRoot, sourcePath).replace(/\\/g, '/');
      if (!relative.includes(assetPath)) fail(`CLI npm runtime is missing a shipped Skill companion: ${assetPath}.`);
      const bytes = readFileSync(sourcePath);
      const entry = (manifest.files ?? []).find((candidate: any) => candidate.path === assetPath);
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (!entry || entry.kind !== 'immutable-runtime-asset' || entry.bytes !== bytes.length || entry.sha256 !== digest
        || !readFileSync(path.join(runtimeRoot, assetPath)).equals(bytes)) {
        fail(`CLI npm runtime Skill companion differs from its source or manifest: ${assetPath}.`);
      }
      skillCompanionFiles += 1;
    }
  }
}
for (const assetPath of [
  `${layoutRoot}/templates/atom.spec.template.json`,
  `${layoutRoot}/templates/atom.test.template.ts`,
  `${layoutRoot}/schemas/atomic-spec.schema.json`
]) {
  const entry = (manifest.files ?? []).find((candidate: any) => candidate.path === assetPath);
  if (!entry || entry.kind !== 'immutable-runtime-asset') {
    fail(`CLI npm runtime manifest must classify ${assetPath} as an immutable runtime asset.`);
  }
  const bytes = readFileSync(path.join(runtimeRoot, assetPath));
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (entry.bytes !== bytes.length || entry.sha256 !== digest) {
    fail(`CLI npm runtime manifest hash or byte count does not match ${assetPath}.`);
  }
}

const artifactFlag = process.argv.indexOf('--artifact-manifest');
let packEntry: { unpackedSize?: number; entryCount?: number };
if (artifactFlag >= 0) {
  const { readReleaseManifest } = await import('./release-artifact-manifest.ts');
  const release = readReleaseManifest(path.resolve(process.argv[artifactFlag + 1]));
  const artifact = release.artifacts.find(entry => entry.name === '@ai-atomic-framework/cli');
  if (!artifact) fail('Sealed release does not contain the CLI');
  packEntry = artifact;
} else {
  const packed = spawnSync('npm', ['pack', '.', '--ignore-scripts', '--dry-run', '--json'], {
    cwd: cliRoot, encoding: 'utf8', shell: process.platform === 'win32'
  });
  if (packed.status !== 0) fail(`npm pack dry-run failed: ${packed.stderr || packed.stdout}`);
  packEntry = JSON.parse(packed.stdout)[0];
}
const bytes = Number(packEntry?.unpackedSize ?? 0);
const entries = Number(packEntry?.entryCount ?? 0);
const cap = budget.budget;
if (!cap || !Number.isInteger(cap.maxPackedEntries) || !Number.isInteger(cap.maxPackedBytes)) {
  fail('Artifact budget must provide integer byte and entry caps.');
}
if (entries > cap.maxPackedEntries || bytes > cap.maxPackedBytes) {
  fail(`CLI tarball exceeds original budget: ${entries}/${cap.maxPackedEntries} entries, ${bytes}/${cap.maxPackedBytes} bytes.`);
}
console.log(JSON.stringify({
  ok: true,
  schemaId: 'atm.adopterArtifactManifestValidation.v1',
  files: entries,
  bytes,
  caps: cap,
  forbiddenCount: forbidden.length,
  skillCompanionFiles
}, null, 2));
