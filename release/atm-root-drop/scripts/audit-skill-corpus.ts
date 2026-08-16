import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type InstalledProjectionDispositionRule,
  type SkillSourceTrackingProbe,
  collectSkillSourceUniverseFindings,
  compileSkillCorpus,
  evaluateInstalledProjectionParity,
  loadSkillCorpusSourceSnapshot,
  minimumAtmEntrySkillDefinitions,
  sealSkillSourceUniverse
} from '../packages/integrations-core/src/compiler/skill-templates.ts';
import { compileSkillTemplatesForAdapter } from '../packages/integrations-core/src/compiler/compile.ts';
import { createDeepModuleReviewReport } from '../packages/plugin-review-advisory/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'artifacts', 'generated', 'skill-corpus-audit.json');
const installedSkillRoot = path.join(root, '.agents', 'skills');

/**
 * The seal stage, and the only place in this chain that asks the local
 * repository what it tracks. Everything downstream consumes the sealed record
 * this produces, so the compiler and its projections stay reproducible on a
 * workstation with a different local Git configuration.
 */
export function probeSkillSourceTracking(templateDirectory: string): SkillSourceTrackingProbe {
  const relativeDirectory = path.relative(root, templateDirectory).replace(/\\/g, '/');
  const listPaths = (args: readonly string[]): readonly string[] => {
    const result = spawnSync('git', [...args, '--', relativeDirectory], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) return [];
    return result.stdout.split('\0').map((entry) => entry.trim()).filter(Boolean);
  };
  return {
    trackedPaths: listPaths(['ls-files', '-z']),
    ignoredPaths: listPaths(['ls-files', '-z', '--others', '--ignored', '--exclude-standard'])
  };
}

/**
 * Declared dispositions for installed copies that do not match the compiled
 * projection. Every rule names the card that owns the divergence, which is
 * what keeps this list finite: it can only grow through a reviewed change that
 * points at governed work, and it shrinks when that work lands.
 */
