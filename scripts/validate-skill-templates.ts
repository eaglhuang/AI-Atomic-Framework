import { existsSync, readFileSync } from 'node:fs';
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
  'atm-orient',
  'atm-governance-router',
  'atm-create',
  'atm-lock',
  'atm-evidence',
  'atm-upgrade-scan',
  'atm-handoff'
];

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
assert(templates.length === requiredTemplateIds.length, 'minimum ATM skill template count mismatch');

const templatesById = new Map(templates.map((template: any) => [template.frontmatter.id, template]));
for (const entryDefinition of packageModule.minimumAtmEntrySkillDefinitions) {
  const template = templatesById.get(entryDefinition.id) as any;
  assert(Boolean(template), `missing loaded template for ${entryDefinition.id}`);
  assert(validateFrontmatter(template.frontmatter) === true, `${entryDefinition.id} frontmatter schema mismatch: ${formatErrors(validateFrontmatter.errors)}`);
  assert(template.frontmatter.title === entryDefinition.title, `${entryDefinition.id} title must match minimum entry definition`);
  assert(template.frontmatter.summary === entryDefinition.summary, `${entryDefinition.id} summary must match minimum entry definition`);
  assert(template.frontmatter.command === entryDefinition.command, `${entryDefinition.id} command must match minimum entry definition`);
  assert(template.frontmatter.firstCommand === packageModule.atmFirstCommand, `${entryDefinition.id} first command mismatch`);
  assert(template.frontmatter['charter-invariants-injected'] === true, `${entryDefinition.id} must declare charter invariant injection`);
  assert(template.frontmatter.handoffs.startsWith('node atm.mjs '), `${entryDefinition.id} handoff must route back through ATM CLI`);
  assert(template.body.includes('{{CHARTER_INVARIANTS}}'), `${entryDefinition.id} template body must include charter placeholder`);
  if (entryDefinition.id === 'atm-next') {
    assert(template.body.includes('evidence.userNotice'), 'atm-next template must tell agents to surface first-use user notices');
    assert(template.body.includes('ATM_USER_NOTICE'), 'atm-next template must also watch top-level user notice messages');
    assert(template.body.includes('before executing the returned next action'), 'atm-next template must show notices before executing next action');
    assert(template.body.includes('return to the user original request'), 'atm-next template must tell agents to resume the original request after onboarding');
  }
  assert(!hasForbiddenPlanningHint(readFileSync(path.join(root, template.sourcePath), 'utf8')), `${entryDefinition.id} must not bake planning hints into template source`);
}

const claudeFiles = packageModule.compileSkillTemplatesForAdapter('claude-code', templates);
const codexFiles = packageModule.compileSkillTemplatesForAdapter('codex', templates);
const copilotFiles = packageModule.compileSkillTemplatesForAdapter('copilot', templates);
const cursorFiles = packageModule.compileSkillTemplatesForAdapter('cursor', templates);
const geminiFiles = packageModule.compileSkillTemplatesForAdapter('gemini', templates);

assert(claudeFiles.length === 8, 'Claude compiler output must contain eight files');
assert(codexFiles.length === 8, 'Codex compiler output must contain eight files');
assert(copilotFiles.length === 17, 'Copilot compiler output must contain root instructions plus sixteen entry files');
assert(cursorFiles.length === 8, 'Cursor compiler output must contain eight files');
assert(geminiFiles.length === 8, 'Gemini compiler output must contain eight files');

for (const compiledFile of [...claudeFiles, ...codexFiles, ...copilotFiles, ...cursorFiles, ...geminiFiles]) {
  assert(compiledFile.content.includes(packageModule.atmFirstCommand), `${compiledFile.relativePath} missing first command`);
  assert(compiledFile.content.includes(packageModule.charterInvariantsPlaceholder), `${compiledFile.relativePath} missing charter placeholder`);
  assert(!hasForbiddenPlanningHint(compiledFile.content), `${compiledFile.relativePath} must not bake planning hints into compiled output`);
}

assert(claudeFiles.every((compiledFile: any) => compiledFile.content.includes('charter-invariants-injected: true')), 'Claude output must carry charter injection frontmatter');
assert(codexFiles.every((compiledFile: any) => compiledFile.content.includes('charter-invariants-injected: true')), 'Codex output must carry charter injection frontmatter');
assert(geminiFiles.every((compiledFile: any) => compiledFile.content.includes('charter_invariants_injected = true')), 'Gemini output must carry charter injection field');

if (!process.exitCode) {
  console.log(`[skill-templates:${mode}] ok (8 source templates, schema, and 5 adapter compilers)`);
}
