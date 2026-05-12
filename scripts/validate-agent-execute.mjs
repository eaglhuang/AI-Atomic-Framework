import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/agent-execute.fixture.json');
const buildAgentPromptModule = await importFromTypeScript('packages/core/src/agent-prompt/build-agent-prompt.ts');
const executeAgentTaskModule = await importFromTypeScript('packages/core/src/agent-execute/execute-agent-task.ts');

function fail(message) {
  console.error(`[agent-execute:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

async function importFromTypeScript(relativePath) {
  return import(pathToFileURL(path.join(root, relativePath)).href);
}

function stageFixtureFiles(tempRoot) {
  const sourcePath = path.join(root, fixture.inputSpecPath);
  const targetPath = path.join(tempRoot, fixture.inputSpecPath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function assertProtectedFilesStayNeutral() {
  const protectedFiles = [
    'packages/core/src/agent-execute/execute-agent-task.ts',
    'packages/core/src/agent-execute/execution-constants.ts',
    'packages/core/src/agent-execute/execution-documents.ts',
    'packages/core/src/agent-execute/execution-validation.ts',
    'packages/plugin-sdk/src/effect-node.ts',
    'schemas/agent-execute/execution-evidence.schema.json',
    'scripts/validate-agent-execute.mjs',
    'scripts/validate-plugin-sdk.mjs',
    'tests/agent-execute.fixture.json',
    'fixtures/agent-execute/dry-run.snapshot.json',
    'tests/schema-fixtures/positive/minimal-execution-evidence.json',
    'tests/schema-fixtures/negative/missing-validation-passes.execution-evidence.json'
  ];
  const bannedTerms = [
    ['3K', 'Life'].join(''),
    ['Co', 'cos'].join(''),
    ['co', 'cos', '-creator'].join(''),
    ['html', '-to-', 'u', 'cuf'].join(''),
    ['ga', 'cha'].join(''),
    ['UC', 'UF'].join(''),
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

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-agent-execute-'));
try {
  stageFixtureFiles(tempRoot);
  const sentinelPath = path.join(tempRoot, fixture.hostSentinelPath);
  writeFileSync(sentinelPath, fixture.hostSentinelBefore, 'utf8');

  const parsed = parseAtomicSpecFile(fixture.inputSpecPath, { cwd: tempRoot });
  check(parsed.ok === true, 'agent execute fixture spec must parse before execution');

  const evolutionModel = JSON.parse(JSON.stringify(parsed.normalizedModel));
  evolutionModel.execution.compatibility.lifecycleMode = 'evolution';
  const promptResult = buildAgentPromptModule.buildAgentPrompt(evolutionModel);
  check(promptResult.ok === true, 'build-agent-prompt must succeed before ExecuteAgentTask');

  let applyCalls = 0;
  const sharedOptions = {
    repositoryRoot: tempRoot,
    promptDocument: promptResult.document,
    now: fixture.generatedAt,
    agentExecutor() {
      return {
        ok: true,
        summary: 'Dry-run captured a candidate patch without mutating the host project.',
        logLines: [fixture.expectedLogPreview[0]],
        proposedChanges: [
          {
            filePath: fixture.expectedProposedTouchedFile,
            description: 'Candidate test update staged for review.'
          }
        ]
      };
    },
    runValidationPass(context) {
      return {
        ok: true,
        exitCode: 0,
        reportPath: context.pass.reportPath,
        summary: fixture.expectedValidationSummaries[context.pass.passId]
      };
    },
    applyExecution() {
      applyCalls += 1;
      writeFileSync(sentinelPath, fixture.hostSentinelAfter, 'utf8');
      return {
        ok: true,
        appliedChanges: true,
        touchedFiles: [fixture.hostSentinelPath],
        summary: 'Apply mode executed the host mutation callback.'
      };
    }
  };

  const dryRunResult = executeAgentTaskModule.executeAgentTask(evolutionModel, sharedOptions);
  check(dryRunResult.ok === true, 'dry-run execution must succeed');
  check(dryRunResult.executionMode === 'dry-run', 'dry-run must be the default execution mode');
  check(dryRunResult.promptPath === fixture.expectedPromptPath, 'prompt path must stay aligned with BuildAgentPrompt output');
  check(dryRunResult.evidencePath === fixture.expectedEvidencePath, 'execution evidence path mismatch');
  check(dryRunResult.artifactPath === fixture.expectedArtifactPath, 'execution artifact path mismatch');
  check(dryRunResult.logPath === fixture.expectedLogPath, 'execution log path mismatch');
  check(applyCalls === 0, 'dry-run must not invoke the apply callback');
  check(readFileSync(sentinelPath, 'utf8') === fixture.hostSentinelBefore, 'dry-run must not mutate the host target');
  check(dryRunResult.validationPasses.length === fixture.expectedValidationPasses.length, 'evolution mode must record two validation passes');
  fixture.expectedValidationPasses.forEach((expectedPass, index) => {
    const actual = dryRunResult.validationPasses[index];
    check(actual.passId === expectedPass.passId, `validation pass ${index + 1} passId mismatch`);
    check(actual.fixtureSet === expectedPass.fixtureSet, `validation pass ${index + 1} fixtureSet mismatch`);
    check(actual.summary === fixture.expectedValidationSummaries[expectedPass.passId], `validation pass ${index + 1} summary mismatch`);
  });
  check(dryRunResult.document.logSummary.preview.join('\n') === fixture.expectedLogPreview.join('\n'), 'dry-run log preview mismatch');
  check(dryRunResult.document.effectNode.defaultMode === 'dry-run', 'effect node default mode must stay dry-run');
  check(dryRunResult.document.effectNode.applyFlag === '--apply', 'effect node apply flag must stay --apply');
  check(dryRunResult.document.agentRun.appliedChanges === false, 'dry-run evidence must report appliedChanges=false');
  check(dryRunResult.document.agentRun.hostProjectMutated === false, 'dry-run evidence must report hostProjectMutated=false');
  check(dryRunResult.document.agentRun.touchedFiles[0] === fixture.expectedProposedTouchedFile, 'dry-run proposed touched file mismatch');
  check(existsSync(path.join(tempRoot, fixture.expectedEvidencePath)), 'dry-run must write execution-evidence.json');
  check(existsSync(path.join(tempRoot, fixture.expectedArtifactPath)), 'dry-run must write execution snapshot artifact');
  check(existsSync(path.join(tempRoot, fixture.expectedLogPath)), 'dry-run must write execution log');
  fixture.expectedValidationPasses.forEach((expectedPass) => {
    const reportPath = path.join(tempRoot, 'atomic_workbench/atoms/ATM-AGENT-0001/execution-reports', `${expectedPass.passId}.report.json`);
    check(existsSync(reportPath), `validation report missing: ${expectedPass.passId}`);
  });

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = readJson('schemas/agent-execute/execution-evidence.schema.json');
  check(ajv.validateSchema(schema) === true, 'execution-evidence schema must be a valid JSON Schema');
  const validate = ajv.compile(schema);
  check(validate(dryRunResult.document) === true, `generated execution evidence must validate: ${(validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);

  const expectedSnapshot = readJson(fixture.snapshotPath);
  assert.deepEqual(dryRunResult.document, expectedSnapshot, 'dry-run evidence document must match snapshot');

  const applyResult = executeAgentTaskModule.executeAgentTask(evolutionModel, {
    ...sharedOptions,
    applyChanges: true
  });
  check(applyResult.ok === true, 'apply execution must succeed');
  check(applyResult.executionMode === 'apply', 'apply execution mode mismatch');
  check(applyCalls === 1, 'apply mode must invoke the host mutation callback exactly once');
  check(readFileSync(sentinelPath, 'utf8') === fixture.hostSentinelAfter, 'apply mode must mutate the host target');
  check(applyResult.document.agentRun.appliedChanges === true, 'apply evidence must report appliedChanges=true');
  check(applyResult.document.agentRun.hostProjectMutated === true, 'apply evidence must report hostProjectMutated=true');
  check(applyResult.document.agentRun.appliedTouchedFiles[0] === fixture.hostSentinelPath, 'apply evidence must record touched host file');
  check(existsSync(path.join(tempRoot, fixture.expectedEvidencePath)), 'apply mode must still write execution-evidence.json');

  assertProtectedFilesStayNeutral();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[agent-execute:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}
