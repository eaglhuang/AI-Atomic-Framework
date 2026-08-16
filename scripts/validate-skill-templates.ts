import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredTemplateIds = [
  'atm-next',
  'atm-task-intent-resolver',
  'atm-orient',
  'atm-governance-router',
  'atm-dispatch',
  'atm-create',
  'atm-lock',
  'atm-evidence',
  'atm-error-code-resolver',
  'atm-plan-authoring',
  'atm-upgrade-scan',
  'atm-handoff',
  'mailbox-worker-execution',
  'atm-internal-build-sync',
  'atm-framework-temp-claim',
  'atm-atom-map-refactor',
  'atm-bug-backlog',
  'atm-memory-consolidate'
];

const requiredTeamAgentsTermsByTemplate: Record<string, readonly string[]> = {
  'atm-dispatch': [
    'L1 through L5',
    '--team-size L1..L5',
    '--role-provider role=provider:model[:sdk][:mode]',
    'team start --execute',
    'decisionClass',
    'requiresHumanSignoff',
    'broker-conflict-blocked',
    'team.required: true'
  ],
  'atm-next': [
    'teamLevel',
    '--team-size L1..L5',
    'team start --execute',
    'decisionClass',
    'runtimeTier',
    'atm.teamProviderRunArtifact.v1',
    'atm.reviewAgentSignature.v1',
    'knowledge.query',
    'broker-conflict-blocked'
  ],
  'atm-governance-router': [
    'teamLevel',
    'runtimeTier',
    'decisionClass',
    'requiresAdr',
    'team start --execute',
    '--role-provider role=provider:model[:sdk][:mode]',
    'broker-conflict-blocked'
  ],
  'atm-task-card-authoring': [
    'team.required',
    'teamLevel',
    'roleProviders',
    'runtimeTier',
    'reviewerIndependencePolicy',
    'knowledge.query',
    'broker.conflict.blocked',
    'atm.teamProviderRunArtifact.v1',
    'atm.reviewAgentSignature.v1'
  ],
  'atm-evidence': [
    'atm.teamProviderRunArtifact.v1',
    'atm.reviewAgentSignature.v1',
    'atm.teamAgentObservabilityEvent.v1',
    'knowledge.query',
    'knowledge.index.write',
    'review.signature.write',
    'broker-conflict-blocked'
  ],
  'mailbox-worker-execution': [
    'team start --execute',
    'L1 through L5',
    'task.lifecycle',
    'git.write',
    'broker-conflict-blocked',
    'atm.teamProviderRunArtifact.v1',
    'knowledge.query'
  ]
};

const requiredGovernanceFlowTermsByTemplate: Record<string, readonly string[]> = {
  'atm-governance-router': [
    'Governance Flow Backwrite',
    'opening data-driven',
    'consumed sealed summaries',
    'missing data',
    'assumption changes',
    'stop rule',
    'shared-write gate',
    'INV-ATM-008',
    'INV-ATM-009',
    'duration/timing',
    'compact digest',
    'unavailable receipts',
    'frozen-entry smoke'
  ],
  'atm-next': [
    'Governed Card Opening And Close Checks',
    'consumed sealed summaries',
    'shared-write gate',
    'INV-ATM-008',
    'duration/timing',
    'compact digest',
    'frozen-entry smoke'
  ],
  'atm-dispatch': [
    'Captain Governance Flow Checklist',
    'consumed sealed summaries',
    'shared-write gate',
    'INV-ATM-008',
    'duration/timing',
    'compact digest'
  ],
  'atm-handoff': [
    'Governance Flow Summary',
    'consumed sealed summaries',
    'INV-ATM-008',
    'duration/timing',
    'compact digest',
    'frozen-entry smoke'
  ],
  'atm-evidence': [
    'Governance Evidence Checklist',
    'consumed sealed summaries',
    'INV-ATM-008',
    'duration/timing',
    'compact digest',
    'unavailable receipts'
  ]
};

