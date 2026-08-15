import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectSkillCorpusDiscoveryFindings,
  compileSkillCorpus,
  loadSkillCorpusSourceSnapshot
} from '../../packages/integrations-core/src/compiler/skill-templates.ts';
import { compileSkillTemplatesForAdapter } from '../../packages/integrations-core/src/compiler/compile.ts';
import { buildSkillCorpusAudit } from '../../scripts/audit-skill-corpus.ts';

const root = process.cwd();
const canaryOrder = [
  'atm-governance-router',
  'atm-dispatch',
  'atm-task-card-authoring',
  'atm-plan-authoring',
  'atm-next',
  'atm-framework-temp-claim'
];

const snapshot = loadSkillCorpusSourceSnapshot(path.join(root, 'templates', 'skills'));
assert.equal(snapshot.schemaId, 'atm.skillCorpusSourceSnapshot.v1');
assert(snapshot.templateCount >= 21, 'corpus snapshot must include the complete source template corpus');
assert.equal(snapshot.templates.length, snapshot.sourceFiles.length);
assert(snapshot.sourceDigest.startsWith('sha256:'));

const ids = snapshot.templates.map((template) => template.frontmatter.id);
for (const canaryId of canaryOrder) {
  assert(ids.includes(canaryId), `missing canary template: ${canaryId}`);
}
assert.deepEqual(canaryOrder, [
  'atm-governance-router',
  'atm-dispatch',
  'atm-task-card-authoring',
  'atm-plan-authoring',
  'atm-next',
  'atm-framework-temp-claim'
]);

const projection = compileSkillCorpus({
  sourceSnapshot: snapshot,
  adapterDescriptor: {
    adapterId: 'codex',
    diagnostics: ['projection uses sealed source snapshot'],
    project: ({ templates }) => compileSkillTemplatesForAdapter('codex', templates, { repositoryRoot: root })
  }
});
assert.equal(projection.schemaId, 'atm.skillCorpusProjection.v1');
assert.equal(projection.adapterId, 'codex');
assert.equal(projection.sourceDigest, snapshot.sourceDigest);
assert.equal(projection.compilerVersion, snapshot.compilerVersion);
assert(projection.manifestDigest.startsWith('sha256:'));
assert.deepEqual(projection.degradationDiagnostics, ['projection uses sealed source snapshot']);
assert(projection.files.length >= snapshot.templateCount);

const audit = buildSkillCorpusAudit();
assert.equal(audit.schemaId, 'atm.skillCorpusAudit.v1');
assert.equal(audit.sourceSnapshot.templateCount, snapshot.templateCount);
assert.equal(audit.sourceSnapshot.sourceDigest, snapshot.sourceDigest);
assert.deepEqual(audit.canaryOrder, canaryOrder);
assert.equal(audit.ignoredTemplateRegression.incidentTaskId, 'TASK-SKL-0027');
assert.equal(audit.ignoredTemplateRegression.locked, true);
assert.deepEqual(
  audit.deepModuleReviews.map((review) => review.baselineFingerprint),
  ['deep-module-review:52470e9f', 'deep-module-review:52b3cbe6']
);
assert(audit.deepModuleReviews.every((review) => review.status === 'pass'));
assert.equal(audit.adapterProjectionContract.interface, 'compileSkillCorpus({ sourceSnapshot, adapterDescriptor })');
assert.deepEqual(audit.adapterProjectionContract.requiredFields, [
  'sourceDigest',
  'compilerVersion',
  'degradationDiagnostics',
  'manifestDigest'
]);

for (const canaryId of canaryOrder) {
  const templatePath = path.join(root, 'templates', 'skills', `${canaryId}.skill.md`);
  const source = readFileSync(templatePath, 'utf8');
  assert(source.includes('Cohesion-First Split Rule'), `${canaryId} missing cohesion-first split rule`);
  assert(source.includes('TASK-SKL-0020'), `${canaryId} missing TASK-SKL-0020 provenance`);
  assert(source.includes('TASK-SKL-0028'), `${canaryId} missing TASK-SKL-0028 provenance`);
}

for (const templatePath of snapshot.ignoredSourceTemplatePaths) {
  assert(
    templatePath.startsWith('templates/skills/') && templatePath.endsWith('.skill.md'),
    `ignored template path must be declared as a source template path: ${templatePath}`
  );
}

// ATM-GOV-0392 fixtures. Names are deliberately arbitrary: discovery must be
// decided by declared contract fields, never by a known skill id or filename.
const canonicalFixtureFrontmatter = (id: string, profiles: string) => [
  '---',
  'schemaId: atm.skillTemplate',
  'specVersion: 0.1.0',
  `id: ${id}`,
  `title: Fixture ${id}`,
  `summary: Fixture template for corpus discovery coverage.`,
  'command: node atm.mjs next --prompt "$ARGUMENTS" --json',
  'firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json',
  'charter-invariants-injected: true',
  'handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json',
  'owner: atm-framework',
  'tier: specialist',
  `installProfiles: [${profiles}]`,
  'invocationPolicy: model-or-user',
  'companionFiles: []',
  'adapterCapabilityRequirements:',
  '  - "*:charter-injection"',
  '---',
  '',
  '# {{title}}',
  '',
  '{{CHARTER_INVARIANTS}}',
  ''
].join('\n');

const derivedShapeFixture = [
  '---',
  'name: some-derived-looking-template',
  'description: Frontmatter copied from a built adapter artifact rather than the source contract.',
  'argument-hint: "<context>"',
  'charter-invariants-injected: true',
  '---',
  '',
  '# Some Derived Looking Template',
  ''
].join('\n');

