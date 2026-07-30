import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyEditorGlobalOverlayPlan,
  createEditorGlobalOverlayPlan,
  createManifestFileRecord,
  getSkillInstallProfile,
  type EditorGlobalSkillManifest,
  type FederatedSkillCatalog
} from '../../packages/integrations-core/src/index.ts';

const tempHome = mkdtempSync(path.join(os.tmpdir(), 'atm-skl-0032-overlay-'));
const targetDir = path.join(tempHome, '.codex', 'skills');
mkdirSync(path.join(targetDir, 'external-helper'), { recursive: true });
mkdirSync(path.join(targetDir, 'safe-helper'), { recursive: true });
writeFileSync(path.join(targetDir, 'external-helper', 'SKILL.md'), 'human managed this first');
writeFileSync(path.join(targetDir, 'safe-helper', 'SKILL.md'), 'old managed content');

const safeFile = {
  skillId: 'safe-helper',
  relativePath: 'safe-helper/SKILL.md',
  content: 'new managed content',
  fileFormat: 'skill' as const,
  sourceDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' as const,
  managed: true as const
};
const unmanagedCollisionFile = {
  skillId: 'external-helper',
  relativePath: 'external-helper/SKILL.md',
  content: 'external helper content',
  fileFormat: 'skill' as const,
  sourceDigest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222' as const,
  managed: true as const
};
const federatedCatalog: FederatedSkillCatalog = {
  schemaId: 'atm.federatedSkillCatalog.v1',
  specVersion: '0.1.0',
  sourceDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  skippedInvalidSources: [{ sourceId: 'broken-source', relativePath: null, reason: 'no SKILL.md files found' }],
  decisions: [],
  projectedCatalog: {
    schemaId: 'atm.projectedSkillCatalog.v1',
    adapterId: 'codex',
    sourceDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    entries: [
      catalogEntry('external-helper'),
      catalogEntry('safe-helper')
    ],
    files: [unmanagedCollisionFile, safeFile]
  }
};
const oldManagedRecord = createManifestFileRecord({
  path: '.codex/skills/safe-helper/SKILL.md',
  content: 'old managed content',
  source: 'generated',
  fileFormat: 'skill'
});
const staleManagedRecord = createManifestFileRecord({
  path: '.codex/skills/stale-helper/SKILL.md',
  content: 'stale managed content',
  source: 'generated',
  fileFormat: 'skill'
});
const existingManifest: EditorGlobalSkillManifest = {
  schemaId: 'atm.editorGlobalSkillManifest.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
  adapterId: 'codex',
  overlayProfileId: 'framework-full',
  targetRootRef: 'temp-home',
  targetDir: '.codex/skills',
  generatedAt: new Date(0).toISOString(),
  sourceCatalogDigest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  planDigest: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  files: [
    {
      path: oldManagedRecord.path,
      sha256: oldManagedRecord.sha256,
      sizeBytes: oldManagedRecord.sizeBytes,
      sourceSkillId: 'safe-helper',
      sourceDigest: safeFile.sourceDigest,
      fileFormat: 'skill'
    },
    {
      path: staleManagedRecord.path,
      sha256: staleManagedRecord.sha256,
      sizeBytes: staleManagedRecord.sizeBytes,
      sourceSkillId: 'stale-helper',
      sourceDigest: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as const,
      fileFormat: 'skill'
    }
  ]
};

const plan = createEditorGlobalOverlayPlan({
  adapterId: 'codex',
  targetRoot: tempHome,
  targetRootRef: 'temp-home',
  federatedCatalog,
  installProfile: getSkillInstallProfile('framework-full'),
  targetScope: 'framework',
  existingManifest,
  now: new Date(0).toISOString()
});

assert.equal(plan.schemaId, 'atm.editorGlobalOverlayPlan.v1');
assert(plan.additions.every((operation) => operation.path !== '.codex/skills/external-helper/SKILL.md'), 'unmanaged existing file must not be overwritten as an addition');
assert(plan.preservedUnmanagedFiles.includes('.codex/skills/external-helper/SKILL.md'));
assert(plan.collisions.some((collision) => collision.includes('preserved unmanaged editor file')));
assert(plan.updates.some((operation) => operation.path === '.codex/skills/safe-helper/SKILL.md'));
assert(plan.staleManagedFiles.includes('.codex/skills/stale-helper/SKILL.md'));
assert(plan.skippedInvalidSources.some((skip) => skip.sourceId === 'broken-source'));
assert.equal(plan.okToApply, true, 'preserve-style collisions should not block safe managed updates');

const applyResult = applyEditorGlobalOverlayPlan({
  plan,
  targetRoot: tempHome,
  expectedPlanDigest: plan.planDigest
});
assert.equal(applyResult.ok, true);
assert(applyResult.writtenFiles.includes('.codex/skills/safe-helper/SKILL.md'));
assert.equal(readFileSync(path.join(targetDir, 'external-helper', 'SKILL.md'), 'utf8'), 'human managed this first');
assert.equal(readFileSync(path.join(targetDir, 'safe-helper', 'SKILL.md'), 'utf8'), 'new managed content');
assert(readFileSync(path.join(tempHome, '.codex', 'skill-overlays', 'atm-managed-skills.json'), 'utf8').includes('"schemaId": "atm.editorGlobalSkillManifest.v1"'));

assert.throws(() => applyEditorGlobalOverlayPlan({
  plan,
  targetRoot: tempHome,
  expectedPlanDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
}), /overlay plan digest mismatch/);

console.log(JSON.stringify({
  marker: '[editor-global-overlay-collision.test] ok',
  updates: plan.updates.length,
  preserved: plan.preservedUnmanagedFiles,
  stale: plan.staleManagedFiles
}));

function catalogEntry(id: string) {
  return {
    id,
    title: id,
    summary: id,
    command: id,
    firstCommand: '',
    owner: 'fixture',
    tier: 'specialist' as const,
    installProfiles: ['framework-full' as const],
    invocationPolicy: 'explicit-user' as const,
    companionFiles: [],
    adapterCapabilityRequirements: [],
    sourcePath: `fixture/${id}/SKILL.md`,
    sourceDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
  };
}