function fail(message: string) {
  console.error(`[skill-templates:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function hasForbiddenPlanningHint(content: string): boolean {
  return /spec-kit|MRP|\/specify|\/plan\b|(?:^|\s)\/tasks\b/i.test(content);
}

function isPrimaryCompiledEntry(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return normalizedPath === 'GEMINI.md'
    || normalizedPath.endsWith('/SKILL.md')
    || normalizedPath.endsWith('.instructions.md')
    || normalizedPath.endsWith('.prompt.md')
    || normalizedPath.endsWith('.toml');
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

const packageModule = await import(pathToFileURL(path.join(root, 'packages/integrations-core/src/index.ts')).href);
const auditModule = await import(pathToFileURL(path.join(root, 'scripts/audit-skill-corpus.ts')).href);
const schemaPath = 'templates/skills/skill.schema.json';
assert(existsSync(path.join(root, schemaPath)), `missing skill template schema: ${schemaPath}`);

for (const templateId of requiredTemplateIds) {
  assert(existsSync(path.join(root, 'templates', 'skills', `${templateId}.skill.md`)), `missing skill template: ${templateId}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = readJson(schemaPath);
assert(ajv.validateSchema(schema) === true, `skill template schema is invalid: ${formatErrors(ajv.errors)}`);
const validateFrontmatter = ajv.compile(schema);
const skillTemplateDirectory = path.join(root, 'templates', 'skills');
const templates = packageModule.loadMinimumAtmSkillTemplates(skillTemplateDirectory);

// Seal the source universe once, here, from the audit stage's Git probe. Every
// later step reasons about that sealed record, so nothing below re-asks the
// local repository what it tracks, ignores, or excludes.
const sourceUniverse = packageModule.sealSkillSourceUniverse({
  templateDirectory: skillTemplateDirectory,
  probe: auditModule.probeSkillSourceTracking(skillTemplateDirectory)
});
for (const finding of packageModule.collectSkillSourceUniverseFindings(sourceUniverse)) {
  fail(`${finding.trackingState} formal source template ${finding.sourcePath}: ${finding.recovery}`);
}

const corpusSnapshot = packageModule.loadSkillCorpusSourceSnapshot(skillTemplateDirectory, { sourceUniverse });
const renderedCharter = packageModule.renderCharterInvariantsBlock(root);
assert(templates.length === requiredTemplateIds.length, 'minimum ATM skill template count mismatch');
assert(corpusSnapshot.templateCount >= templates.length, 'full skill corpus must include at least every minimum entry template');
assert(corpusSnapshot.sourceDigest.startsWith('sha256:'), 'full skill corpus snapshot must carry a source digest');
assert(corpusSnapshot.sourceUniverseSealed === true, 'full skill corpus snapshot must consume a sealed source universe');
assert(corpusSnapshot.sourceUniverseDigest === sourceUniverse.universeDigest, 'corpus snapshot must carry the sealed universe digest');
assert(Array.isArray(corpusSnapshot.untrackedSourceTemplatePaths), 'full skill corpus snapshot must report untracked source template paths');
assert(Array.isArray(corpusSnapshot.ignoredSourceTemplatePaths), 'full skill corpus snapshot must report ignored source template paths');
assert(renderedCharter.fallbackReason === null, 'validator fixture repo must have readable charter invariants');
assert(renderedCharter.text.includes('INV-ATM-001'), 'rendered charter invariants must include seeded invariant text');

// ATM-GOV-0392: every discovered source file must be able to reach an adapter,
// and must satisfy the same schema the minimum entry templates do. Before this
// gate a source template could be counted by the corpus, dropped by profile
// filtering, and reported ok by both this validator and integration verify,
// because the projection and the installation were equally missing it.
const discoveryFindings = packageModule.collectSkillCorpusDiscoveryFindings(path.join(root, 'templates', 'skills'));
for (const finding of discoveryFindings) {
  fail(`undeliverable source template ${finding.sourcePath} (${finding.reason}): ${finding.recovery}`);
}
for (const corpusTemplate of corpusSnapshot.templates) {
  assert(
    validateFrontmatter(corpusTemplate.frontmatter) === true,
    `${corpusTemplate.sourcePath} frontmatter schema mismatch: ${formatErrors(validateFrontmatter.errors)}`
  );
}
const templatesById = new Map(templates.map((template: any) => [template.frontmatter.id, template]));
for (const entryDefinition of packageModule.minimumAtmEntrySkillDefinitions) {
  const template = templatesById.get(entryDefinition.id) as any;
  assert(Boolean(template), `missing loaded template for ${entryDefinition.id}`);
  assert(validateFrontmatter(template.frontmatter) === true, `${entryDefinition.id} frontmatter schema mismatch: ${formatErrors(validateFrontmatter.errors)}`);
  assert(template.frontmatter.title === entryDefinition.title, `${entryDefinition.id} title must match minimum entry definition`);
  assert(template.frontmatter.summary === entryDefinition.summary, `${entryDefinition.id} summary must match minimum entry definition`);
  assert(template.frontmatter.command === entryDefinition.command, `${entryDefinition.id} command must match minimum entry definition`);
  assert(
    template.frontmatter.firstCommand === packageModule.atmFirstCommand
      || template.frontmatter.firstCommand === packageModule.atmPromptScopedFirstCommand
      || template.frontmatter.firstCommand === packageModule.atmIntentScopedFirstCommand,
    `${entryDefinition.id} first command mismatch`
  );
  assert(template.frontmatter['charter-invariants-injected'] === true, `${entryDefinition.id} must declare charter invariant injection`);
  assert(template.frontmatter.handoffs.startsWith('node atm.mjs '), `${entryDefinition.id} handoff must route back through ATM CLI`);
  assert(template.body.includes('{{CHARTER_INVARIANTS}}'), `${entryDefinition.id} template body must include charter placeholder`);
  if (entryDefinition.id === 'atm-next') {
    assert(template.body.includes('evidence.userNotice'), 'atm-next template must tell agents to surface first-use user notices');
    assert(template.body.includes('ATM_USER_NOTICE'), 'atm-next template must also watch top-level user notice messages');
    assert(template.body.includes('before executing the returned next action'), 'atm-next template must show notices before executing next action');
    assert(template.body.includes('return to the user original request'), 'atm-next template must tell agents to resume the original request after onboarding');
  }
  if (entryDefinition.id === 'atm-task-intent-resolver') {
    assert(template.frontmatter.firstCommand === packageModule.atmIntentScopedFirstCommand, 'atm-task-intent-resolver must route through next --intent after semantic extraction');
    assert(template.body.includes('Semantic Extraction First'), 'atm-task-intent-resolver must require semantic extraction before CLI routing');
    assert(template.body.includes('"source": "atm-skill"'), 'atm-task-intent-resolver must produce atm-skill intent');
    assert(template.body.includes('primary route when this skill is available'), 'atm-task-intent-resolver must downgrade next --prompt to fallback');
  }
  if (entryDefinition.id === 'atm-error-code-resolver') {
    assert(template.body.includes('docs/governance/error-code-registry.json'), 'atm-error-code-resolver must read the structured registry first');
    assert(template.body.includes('docs/ERROR_CODES.md'), 'atm-error-code-resolver must fall back to the generated source index');
    assert(template.body.includes('registry-missing'), 'atm-error-code-resolver must expose missing registry entries explicitly');
    assert(template.body.includes('human approval'), 'atm-error-code-resolver must preserve approval guidance');
  }
  for (const requiredTerm of requiredTeamAgentsTermsByTemplate[entryDefinition.id] || []) {
    assert(template.body.includes(requiredTerm), `${entryDefinition.id} missing Team Agents skill surface term: ${requiredTerm}`);
  }
  for (const requiredTerm of requiredGovernanceFlowTermsByTemplate[entryDefinition.id] || []) {
    assert(template.body.includes(requiredTerm), `${entryDefinition.id} missing governance-flow skill surface term: ${requiredTerm}`);
  }
  assert(!hasForbiddenPlanningHint(readFileSync(path.join(root, template.sourcePath), 'utf8')), `${entryDefinition.id} must not bake planning hints into template source`);
}

const claudeFiles = packageModule.compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root });
const codexFiles = packageModule.compileSkillTemplatesForAdapter('codex', templates, { repositoryRoot: root });
const copilotFiles = packageModule.compileSkillTemplatesForAdapter('copilot', templates, { repositoryRoot: root });
const cursorFiles = packageModule.compileSkillTemplatesForAdapter('cursor', templates, { repositoryRoot: root });
const geminiFiles = packageModule.compileSkillTemplatesForAdapter('gemini', templates, { repositoryRoot: root });
const corpusProjection = packageModule.compileSkillCorpus({
  sourceSnapshot: corpusSnapshot,
  adapterDescriptor: {
    adapterId: 'codex',
    diagnostics: [],
    project: ({ templates: corpusTemplates }: any) => packageModule.compileSkillTemplatesForAdapter('codex', corpusTemplates, { repositoryRoot: root })
  }
});
const companionFileCount = requiredTemplateIds.reduce((total, templateId) => total + countCompanionFiles(path.join(root, 'templates', 'skills', `${templateId}.files`)), 0);
const skillAdapterCompiledCount = templates.length + companionFileCount;