function withFixtureCorpus<T>(files: Readonly<Record<string, string>>, run: (directory: string) => T): T {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'atm-gov-0392-'));
  try {
    for (const [fileName, content] of Object.entries(files)) {
      writeFileSync(path.join(directory, fileName), content, 'utf8');
    }
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// caseId: skill_template_source_discovery_fail_closed_0392
// A discovered source file that cannot become a corpus member must be reported,
// never dropped. Two distinct ways to fall out of every adapter are covered:
// frontmatter that does not declare the canonical contract at all, and a
// declared contract that names no install profile.
withFixtureCorpus({
  'first.skill.md': canonicalFixtureFrontmatter('atm-fixture-first', 'framework-full, role-oriented'),
  'second.skill.md': derivedShapeFixture,
  'third.skill.md': canonicalFixtureFrontmatter('atm-fixture-third', '')
}, (directory) => {
  const findings = collectSkillCorpusDiscoveryFindings(directory);
  const byFile = new Map(findings.map((finding) => [path.basename(finding.sourcePath), finding]));

  assert.equal(findings.length, 2, 'exactly the two undeliverable sources must be reported');
  assert.equal(byFile.has('first.skill.md'), false, 'a contract-satisfying source must produce no finding');

  const derived = byFile.get('second.skill.md');
  assert(derived, 'a source whose frontmatter is not the canonical contract must be reported');
  assert.equal(derived.reason, 'missing-contract-fields');
  for (const requiredField of ['schemaId', 'id', 'title', 'summary', 'tier', 'installProfiles']) {
    assert(
      derived.missingFields.includes(requiredField),
      `finding must name the missing contract field ${requiredField}`
    );
  }

  const profileless = byFile.get('third.skill.md');
  assert(profileless, 'a source belonging to no install profile must be reported');
  assert.equal(profileless.reason, 'no-install-profile');

  for (const finding of findings) {
    assert(finding.sourcePath.endsWith('.skill.md'), 'finding must name the discovered source path');
    assert(finding.recovery.length > 0, 'finding must state a recovery action the author can take');
  }
});

// caseId: skill_template_bake_source_parity_0392
// The corpus and the adapter bake must describe the same source set: a member
// that never reaches a profile cannot be certified green just because the
// projection and the installation are equally missing it.
withFixtureCorpus({
  'first.skill.md': canonicalFixtureFrontmatter('atm-fixture-first', 'framework-full, role-oriented'),
  'second.skill.md': canonicalFixtureFrontmatter('atm-fixture-second', 'framework-full')
}, (directory) => {
  const fixtureSnapshot = loadSkillCorpusSourceSnapshot(directory);
  const fixtureProjection = compileSkillCorpus({
    sourceSnapshot: fixtureSnapshot,
    adapterDescriptor: {
      adapterId: 'claude-code',
      diagnostics: [],
      project: ({ templates }) => compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root })
    }
  });
  const bakedIds = fixtureProjection.files
    .map((file) => file.relativePath.replace(/\\/g, '/').split('/')[0]);

  assert.deepEqual(collectSkillCorpusDiscoveryFindings(directory), [], 'a fully canonical corpus must report no findings');
  for (const template of fixtureSnapshot.templates) {
    assert(
      bakedIds.includes(template.frontmatter.id),
      `every discovered corpus member must bake to a derived skill: ${template.frontmatter.id}`
    );
  }
});

withFixtureCorpus({
  'first.skill.md': canonicalFixtureFrontmatter('atm-fixture-first', 'framework-full, role-oriented'),
  'second.skill.md': derivedShapeFixture
}, (directory) => {
  const partialSnapshot = loadSkillCorpusSourceSnapshot(directory);
  const partialProjection = compileSkillCorpus({
    sourceSnapshot: partialSnapshot,
    adapterDescriptor: {
      adapterId: 'claude-code',
      diagnostics: [],
      project: ({ templates }) => compileSkillTemplatesForAdapter(
        'claude-code',
        templates.filter((template) => Boolean(template.frontmatter.id)),
        { repositoryRoot: root }
      )
    }
  });
  const bakedCount = partialProjection.files
    .filter((file) => file.relativePath.replace(/\\/g, '/').endsWith('/SKILL.md')).length;

  assert.equal(partialSnapshot.templateCount, 2, 'the discovered source count stays complete');
  assert.equal(bakedCount, 1, 'the malformed source silently disappears from the bake');
  assert.equal(
    collectSkillCorpusDiscoveryFindings(directory).length,
    1,
    'that disappearance must surface as a discovery finding rather than as a matching count'
  );
});

const generatedPath = path.join(root, 'artifacts', 'generated', 'skill-corpus-audit.json');
if (existsSync(generatedPath)) {
  const generated = JSON.parse(readFileSync(generatedPath, 'utf8'));
  assert.equal(generated.schemaId, audit.schemaId);
  assert.equal(generated.sourceSnapshot.sourceDigest, audit.sourceSnapshot.sourceDigest);
}

console.log(JSON.stringify({
  marker: '[skill-corpus-canary-rewrite.test] ok',
  templateCount: snapshot.templateCount,
  sourceDigest: snapshot.sourceDigest,
  canaryOrder,
  projection: {
    adapterId: projection.adapterId,
    fileCount: projection.files.length,
    manifestDigest: projection.manifestDigest
  },
  ignoredSourceTemplatePaths: snapshot.ignoredSourceTemplatePaths
}));
