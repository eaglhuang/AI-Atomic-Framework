import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectProjectionMetadataFindings,
  collectSkillCorpusDiscoveryFindings,
  collectSkillSourceUniverseFindings,
  compileSkillCorpus,
  evaluateInstalledProjectionParity,
  loadSkillCorpusSourceSnapshot,
  sealSkillSourceUniverse
} from '../../packages/integrations-core/src/compiler/skill-templates.ts';
import { compileSkillTemplatesForAdapter } from '../../packages/integrations-core/src/compiler/compile.ts';
import { buildSkillCorpusAudit, probeSkillSourceTracking } from '../../scripts/audit-skill-corpus.ts';

const root = process.cwd();
const canaryOrder = [
  'atm-governance-router',
  'atm-dispatch',
  'atm-task-card-authoring',
  'atm-plan-authoring',
  'atm-next',
  'atm-framework-temp-claim'
];

const templateDirectory = path.join(root, 'templates', 'skills');
const sourceUniverse = sealSkillSourceUniverse({
  templateDirectory,
  probe: probeSkillSourceTracking(templateDirectory)
});
assert.deepEqual(
  collectSkillSourceUniverseFindings(sourceUniverse).map((finding) => `${finding.trackingState}:${finding.sourcePath}`),
  [],
  'every formal source template in this repository must be version-controlled before the corpus may be sealed'
);
const snapshot = loadSkillCorpusSourceSnapshot(templateDirectory, { sourceUniverse });
assert.equal(snapshot.sourceUniverseSealed, true);
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
assert.equal(audit.sourceUniverse.sealed, true, 'the audit must seal the source universe it hands the compiler');
assert.deepEqual(audit.sourceUniverse.untrackedSourceTemplatePaths, []);
assert.deepEqual(audit.sourceUniverse.ignoredSourceTemplatePaths, []);
assert.equal(audit.sourceUniverse.universeDigest, sourceUniverse.universeDigest);
assert(
  snapshot.templates.some((template) => template.frontmatter.id === 'atm-diagnostic-loop'),
  'atm-diagnostic-loop is admitted as a formal tracked source template'
);
assert.deepEqual(
  audit.installedProjectionParity.failClosed,
  [],
  'no installed copy may sit outside the four finite dispositions'
);
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

// ── TASK-SKL-0038 sealed source universe and projection parity ─────────────
//
// The seal stage is the only place Git tracking state may be consulted. Every
// case below hands that state to the compiler as sealed data, so none of these
// fixtures depend on the tracking state of the workstation running them.

const universeFixtureFiles = {
  'first.skill.md': canonicalFixtureFrontmatter('atm-fixture-first', 'framework-full, role-oriented'),
  'second.skill.md': canonicalFixtureFrontmatter('atm-fixture-second', 'framework-full')
};

// caseId: skill_source_universe_untracked_fail_closed_0038
// An untracked formal source template is a hard finding with an executable
// recovery, never an advisory the corpus can be green alongside.
withFixtureCorpus(universeFixtureFiles, (directory) => {
  const universe = sealSkillSourceUniverse({
    templateDirectory: directory,
    probe: { trackedPaths: ['first.skill.md'], ignoredPaths: [] }
  });
  const findings = collectSkillSourceUniverseFindings(universe);
  assert.equal(findings.length, 1, 'exactly the untracked formal source must be reported');
  assert.equal(findings[0].trackingState, 'untracked');
  assert(findings[0].sourcePath.endsWith('second.skill.md'));
  assert(findings[0].recovery.includes('git add'), 'recovery must be an executable tracking command');

  assert.throws(
    () => compileSkillCorpus({
      sourceSnapshot: loadSkillCorpusSourceSnapshot(directory, { sourceUniverse: universe }),
      adapterDescriptor: {
        adapterId: 'claude-code',
        diagnostics: [],
        project: ({ templates }) => compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root })
      }
    }),
    /source universe/i,
    'projection must fail closed while a formal source template is untracked'
  );
});

