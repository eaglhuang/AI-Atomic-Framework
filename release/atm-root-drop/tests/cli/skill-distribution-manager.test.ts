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
const canonicalCatalog = buildCanonicalSkillCatalog(snapshot);
const codexFiles = compileSkillTemplatesForAdapter('codex', snapshot.templates, { repositoryRoot: root });
const projectedCatalog: ProjectedSkillCatalog = {
  schemaId: 'atm.projectedSkillCatalog.v1',
  adapterId: 'codex',
  sourceDigest: canonicalCatalog.sourceDigest,
  entries: canonicalCatalog.entries,
  files: codexFiles.map((file): SkillProjectionFile => ({
    skillId: file.skillId ?? file.relativePath.split('/')[0] ?? 'unknown',
    relativePath: file.relativePath,
    content: file.content,
    fileFormat: file.fileFormat ?? 'skill',
    sourceDigest: file.sourceDigest ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    managed: true
  }))
};

const profile = getSkillInstallProfile('adopter-bootstrap');
const plan = resolveSkillInstallationPlan({
  sourceCatalog: projectedCatalog,
  installProfile: profile,
  adapterCapabilities: {
    adapterId: 'codex',
    fileFormats: ['skill', 'markdown'],
    supportsCompanionFiles: true,
    supportsCharterInjection: true
  },
  targetScope: 'adopter'
});

assert.equal(plan.schemaId, 'atm.skillInstallationPlan.v1');
assert.equal(plan.profileId, 'adopter-bootstrap');
assert.equal(plan.adapterId, 'codex');
assert.equal(plan.targetScope, 'adopter');
assert(plan.managedSkillIds.includes('atm-next'));
assert(plan.managedSkillIds.includes('atm-dispatch'));
assert(!plan.managedSkillIds.includes('atm-deep-module-refactor'));
assert(!plan.managedSkillIds.includes('atm-git-pathspec-emergency-commit'));
assert.equal(plan.additions.length, plan.managedSkillIds.length);
assert.equal(plan.updates.length, 0);
assert.equal(plan.collisions.length, 0);
assert.equal(plan.degradationFindings.length, 0);
assert.equal(plan.manifestMetadata.sourceCatalogDigest, projectedCatalog.sourceDigest);
assert.equal(plan.manifestMetadata.profileId, 'adopter-bootstrap');
assert.equal(plan.manifestMetadata.targetScope, 'adopter');

const firstExpectedFile = plan.additions[0];
assert(firstExpectedFile, 'expected at least one selected projection file');
const staleManagedPath = 'atm-old/SKILL.md';
const existingManifest = createInstallManifest({
  adapterId: 'codex',
  adapterVersion: '0.0.0',
  installedAt: new Date(0).toISOString(),
  targetDir: 'integrations/codex-skills',
  files: [
    createManifestFileRecord({
      path: firstExpectedFile.relativePath,
      content: `${firstExpectedFile.content}\nchanged`,
      source: 'template',
      fileFormat: firstExpectedFile.fileFormat
    }),
    createManifestFileRecord({
      path: staleManagedPath,
      content: 'stale managed file',
      source: 'template',
      fileFormat: 'skill'
    }),
    createManifestFileRecord({
      path: 'user-owned.md',
      content: 'keep me',
      source: 'copied',
      fileFormat: 'markdown'
    })
  ]
});

const reconcilePlan = resolveSkillInstallationPlan({
  sourceCatalog: projectedCatalog,
  installProfile: profile,
  adapterCapabilities: {
    adapterId: 'codex',
    fileFormats: ['skill', 'markdown'],
    supportsCompanionFiles: true,
    supportsCharterInjection: true
  },
  targetScope: 'adopter',
  existingManifest
});
assert(reconcilePlan.updates.some((file) => file.relativePath === firstExpectedFile.relativePath));
assert(reconcilePlan.staleManagedProjections.includes(staleManagedPath));
assert(reconcilePlan.preservedUserFiles.includes('user-owned.md'));

const failClosedPlan = resolveSkillInstallationPlan({
  sourceCatalog: projectedCatalog,
  installProfile: profile,
  adapterCapabilities: {
    adapterId: 'codex',
    fileFormats: ['markdown'],
    supportsCompanionFiles: true,
    supportsCharterInjection: false
  },
  targetScope: 'adopter'
});
assert(failClosedPlan.degradationFindings.length > 0, 'unsupported adapter formats must produce degradation findings');
assert(failClosedPlan.collisions.length > 0, 'missing required adapter capabilities must produce collisions');

console.log(JSON.stringify({
  marker: '[skill-distribution-manager.test] ok',
  managedSkillCount: plan.managedSkillIds.length,
  additionCount: plan.additions.length,
  staleManagedProjections: reconcilePlan.staleManagedProjections.length,
  preservedUserFiles: reconcilePlan.preservedUserFiles.length,
  degradationFindings: failClosedPlan.degradationFindings.length
}));