assert(corpusProjection.schemaId === 'atm.skillCorpusProjection.v1', 'corpus projection must use the sealed projection schema');
assert(corpusProjection.sourceDigest === corpusSnapshot.sourceDigest, 'corpus projection must carry the source snapshot digest');
assert(corpusProjection.compilerVersion === corpusSnapshot.compilerVersion, 'corpus projection must carry compiler version parity');
assert(corpusProjection.manifestDigest.startsWith('sha256:'), 'corpus projection must carry a manifest digest');
assert(Array.isArray(corpusProjection.degradationDiagnostics), 'corpus projection must carry degradation diagnostics');
assert(claudeFiles.length === skillAdapterCompiledCount, 'Claude compiler output must contain one primary file per template plus all companion files');
assert(codexFiles.length === skillAdapterCompiledCount, 'Codex compiler output must contain one primary file per template plus all companion files');
assert(copilotFiles.length === templates.length * 2, 'Copilot compiler output must contain one instruction and one prompt per template');
assert(cursorFiles.length === skillAdapterCompiledCount, 'Cursor compiler output must contain one primary file per template plus all companion files');
assert(geminiFiles.length === templates.length, 'Gemini compiler output must contain one command file per template');

for (const compiledFile of [...claudeFiles, ...codexFiles, ...copilotFiles, ...cursorFiles, ...geminiFiles]) {
  const isPrimaryEntry = isPrimaryCompiledEntry(compiledFile.relativePath);
  if (isPrimaryEntry) {
    assert(
      compiledFile.content.includes(packageModule.atmFirstCommand)
        || compiledFile.content.includes(packageModule.atmPromptScopedFirstCommand)
        || compiledFile.content.includes(packageModule.atmPromptScopedFirstCommand.replaceAll('"', '\\"'))
        || compiledFile.content.includes(packageModule.atmIntentScopedFirstCommand),
      `${compiledFile.relativePath} missing first command`
    );
    assert(compiledFile.content.includes(renderedCharter.text), `${compiledFile.relativePath} missing rendered charter invariants`);
  }
  assert(!compiledFile.content.includes(packageModule.charterInvariantsPlaceholder), `${compiledFile.relativePath} must not leak charter placeholder after compile`);
  assert(!hasForbiddenPlanningHint(compiledFile.content), `${compiledFile.relativePath} must not bake planning hints into compiled output`);
}

