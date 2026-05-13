import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.ts';
import { importModuleFromPath } from './lib/import-module.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/agent-prompt.fixture.json');
const buildAgentPromptModule = await importModuleFromPath<Record<string, any>>(path.join(root, 'packages/core/src/agent-prompt/build-agent-prompt.ts'));

function fail(message: any) {
  console.error(`[agent-prompt:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: any) {
  return JSON.parse(readText(relativePath));
}

function assertProtectedFilesStayNeutral() {
  const protectedFiles = [
    'packages/core/src/agent-prompt/build-agent-prompt.ts',
    'schemas/agent-prompt.schema.json',
    'scripts/validate-agent-prompt.ts',
    'tests/agent-prompt.fixture.json',
    fixture.inputSpecPath,
    fixture.expectedMarkdownPath,
    'tests/schema-fixtures/positive/minimal-agent-prompt.json',
    'tests/schema-fixtures/negative/missing-evidence-contract.agent-prompt.json'
  ];
  const bannedTerms = [
    ['3K', 'Life'].join(''),
    ['Co', 'cos'].join(''),
    ['html', '-to-', 'u', 'cuf'].join(''),
    ['ga', 'cha'].join(''),
    ['U', 'C', 'UF'].join(''),
    ['task', '-lock'].join(''),
    ['compute', '-gate'].join(''),
    ['doc', '-id-', 'registry'].join('')
  ];

  for (const relativePath of protectedFiles) {
    const content = readText(relativePath).toLowerCase();
    for (const term of bannedTerms) {
      check(!content.includes(term.toLowerCase()), `${relativePath} contains forbidden hard-coded term: ${term}`);
    }
  }
}

const parsed = parseAtomicSpecFile(fixture.inputSpecPath, { cwd: root });
check(parsed.ok === true, 'agent prompt fixture spec must parse before building prompt');

const result = buildAgentPromptModule.buildAgentPrompt(parsed.normalizedModel);
check(result.ok === true, 'build-agent-prompt must succeed');
check(result.promptPath === fixture.expectedPromptPath, 'prompt path must resolve under canonical atom workbench path');
check(result.document.frontmatter.evidenceContract.requiredOutputs.includes(fixture.expectedRequiredOutput), 'required evidence output missing from evidence contract');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = readJson('schemas/agent-prompt.schema.json');
check(ajv.validateSchema(schema) === true, 'agent-prompt schema must be a valid JSON Schema');
const validate = ajv.compile(schema);
check(validate(result.document) === true, `generated agent prompt document must validate: ${(validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);

const expectedMarkdown = readText(fixture.expectedMarkdownPath);
check(normalizeNewlines(result.markdown) === normalizeNewlines(expectedMarkdown), 'generated prompt markdown must match snapshot');
check(result.markdown.includes('forbiddenRules:') && result.markdown.includes('allowedFiles:') && result.markdown.includes('evidenceContract:'), 'markdown frontmatter must include forbidden rules, allowed files, and evidence contract');

const mutatedModel = JSON.parse(JSON.stringify(parsed.normalizedModel));
mutatedModel.identity.title = fixture.mutatedTitle;
mutatedModel.execution.validation.commands = [...mutatedModel.execution.validation.commands, fixture.mutatedValidationCommand];
const mutatedResult = buildAgentPromptModule.buildAgentPrompt(mutatedModel);
check(mutatedResult.markdown !== result.markdown, 'prompt markdown must change when spec-derived inputs change');
check(mutatedResult.markdown.includes(fixture.mutatedTitle), 'mutated prompt must reflect updated title');
check(mutatedResult.markdown.includes(fixture.mutatedValidationCommand), 'mutated prompt must reflect updated validation command');

assertProtectedFilesStayNeutral();

if (!process.exitCode) {
  console.log(`[agent-prompt:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}

function normalizeNewlines(value: any) {
  return String(value).replace(/\r\n/g, '\n').trimEnd();
}