// caseId: skill_source_universe_ignored_fail_closed_0038
// An ignored formal source template fails closed the same way, and the
// recovery must never be to force-add it past the ignore rule.
withFixtureCorpus(universeFixtureFiles, (directory) => {
  const universe = sealSkillSourceUniverse({
    templateDirectory: directory,
    probe: { trackedPaths: ['first.skill.md'], ignoredPaths: ['second.skill.md'] }
  });
  const findings = collectSkillSourceUniverseFindings(universe);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].trackingState, 'ignored');
  assert(!/-f\b|--force/.test(findings[0].recovery), 'recovery must not tell the author to force-add an ignored source');
  assert(
    findings[0].recovery.includes('.gitignore') || findings[0].recovery.includes('exclude'),
    'ignored recovery must name the ignore rule to remove'
  );
});

// caseId: skill_sealed_projection_valid_0038
// A fully tracked sealed universe compiles, and the projection carries every
// parity field the adapter verification depends on.
withFixtureCorpus(universeFixtureFiles, (directory) => {
  const universe = sealSkillSourceUniverse({
    templateDirectory: directory,
    probe: { trackedPaths: ['first.skill.md', 'second.skill.md'], ignoredPaths: [] }
  });
  assert.deepEqual(collectSkillSourceUniverseFindings(universe), []);
  assert(universe.universeDigest.startsWith('sha256:'));

  const sealedSnapshot = loadSkillCorpusSourceSnapshot(directory, { sourceUniverse: universe });
  assert.equal(sealedSnapshot.sourceUniverseSealed, true);
  assert.equal(sealedSnapshot.sourceUniverseDigest, universe.universeDigest);
  assert.deepEqual(sealedSnapshot.untrackedSourceTemplatePaths, []);
  assert.deepEqual(sealedSnapshot.ignoredSourceTemplatePaths, []);

  const sealedProjection = compileSkillCorpus({
    sourceSnapshot: sealedSnapshot,
    adapterDescriptor: {
      adapterId: 'claude-code',
      diagnostics: [],
      project: ({ templates }) => compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root })
    }
  });
  assert.equal(sealedProjection.sourceDigest, sealedSnapshot.sourceDigest);
  assert.equal(sealedProjection.sourceUniverseDigest, universe.universeDigest);
  assert.equal(sealedProjection.compilerVersion, sealedSnapshot.compilerVersion);
  assert(sealedProjection.manifestDigest.startsWith('sha256:'));
  assert.deepEqual(sealedProjection.degradationDiagnostics, []);

  // caseId: skill_projection_metadata_stale_fail_closed_0038
  // A projection whose recorded provenance no longer matches the snapshot it
  // claims to come from is stale, and must be reported rather than trusted.
  const staleFindings = collectProjectionMetadataFindings(
    { ...sealedProjection, sourceDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
    sealedSnapshot
  );
  assert.equal(staleFindings.length, 1, 'a stale source digest must be reported exactly once');
  assert.equal(staleFindings[0].field, 'sourceDigest');
  assert.deepEqual(collectProjectionMetadataFindings(sealedProjection, sealedSnapshot), []);

  // caseId: skill_projection_manifest_digest_mismatch_0038
  // A declared manifest digest that does not describe the compiled files is a
  // compile-time failure, not a value the projection may simply republish.
  assert.throws(
    () => compileSkillCorpus({
      sourceSnapshot: sealedSnapshot,
      adapterDescriptor: {
        adapterId: 'claude-code',
        diagnostics: [],
        manifestDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        project: ({ templates }) => compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root })
      }
    }),
    /manifest digest/i,
    'a declared manifest digest that does not match the compiled files must fail closed'
  );
});

