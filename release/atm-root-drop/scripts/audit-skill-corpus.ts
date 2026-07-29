import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSkillCorpusSourceSnapshot,
  minimumAtmEntrySkillDefinitions
} from '../packages/integrations-core/src/compiler/skill-templates.ts';
import { createDeepModuleReviewReport } from '../packages/plugin-review-advisory/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'artifacts', 'generated', 'skill-corpus-audit.json');

const canaryOrder = [
  'atm-governance-router',
  'atm-dispatch',
  'atm-task-card-authoring',
  'atm-plan-authoring',
  'atm-next',
  'atm-framework-temp-claim'
] as const;
const canaryIds = new Set<string>(canaryOrder);

const classificationById = new Map<string, string>([
  ['atm-governance-router', 'rewrite-canary'],
  ['atm-dispatch', 'rewrite-canary'],
  ['atm-task-card-authoring', 'rewrite-canary'],
  ['atm-plan-authoring', 'rewrite-canary'],
  ['atm-next', 'rewrite-canary'],
  ['atm-framework-temp-claim', 'rewrite-canary'],
  ['atm-deep-module-refactor', 'provider-reference'],
  ['atm-git-pathspec-emergency-commit', 'emergency-specialist'],
  ['atm-minimal-patch-rebuilder', 'specialist'],
  ['atm-task-intent-resolver', 'entry-support']
]);

export function buildSkillCorpusAudit() {
  const snapshot = loadSkillCorpusSourceSnapshot(path.join(root, 'templates', 'skills'));
  const minimumIds = new Set<string>(minimumAtmEntrySkillDefinitions.map((entry) => entry.id));
  const classifications = snapshot.templates.map((template) => ({
    id: template.frontmatter.id,
    sourcePath: template.sourcePath,
    sourceDigest: snapshot.sourceFiles.find((file) => file.id === template.frontmatter.id)?.sourceDigest,
    class: classificationById.get(template.frontmatter.id) ?? (minimumIds.has(template.frontmatter.id) ? 'minimum-entry' : 'specialist'),
    action: canaryIds.has(template.frontmatter.id) ? 'canary-rewritten' : 'keep',
    progressiveDisclosure: template.body.includes('references/') || template.body.includes('.files/')
  }));

  const sourceSnapshotReview = createDeepModuleReviewReport({
    taskId: 'TASK-SKL-0028',
    candidate: {
      moduleId: 'skill-corpus-source-snapshot',
      sourcePaths: ['packages/integrations-core/src/compiler/skill-templates.ts', 'scripts/audit-skill-corpus.ts'],
      ownerAtomOrMap: 'atom-skill-template-compiler',
      publicInterface: 'loadSkillCorpusSourceSnapshot(templateDirectory)',
      rollback: 'revert TASK-SKL-0028 corpus snapshot and audit changes',
      causalValidators: [
        'node --strip-types tests/cli/skill-corpus-canary-rewrite.test.ts',
        'npm run validate:skill-templates'
      ]
    },
    observedFriction: {
      triggers: ['duplicated-policy', 'caller-complexity', 'missing-test-seam'],
      evidenceRefs: ['TASK-SKL-0027.closure-packet', 'TASK-SKL-0028.preflight']
    },
    dependencyClasses: ['in-process', 'local-substitutable'],
    proposedAdapters: ['filesystem-template-corpus', 'in-memory-test-corpus']
  });

  const projectionReview = createDeepModuleReviewReport({
    taskId: 'TASK-SKL-0028',
    candidate: {
      moduleId: 'skill-corpus-projection',
      sourcePaths: ['packages/integrations-core/src/compiler/skill-templates.ts'],
      ownerAtomOrMap: 'atom-skill-template-compiler',
      publicInterface: 'compileSkillCorpus({ sourceSnapshot, adapterDescriptor })',
      rollback: 'revert TASK-SKL-0028 projection wrapper changes',
      causalValidators: [
        'node --strip-types tests/cli/skill-corpus-canary-rewrite.test.ts',
        'npm run typecheck'
      ]
    },
    observedFriction: {
      triggers: ['shotgun-changes', 'duplicated-policy', 'missing-test-seam'],
      evidenceRefs: ['TASK-SKL-0027.ignored-template-incident', 'TASK-SKL-0028.preflight']
    },
    dependencyClasses: ['in-process', 'local-substitutable'],
    proposedAdapters: ['codex-skill-projection', 'claude-skill-projection']
  });

  const closurePacketPath = path.join(root, '.atm', 'history', 'evidence', 'TASK-SKL-0027.closure-packet.json');
  const closurePacket = JSON.parse(readFileSync(closurePacketPath, 'utf8'));

  return {
    schemaId: 'atm.skillCorpusAudit.v1',
    specVersion: '0.1.0',
    taskId: 'TASK-SKL-0028',
    generatedAt: new Date(0).toISOString(),
    sourceSnapshot: {
      schemaId: snapshot.schemaId,
      compilerVersion: snapshot.compilerVersion,
      templateCount: snapshot.templateCount,
      sourceDigest: snapshot.sourceDigest,
      ignoredSourceTemplatePaths: snapshot.ignoredSourceTemplatePaths
    },
    canaryOrder,
    classifications,
    ignoredTemplateRegression: {
      incidentTaskId: 'TASK-SKL-0027',
      sourceCommit: closurePacket.targetCommit,
      locked: true,
      verdict: snapshot.ignoredSourceTemplatePaths.length === 0
        ? 'no-current-local-ignore-for-skill-templates'
        : 'local-ignore-declared'
    },
    deepModuleReviews: [
      {
        ...sourceSnapshotReview,
        baselineLabel: 'source-snapshot-boundary',
        baselineFingerprint: 'deep-module-review:52470e9f'
      },
      {
        ...projectionReview,
        baselineLabel: 'projection-boundary',
        baselineFingerprint: 'deep-module-review:52b3cbe6'
      }
    ],
    adapterProjectionContract: {
      interface: 'compileSkillCorpus({ sourceSnapshot, adapterDescriptor })',
      sourceAuthority: 'sealed corpus source snapshot',
      requiredFields: ['sourceDigest', 'compilerVersion', 'degradationDiagnostics', 'manifestDigest']
    }
  };
}

const audit = buildSkillCorpusAudit();
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({
  marker: '[audit-skill-corpus] ok',
  outputPath: path.relative(root, outputPath).replace(/\\/g, '/'),
  templateCount: audit.sourceSnapshot.templateCount,
  sourceDigest: audit.sourceSnapshot.sourceDigest,
  ignoredSourceTemplatePaths: audit.sourceSnapshot.ignoredSourceTemplatePaths,
  deepModuleReviewFingerprints: audit.deepModuleReviews.map((review) => review.receiptFingerprint),
  baselineFingerprints: audit.deepModuleReviews.map((review) => review.baselineFingerprint)
}));
