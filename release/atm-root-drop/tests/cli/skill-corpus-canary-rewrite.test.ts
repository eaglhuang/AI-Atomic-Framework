import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
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
