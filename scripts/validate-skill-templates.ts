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
  'atm-upgrade-scan',
  'atm-handoff',
  'mailbox-worker-execution',
  'atm-internal-build-sync',
  'atm-atom-map-refactor'
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

interface InstalledSkillDriftFinding {
  readonly templateId: string;
  readonly installedPath: string;
  readonly summary: string;
}

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

function normalizeSkillContentForDrift(content: string, renderedCharterText: string): string {
  return content
    .replaceAll('\r\n', '\n')
    .replaceAll(renderedCharterText, '{{CHARTER_INVARIANTS}}')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trimEnd();
}

function summarizeFirstDrift(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const maxLength = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < maxLength; index += 1) {
    if ((expectedLines[index] ?? '') !== (actualLines[index] ?? '')) {
      return `first differing line ${index + 1}: expected ${JSON.stringify(expectedLines[index] ?? '<missing>')}, installed ${JSON.stringify(actualLines[index] ?? '<missing>')}`;
    }
  }
  return 'content differs after normalization';
}

export function collectInstalledSkillDriftFindings(input: {
  readonly compiledClaudeFiles: readonly { readonly relativePath: string; readonly content: string }[];
  readonly installedSkillRoot: string;
  readonly renderedCharterText: string;
  readonly readFile?: (filePath: string) => string;
  readonly fileExists?: (filePath: string) => boolean;
}): readonly InstalledSkillDriftFinding[] {
  const readText = input.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'));
  const hasFile = input.fileExists ?? existsSync;
  const findings: InstalledSkillDriftFinding[] = [];
  for (const compiledFile of input.compiledClaudeFiles) {
    const normalizedRelativePath = compiledFile.relativePath.replace(/\\/g, '/');
    if (!normalizedRelativePath.endsWith('/SKILL.md')) continue;
    const [templateId] = normalizedRelativePath.split('/');
    if (!templateId) continue;
    const installedPath = path.join(input.installedSkillRoot, templateId, 'SKILL.md');
    // Scope limit: this dogfood drift patrol compares only templates that
    // already have an installed .agents/skills copy in this repository.
    if (!hasFile(installedPath)) continue;
    const expected = normalizeSkillContentForDrift(compiledFile.content, input.renderedCharterText);
    const actual = normalizeSkillContentForDrift(readText(installedPath), input.renderedCharterText);
    if (expected === actual) continue;
    findings.push({
      templateId,
      installedPath,
      summary: summarizeFirstDrift(expected, actual)
    });
  }
  return findings;
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
const templates = packageModule.loadMinimumAtmSkillTemplates(path.join(root, 'templates', 'skills'));
const renderedCharter = packageModule.renderCharterInvariantsBlock(root);
assert(templates.length === requiredTemplateIds.length, 'minimum ATM skill template count mismatch');
assert(renderedCharter.fallbackReason === null, 'validator fixture repo must have readable charter invariants');
assert(renderedCharter.text.includes('INV-ATM-001'), 'rendered charter invariants must include seeded invariant text');

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
  for (const requiredTerm of requiredTeamAgentsTermsByTemplate[entryDefinition.id] || []) {
    assert(template.body.includes(requiredTerm), `${entryDefinition.id} missing Team Agents skill surface term: ${requiredTerm}`);
  }
  assert(!hasForbiddenPlanningHint(readFileSync(path.join(root, template.sourcePath), 'utf8')), `${entryDefinition.id} must not bake planning hints into template source`);
}

const claudeFiles = packageModule.compileSkillTemplatesForAdapter('claude-code', templates, { repositoryRoot: root });
const codexFiles = packageModule.compileSkillTemplatesForAdapter('codex', templates, { repositoryRoot: root });
const copilotFiles = packageModule.compileSkillTemplatesForAdapter('copilot', templates, { repositoryRoot: root });
const cursorFiles = packageModule.compileSkillTemplatesForAdapter('cursor', templates, { repositoryRoot: root });
const geminiFiles = packageModule.compileSkillTemplatesForAdapter('gemini', templates, { repositoryRoot: root });
const companionFileCount = requiredTemplateIds.reduce((total, templateId) => total + countCompanionFiles(path.join(root, 'templates', 'skills', `${templateId}.files`)), 0);
const skillAdapterCompiledCount = templates.length + companionFileCount;

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

const driftRegressionClean = collectInstalledSkillDriftFindings({
  compiledClaudeFiles: [{ relativePath: 'atm-next/SKILL.md', content: `alpha\n${renderedCharter.text}\n` }],
  installedSkillRoot: '.agents/skills',
  renderedCharterText: renderedCharter.text,
  fileExists: (filePath) => filePath.replace(/\\/g, '/').endsWith('.agents/skills/atm-next/SKILL.md'),
  readFile: () => `alpha\n{{CHARTER_INVARIANTS}}\n`
});
assert(driftRegressionClean.length === 0, 'installed skill drift regression must treat matching normalized content as clean');
const driftRegressionDirty = collectInstalledSkillDriftFindings({
  compiledClaudeFiles: [{ relativePath: 'atm-next/SKILL.md', content: 'alpha\n' }],
  installedSkillRoot: '.agents/skills',
  renderedCharterText: renderedCharter.text,
  fileExists: (filePath) => filePath.replace(/\\/g, '/').endsWith('.agents/skills/atm-next/SKILL.md'),
  readFile: () => 'beta\n'
});
assert(driftRegressionDirty.length === 1, 'installed skill drift regression must report exactly one diverged installed copy');
assert(driftRegressionDirty[0]?.templateId === 'atm-next', 'installed skill drift regression must name the diverged template id');

const installedSkillDriftFindings = collectInstalledSkillDriftFindings({
  compiledClaudeFiles: claudeFiles,
  installedSkillRoot: path.join(root, '.agents', 'skills'),
  renderedCharterText: renderedCharter.text
});
for (const finding of installedSkillDriftFindings) {
  console.warn(`[skill-templates:${mode}] advisory installed-copy drift: ${finding.templateId} (${path.relative(root, finding.installedPath).replace(/\\/g, '/')}) ${finding.summary}`);
}

if (!process.exitCode) {
  const driftScope = 'installed-copy drift advisory compares only templates with .agents/skills/<id>/SKILL.md in this repo';
  console.log(`[skill-templates:${mode}] ok (${templates.length} source templates, schema, 5 adapter compilers, ${installedSkillDriftFindings.length} installed-copy drift advisory finding(s); ${driftScope})`);
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