assert(claudeFiles.filter((compiledFile: any) => isPrimaryCompiledEntry(compiledFile.relativePath)).every((compiledFile: any) => compiledFile.content.includes('charter-invariants-injected: true')), 'Claude output must carry charter injection frontmatter on primary entries');
assert(codexFiles.filter((compiledFile: any) => isPrimaryCompiledEntry(compiledFile.relativePath)).every((compiledFile: any) => compiledFile.content.includes('charter-invariants-injected: true')), 'Codex output must carry charter injection frontmatter on primary entries');
assert(geminiFiles.filter((compiledFile: any) => isPrimaryCompiledEntry(compiledFile.relativePath)).every((compiledFile: any) => compiledFile.content.includes('charter_invariants_injected = true')), 'Gemini output must carry charter injection field on primary entries');

// Parity regression: an installed copy that matches the compiled projection is
// clean, and one that does not is reported against the projection itself
// rather than against the uncompiled template source.
const parityRegressionClean = packageModule.evaluateInstalledProjectionParity({
  compiledProjectionFiles: [{ relativePath: 'atm-next/SKILL.md', content: `alpha\n${renderedCharter.text}\n` }],
  installedSkillRoot: '.agents/skills',
  fileExists: (filePath: string) => filePath.replace(/\\/g, '/').endsWith('.agents/skills/atm-next/SKILL.md'),
  readFile: () => `alpha\n${renderedCharter.text}\n`
});
assert(parityRegressionClean.failClosed.length === 0, 'parity must treat an installed copy equal to the projection as clean');
assert(parityRegressionClean.findings[0]?.disposition === 'sync', 'a matching installed copy must be dispositioned as sync');
const parityRegressionDirty = packageModule.evaluateInstalledProjectionParity({
  compiledProjectionFiles: [{ relativePath: 'atm-next/SKILL.md', content: 'alpha\n' }],
  installedSkillRoot: '.agents/skills',
  fileExists: (filePath: string) => filePath.replace(/\\/g, '/').endsWith('.agents/skills/atm-next/SKILL.md'),
  readFile: () => 'beta\n'
});
assert(parityRegressionDirty.failClosed.length === 1, 'undeclared installed drift must fail closed exactly once');
assert(parityRegressionDirty.failClosed[0]?.templateId === 'atm-next', 'fail-closed parity must name the diverged template id');