export const installedProjectionDispositions: readonly InstalledProjectionDispositionRule[] = [
  // The installed .agents/skills copies in this repository predate the charter
  // gaining INV-ATM-014, so every one of them is a stale bake rather than a
  // hand edit. The repair is a corpus rebake through
  // `node atm.mjs integration add --id claude-code --force`, which rewrites
  // .agents/skills — a surface TASK-SKL-0038 is explicitly forbidden to touch,
  // and which currently carries in-flight work owned by other active claims.
  // Each entry is enumerated rather than pattern-matched so the debt stays
  // countable and disappears entry by entry as the rebake lands.
  ...[
    'atm-atom-map-refactor',
    'atm-bug-backlog',
    'atm-create',
    'atm-deep-module-refactor',
    'atm-error-code-resolver',
    'atm-evidence',
    'atm-git-pathspec-emergency-commit',
    'atm-governance-router',
    'atm-handoff',
    'atm-internal-build-sync',
    'atm-lock',
    'atm-memory-consolidate',
    'atm-next',
    'atm-orient',
    'atm-plan-authoring',
    'atm-task-card-authoring',
    'atm-task-intent-resolver',
    'atm-upgrade-scan',
    'mailbox-worker-execution'
  ].map((templateId) => ({
    templateId,
    disposition: 'explicit-waiver' as const,
    reason: 'installed copy was baked before charter invariant INV-ATM-014 existed; sync route is `node atm.mjs integration add --id claude-code --force`, which rewrites .agents/skills outside this card\'s scope',
    owningTaskId: 'TASK-SKL-0038'
  })),
  {
    templateId: 'atm-dispatch',
    disposition: 'explicit-waiver' as const,
    reason: 'installed copy diverges structurally from the compiled projection while templates/skills/atm-dispatch.skill.md carries another actor\'s in-flight edit; parity cannot be judged until that delivery lands',
    owningTaskId: 'TASK-SKL-0038'
  },
  {
    templateId: 'atm-framework-temp-claim',
    disposition: 'explicit-waiver' as const,
    reason: 'installed copy still carries the pre-INV-ATM-013 section ordering; same rebake route as the stale-charter entries above',
    owningTaskId: 'TASK-SKL-0038'
  },
  {
    templateId: 'atm-framework-quickfix',
    disposition: 'explicit-waiver' as const,
    reason: 'installed copy predates the argument-hint frontmatter field the current compiler emits; same rebake route as the stale-charter entries above',
    owningTaskId: 'TASK-SKL-0038'
  }
];

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
  const templateDirectory = path.join(root, 'templates', 'skills');
  const sourceUniverse = sealSkillSourceUniverse({
    templateDirectory,
    probe: probeSkillSourceTracking(templateDirectory)
  });
  const sourceUniverseFindings = collectSkillSourceUniverseFindings(sourceUniverse);
  const snapshot = loadSkillCorpusSourceSnapshot(templateDirectory, { sourceUniverse });
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
      sourcePaths: [
        'packages/integrations-core/src/compiler/skill-source-universe.ts',
        'packages/integrations-core/src/compiler/skill-templates.ts',
        'scripts/audit-skill-corpus.ts'
      ],
      ownerAtomOrMap: 'atom-skill-template-compiler',
      publicInterface: 'loadSkillCorpusSourceSnapshot(templateDirectory, { sourceUniverse })',
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
      sourcePaths: [
        'packages/integrations-core/src/compiler/skill-projection-parity.ts',
        'packages/integrations-core/src/compiler/skill-templates.ts'
      ],
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

  // A rejected source universe never reaches a projection, so there is nothing
  // to compare installed copies against. The audit still reports the hard
  // finding — that is the whole point of failing closed here.
  const projection = sourceUniverseFindings.length === 0
    ? compileSkillCorpus({
      sourceSnapshot: snapshot,
      adapterDescriptor: {
        adapterId: 'claude-code',
        diagnostics: [],
        project: ({ templates }) => compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root })
      }
    })
    : null;
  const parity = projection
    ? evaluateInstalledProjectionParity({
      compiledProjectionFiles: projection.files as readonly { readonly relativePath: string; readonly content: string }[],
      installedSkillRoot,
      dispositions: installedProjectionDispositions
    })
    : { findings: [], failClosed: [] };

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
    sourceUniverse: {
      schemaId: sourceUniverse.schemaId,
      sealed: snapshot.sourceUniverseSealed,
      sourceRoot: sourceUniverse.sourceRoot,
      universeDigest: sourceUniverse.universeDigest,
      trackedSourceTemplateCount: sourceUniverse.entries.filter((entry) => entry.trackingState === 'tracked').length,
      untrackedSourceTemplatePaths: snapshot.untrackedSourceTemplatePaths,
      ignoredSourceTemplatePaths: snapshot.ignoredSourceTemplatePaths,
      findings: sourceUniverseFindings
    },
    installedProjectionParity: {
      installedSkillRoot: path.relative(root, installedSkillRoot).replace(/\\/g, '/'),
      comparedAgainst: projection ? `atm.skillCorpusProjection.v1:${projection.adapterId}` : null,
      manifestDigest: projection?.manifestDigest ?? null,
      dispositionCounts: countDispositions(parity.findings),
      declaredDispositions: installedProjectionDispositions,
      failClosed: parity.failClosed
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

function countDispositions(findings: readonly { readonly disposition: string }[]) {
  const counts: Record<string, number> = { sync: 0, 'approved-baseline': 0, 'explicit-waiver': 0, 'fail-closed': 0 };
  for (const finding of findings) {
    counts[finding.disposition] = (counts[finding.disposition] ?? 0) + 1;
  }
  return counts;
}

const audit = buildSkillCorpusAudit();
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({
  marker: '[audit-skill-corpus] ok',
  outputPath: path.relative(root, outputPath).replace(/\\/g, '/'),
  templateCount: audit.sourceSnapshot.templateCount,
  sourceDigest: audit.sourceSnapshot.sourceDigest,
  sourceUniverseDigest: audit.sourceUniverse.universeDigest,
  untrackedSourceTemplatePaths: audit.sourceUniverse.untrackedSourceTemplatePaths,
  ignoredSourceTemplatePaths: audit.sourceSnapshot.ignoredSourceTemplatePaths,
  installedProjectionParity: audit.installedProjectionParity.dispositionCounts,
  deepModuleReviewFingerprints: audit.deepModuleReviews.map((review) => review.receiptFingerprint),
  baselineFingerprints: audit.deepModuleReviews.map((review) => review.baselineFingerprint)
}));