// caseId: skill_installed_copy_drift_disposition_0038
// Installed copies are derived artifacts. Parity compares them against the
// compiled projection, and every mismatch resolves to exactly one of the four
// finite dispositions.
{
  const compiledProjectionFiles = [
    { relativePath: 'atm-fixture-first/SKILL.md', content: 'compiled first\n' },
    { relativePath: 'atm-fixture-second/SKILL.md', content: 'compiled second\n' },
    { relativePath: 'atm-fixture-third/SKILL.md', content: 'compiled third\n' },
    { relativePath: 'atm-fixture-fourth/SKILL.md', content: 'compiled fourth\n' }
  ];
  const installedContentById: Record<string, string> = {
    'atm-fixture-first': 'compiled first\n',
    'atm-fixture-second': 'locally edited second\n',
    'atm-fixture-third': 'locally edited third\n',
    'atm-fixture-fourth': 'approved baseline fourth\n'
  };
  const parity = evaluateInstalledProjectionParity({
    compiledProjectionFiles,
    installedSkillRoot: '.agents/skills',
    dispositions: [
      {
        templateId: 'atm-fixture-third',
        disposition: 'explicit-waiver',
        reason: 'fixture waiver',
        owningTaskId: 'TASK-SKL-0038'
      },
      {
        templateId: 'atm-fixture-fourth',
        disposition: 'approved-baseline',
        reason: 'fixture baseline',
        owningTaskId: 'TASK-SKL-0038',
        expectedInstalledDigest: createHash('sha256').update('approved baseline fourth\n').digest('hex')
      }
    ],
    fileExists: () => true,
    readFile: (filePath) => installedContentById[filePath.replace(/\\/g, '/').split('/').at(-2) as string] ?? ''
  });

  const byId = new Map(parity.findings.map((finding) => [finding.templateId, finding]));
  assert.equal(byId.get('atm-fixture-first')?.disposition, 'sync', 'a matching installed copy is in sync');
  assert.equal(byId.get('atm-fixture-second')?.disposition, 'fail-closed', 'undeclared installed drift must fail closed');
  assert.equal(byId.get('atm-fixture-third')?.disposition, 'explicit-waiver', 'declared drift resolves to its waiver');
  assert.equal(byId.get('atm-fixture-third')?.owningTaskId, 'TASK-SKL-0038');
  assert.equal(byId.get('atm-fixture-fourth')?.disposition, 'approved-baseline', 'digest-pinned drift resolves to its baseline');
  assert.deepEqual(
    parity.failClosed.map((finding) => finding.templateId),
    ['atm-fixture-second'],
    'only undeclared drift may reach the fail-closed set'
  );

  // A baseline is finite because it pins bytes: once the installed copy moves
  // off the pinned digest the baseline stops covering it and parity fails
  // closed again, forcing a fresh decision instead of an endless advisory.
  const movedBaseline = evaluateInstalledProjectionParity({
    compiledProjectionFiles: [{ relativePath: 'atm-fixture-fourth/SKILL.md', content: 'compiled fourth\n' }],
    installedSkillRoot: '.agents/skills',
    dispositions: [
      {
        templateId: 'atm-fixture-fourth',
        disposition: 'approved-baseline',
        reason: 'fixture baseline',
        owningTaskId: 'TASK-SKL-0038',
        expectedInstalledDigest: createHash('sha256').update('approved baseline fourth\n').digest('hex')
      }
    ],
    fileExists: () => true,
    readFile: () => 'baseline moved on\n'
  });
  assert.deepEqual(
    movedBaseline.failClosed.map((finding) => finding.templateId),
    ['atm-fixture-fourth'],
    'an installed copy that left its pinned baseline must fail closed'
  );
  for (const disposition of parity.findings.map((finding) => finding.disposition)) {
    assert(
      ['sync', 'approved-baseline', 'explicit-waiver', 'fail-closed'].includes(disposition),
      `disposition must stay inside the finite set: ${disposition}`
    );
  }
}

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