// The live parity gate compares the full sealed corpus projection, not just
// the minimum entry set, so no installed copy can hide behind profile
// filtering.
const corpusProjectionForParity = packageModule.compileSkillCorpus({
  sourceSnapshot: corpusSnapshot,
  adapterDescriptor: {
    adapterId: 'claude-code',
    diagnostics: [],
    project: ({ templates: corpusTemplates }: any) => packageModule.compileSkillTemplatesForAdapter('claude-code', corpusTemplates, { repositoryRoot: root })
  }
});
for (const finding of packageModule.collectProjectionMetadataFindings(corpusProjectionForParity, corpusSnapshot)) {
  fail(`stale projection metadata: ${finding.summary}`);
}
const installedParity = packageModule.evaluateInstalledProjectionParity({
  compiledProjectionFiles: corpusProjectionForParity.files,
  installedSkillRoot: path.join(root, '.agents', 'skills'),
  dispositions: auditModule.installedProjectionDispositions
});
for (const finding of installedParity.failClosed) {
  fail(`installed-copy drift without a governed disposition: ${finding.templateId} (${path.relative(root, finding.installedPath).replace(/\\/g, '/')}) ${finding.summary}. Resolve it by syncing the installed copy, pinning an approved baseline, or declaring an explicit waiver in scripts/audit-skill-corpus.ts.`);
}
const corpusAudit = auditModule.buildSkillCorpusAudit();
assert(corpusAudit.schemaId === 'atm.skillCorpusAudit.v1', 'skill corpus audit must use the expected schema');
assert(corpusAudit.sourceSnapshot.sourceDigest === corpusSnapshot.sourceDigest, 'skill corpus audit must match current source snapshot digest');
assert(corpusAudit.deepModuleReviews.map((review: any) => review.baselineFingerprint).includes('deep-module-review:52470e9f'), 'skill corpus audit must record source-snapshot deep-module baseline');
assert(corpusAudit.deepModuleReviews.map((review: any) => review.baselineFingerprint).includes('deep-module-review:52b3cbe6'), 'skill corpus audit must record projection deep-module baseline');
assert(
  corpusAudit.installedProjectionParity.failClosed.length === 0,
  'skill corpus audit must record zero undisposed installed-copy drift'
);
assert(
  corpusAudit.sourceUniverse.universeDigest === sourceUniverse.universeDigest,
  'skill corpus audit must seal the same source universe this validator sealed'
);

if (!process.exitCode) {
  const counts = installedParity.findings.reduce((totals: Record<string, number>, finding: any) => {
    totals[finding.disposition] = (totals[finding.disposition] ?? 0) + 1;
    return totals;
  }, {});
  console.log(`[skill-templates:${mode}] ok (${templates.length} minimum entry templates, ${corpusSnapshot.templateCount} sealed source templates, schema, 5 adapter compilers; installed-copy parity ${JSON.stringify(counts)})`);
}

function countCompanionFiles(directoryPath: string): number {
  const trackedFiles = listTrackedFilesUnder(directoryPath);
  if (trackedFiles) {
    return trackedFiles.length;
  }
  if (!existsSync(directoryPath)) {
    return 0;
  }
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  return entries.reduce((total, entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return total + countCompanionFiles(absolutePath);
    }
    return entry.isFile() ? total + 1 : total;
  }, 0);
}

function listTrackedFilesUnder(directoryPath: string): readonly string[] | null {
  const relativeDirectory = path.relative(root, directoryPath);
  if (!relativeDirectory || relativeDirectory.startsWith('..')) {
    return null;
  }
  const result = spawnSync('git', ['ls-files', '-z', '--', relativeDirectory.replace(/\\/g, '/')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.join(root, entry))
    .filter((entry) => existsSync(entry));
}
