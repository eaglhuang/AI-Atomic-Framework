import assert from 'node:assert/strict';
import path from 'node:path';
import {
  compileSkillTemplatesForAdapter,
  createCodexSkillsAdapter,
  loadMinimumAtmSkillTemplates,
  loadSkillCorpusSourceSnapshot,
  loadSkillTemplatesForProfile
} from '../../packages/integrations-core/src/index.ts';

const root = process.cwd();
const snapshot = loadSkillCorpusSourceSnapshot(path.join(root, 'templates', 'skills'));
const entryTemplates = loadSkillTemplatesForProfile('adopter-bootstrap', path.join(root, 'templates', 'skills'));
const minimumTemplates = loadMinimumAtmSkillTemplates(path.join(root, 'templates', 'skills'));
const frameworkTemplates = loadSkillTemplatesForProfile('framework-full', path.join(root, 'templates', 'skills'));
const roleTemplates = loadSkillTemplatesForProfile('role-oriented', path.join(root, 'templates', 'skills'));
const emergencyTemplates = loadSkillTemplatesForProfile('emergency-explicit', path.join(root, 'templates', 'skills'));

assert.deepEqual(
  minimumTemplates.map((template) => template.frontmatter.id),
  entryTemplates.map((template) => template.frontmatter.id),
  'minimum entry loader must be a data-driven adopter-bootstrap profile projection'
);
assert(entryTemplates.length < frameworkTemplates.length, 'framework-full profile must include more than the adopter entry set');
assert(frameworkTemplates.some((template) => template.frontmatter.id === 'atm-deep-module-refactor'));
assert(frameworkTemplates.some((template) => template.frontmatter.id === 'atm-git-pathspec-emergency-commit'));
assert(roleTemplates.some((template) => template.frontmatter.id === 'atm-deep-module-refactor'));
assert(!roleTemplates.some((template) => template.frontmatter.id === 'atm-git-pathspec-emergency-commit'));
assert.deepEqual(emergencyTemplates.map((template) => template.frontmatter.id), ['atm-git-pathspec-emergency-commit']);

for (const template of snapshot.templates) {
  assert(template.frontmatter.owner, `${template.frontmatter.id} must declare owner`);
  assert(['entry', 'specialist', 'emergency'].includes(template.frontmatter.tier));
  assert(template.frontmatter.installProfiles.length > 0);
  assert(template.frontmatter.adapterCapabilityRequirements.some((requirement) => requirement.requires.includes('charter-injection')));
}

const frameworkCodexFiles = compileSkillTemplatesForAdapter('codex', undefined, { repositoryRoot: root });
const adopterCodexFiles = compileSkillTemplatesForAdapter('codex', entryTemplates, { repositoryRoot: root });
assert(frameworkCodexFiles.length > adopterCodexFiles.length, 'framework repo default compiler must use the full corpus');

const adapter = createCodexSkillsAdapter(frameworkCodexFiles);
const dryRun = await adapter.install({
  repositoryRoot: root,
  dryRun: true,
  actor: 'integration-profile-parity-test',
  now: new Date(0).toISOString()
});
assert.equal(dryRun.ok, true);
assert.equal(dryRun.manifest.metadata?.sourceCatalogDigest, frameworkCodexFiles[0]?.sourceCatalogDigest);
assert.equal(dryRun.manifest.metadata?.installProfileId, 'framework-full');
assert.equal(dryRun.manifest.metadata?.managedSkillCount, frameworkTemplates.length);
assert(String(dryRun.manifest.metadata?.managedSkillIds).includes('atm-next'));
assert(String(dryRun.manifest.metadata?.managedSkillIds).includes('atm-deep-module-refactor'));
assert.equal(dryRun.manifest.metadata?.adapterFormat, 'skill');

console.log(JSON.stringify({
  marker: '[integration-profile-parity.test] ok',
  sourceTemplateCount: snapshot.templateCount,
  entryCount: entryTemplates.length,
  frameworkCount: frameworkTemplates.length,
  roleCount: roleTemplates.length,
  emergencyCount: emergencyTemplates.length,
  manifestMetadata: dryRun.manifest.metadata
}));
