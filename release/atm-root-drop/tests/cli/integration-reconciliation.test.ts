import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildCanonicalSkillCatalog,
  compileSkillTemplatesForAdapter,
  createInstallManifest,
  createManifestFileRecord,
  getSkillInstallProfile,
  loadSkillCorpusSourceSnapshot,
  resolveSkillInstallationPlan,
  type ProjectedSkillCatalog,
  type SkillProjectionFile
} from '../../packages/integrations-core/src/index.ts';

const root = process.cwd();
const snapshot = loadSkillCorpusSourceSnapshot(path.join(root, 'templates', 'skills'));
const canonical = buildCanonicalSkillCatalog(snapshot);
const sourceFiles = compileSkillTemplatesForAdapter('codex', snapshot.templates, { repositoryRoot: root });
const projected: ProjectedSkillCatalog = {
  schemaId: 'atm.projectedSkillCatalog.v1',
  adapterId: 'codex',
  sourceDigest: canonical.sourceDigest,
  entries: canonical.entries,
  files: sourceFiles.map((file): SkillProjectionFile => ({
    skillId: file.skillId ?? file.relativePath.split('/')[0] ?? 'unknown',
    relativePath: file.relativePath,
    content: file.content,
    fileFormat: file.fileFormat ?? 'skill',
    sourceDigest: file.sourceDigest ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    managed: true
  }))
};

const profile = getSkillInstallProfile('framework-full');
const expectedPaths = new Set(projected.files.map((file) => file.relativePath));
assert(expectedPaths.has('atm-next/SKILL.md'));

const manifest = createInstallManifest({
  adapterId: 'codex',
  adapterVersion: '0.0.0',
  installedAt: new Date(0).toISOString(),
  targetDir: 'integrations/codex-skills',
  files: [
    createManifestFileRecord({
      path: 'atm-next/SKILL.md',
      content: 'local user changed managed projection',
      source: 'template',
      fileFormat: 'skill'
    }),
    createManifestFileRecord({
      path: 'obsolete-managed/SKILL.md',
      content: 'old managed projection',
      source: 'generated',
      fileFormat: 'skill'
    }),
    createManifestFileRecord({
      path: 'notes/user-owned.md',
      content: 'human file',
      source: 'copied',
      fileFormat: 'markdown'
    })
  ],
  metadata: {
    sourceCatalogDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    installProfileId: 'framework-full',
    managedSkillIds: 'atm-next,obsolete-managed'
  }
});

const plan = resolveSkillInstallationPlan({
  sourceCatalog: projected,
  installProfile: profile,
  adapterCapabilities: {
    adapterId: 'codex',
    fileFormats: ['skill', 'markdown'],
    supportsCompanionFiles: true,
    supportsCharterInjection: true
  },
  targetScope: 'framework',
  existingManifest: manifest
});

assert(plan.updates.some((file) => file.relativePath === 'atm-next/SKILL.md'), 'changed managed projection must be planned as an update');
assert(plan.staleManagedProjections.includes('obsolete-managed/SKILL.md'), 'stale managed projection must be reported');
assert(plan.preservedUserFiles.includes('notes/user-owned.md'), 'unmanaged/copied user file must be preserved');
assert(!plan.staleManagedProjections.includes('notes/user-owned.md'), 'user file must not be classified as stale managed');
assert.equal(plan.collisions.length, 0);
assert.equal(plan.degradationFindings.length, 0);

console.log(JSON.stringify({
  marker: '[integration-reconciliation.test] ok',
  updates: plan.updates.length,
  staleManagedProjections: plan.staleManagedProjections,
  preservedUserFiles: plan.preservedUserFiles
}));
