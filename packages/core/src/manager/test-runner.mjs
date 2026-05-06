import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);

export const defaultTestReportSchemaPath = path.join(repoRoot, 'schemas', 'test-report.schema.json');
export const defaultTestReportMigration = Object.freeze({
  strategy: 'none',
  fromVersion: null,
  notes: 'Initial alpha0 test runner report.'
});

export { defaultTestReportFileName, resolveAtomicTestReportPath };

export function createAtomicTestRunnerContract(normalizedModel) {
  const commands = normalizedModel.execution.validation.commands.map((command, index) => ({
    commandId: `validation-${index + 1}`,
    commandKind: classifyValidationCommandKind(command, index),
    command,
    required: true
  }));

  return {
    executionMode: 'delegated',
    evidenceRequired: normalizedModel.execution.validation.evidenceRequired === true,
    commands
  };
}

export function runAtomicTestRunner(normalizedModel, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const reportPath = resolveAtomicTestReportPath(normalizedModel, {
    repositoryRoot,
    reportPath: options.reportPath,
    workbenchPath: options.workbenchPath,
    workbenchRoot: options.workbenchRoot
  });
  const runnerContract = createAtomicTestRunnerContract(normalizedModel);
  const executeCommand = options.executeCommand ?? defaultExecuteCommand;
  const generatedAt = options.now ?? new Date().toISOString();
  const results = runnerContract.commands.map((commandContract) => {
    const outcome = executeCommand(commandContract.command, {
      repositoryRoot,
      atomId: normalizedModel.identity.atomId,
      commandContract
    });
    return {
      ...commandContract,
      exitCode: normalizeExitCode(outcome?.exitCode),
      ok: normalizeExitCode(outcome?.exitCode) === 0,
      durationMs: normalizeDuration(outcome?.durationMs),
      stdout: normalizeText(outcome?.stdout),
      stderr: normalizeText(outcome?.stderr),
      signal: outcome?.signal ?? null
    };
  });
  const report = createAtomicTestReport(normalizedModel, {
    repositoryRoot,
    generatedAt,
    reportPath,
    runnerContract,
    results
  });
  const reportValidation = validateAtomicTestReportDocument(report, {
    schemaPath: options.schemaPath
  });

  if (options.writeReport !== false) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return {
    ok: report.ok === true && reportValidation.ok === true,
    atomId: normalizedModel.identity.atomId,
    exitCode: report.exitCode,
    reportPath: toPortablePath(reportPath),
    runnerContract,
    commandResults: results,
    report,
    reportValidation
  };
}

export function createAtomicTestReport(normalizedModel, options = {}) {
  const results = [...(options.results ?? [])];
  const runnerContract = options.runnerContract ?? createAtomicTestRunnerContract(normalizedModel);
  const total = results.length;
  const passed = results.filter((entry) => entry.ok === true).length;
  const failed = results.filter((entry) => entry.ok !== true).length;
  const durationMs = results.reduce((sum, entry) => sum + normalizeDuration(entry.durationMs), 0);
  const exitCode = results.find((entry) => entry.exitCode !== 0)?.exitCode ?? (total > 0 ? 0 : 1);
  const ok = total > 0 && failed === 0;
  const artifactPaths = [];
  if (options.reportPath) {
    artifactPaths.push(toPortablePath(options.reportPath));
  }
  if (normalizedModel.source.specPath) {
    artifactPaths.push(normalizedModel.source.specPath);
  }

  return {
    schemaId: 'atm.testReport',
    specVersion: '0.1.0',
    migration: defaultTestReportMigration,
    atomId: normalizedModel.identity.atomId,
    ok,
    exitCode,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    repositoryRoot: toPortablePath(path.resolve(options.repositoryRoot ?? process.cwd())),
    specPath: normalizedModel.source.specPath,
    hashLock: {
      algorithm: normalizedModel.hashLock.algorithm,
      digest: normalizedModel.hashLock.digest,
      canonicalization: normalizedModel.hashLock.canonicalization
    },
    validation: {
      evidenceRequired: runnerContract.evidenceRequired === true,
      commandCount: runnerContract.commands.length
    },
    runnerContract,
    results,
    summary: {
      total,
      passed,
      failed,
      durationMs
    },
    artifacts: artifactPaths.map((artifactPath, index) => ({
      artifactPath,
      artifactKind: index === 0 && options.reportPath ? 'report' : 'file',
      producedBy: '@ai-atomic-framework/core:test-runner'
    })),
    evidence: [
      {
        evidenceKind: 'validation',
        summary: ok
          ? `Atomic test runner verified ${normalizedModel.identity.atomId} with ${passed}/${total} command(s) passing.`
          : total === 0
            ? `Atomic test runner could not verify ${normalizedModel.identity.atomId} because no validation commands were declared.`
            : `Atomic test runner detected ${failed} failing command(s) while verifying ${normalizedModel.identity.atomId}.`,
        artifactPaths
      }
    ]
  };
}

export function validateAtomicTestReportDocument(reportDocument, options = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultTestReportSchemaPath);
  let ajv;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
  } catch (error) {
    return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE', [
      {
        code: 'ATM_TEST_REPORT_VALIDATOR_UNAVAILABLE',
        keyword: 'runtime',
        path: toPortablePath(schemaPath),
        text: 'AJV validator is not available in this environment.',
        prompt: `Install the validator dependency or restore the AJV runtime. Reason: ${error instanceof Error ? error.message : String(error)}`
      }
    ]);
  }

  const schemaDocument = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validate = ajv.compile(schemaDocument);
  const valid = validate(reportDocument);
  if (!valid) {
    return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_INVALID', (validate.errors || []).map((error) => ({
      code: 'ATM_TEST_REPORT_INVALID',
      keyword: error.keyword,
      path: error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/',
      text: error.message ?? 'Invalid test report document.',
      prompt: `Fix the test report field at ${error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/'} (${error.keyword}).`
    })));
  }

  return {
    ok: true,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code: 'ATM_TEST_REPORT_OK',
      summary: `Atomic test report ${reportDocument.atomId} validated successfully.`,
      issues: []
    }
  };
}

function defaultExecuteCommand(command, context) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: context.repositoryRoot,
    shell: true,
    encoding: 'utf8'
  });

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: normalizeText(result.stdout),
    stderr: [normalizeText(result.stderr), result.error?.message ?? ''].filter(Boolean).join('\n'),
    durationMs: Date.now() - startedAt,
    signal: result.signal ?? null
  };
}

function classifyValidationCommandKind(command, index) {
  if (/\b(?:type-?check|tsc|pyright|mypy|cargo check)\b/i.test(command)) {
    return 'typecheck';
  }
  if (/\b(?:lint|eslint|ruff|biome)\b/i.test(command)) {
    return 'lint';
  }
  if (index === 0 || /\b(?:test|spec|jest|mocha|ava|playwright)\b/i.test(command)) {
    return 'test';
  }
  return 'custom';
}

function createValidationFailure(schemaPath, code, issues) {
  return {
    ok: false,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code,
      summary: `Atomic test report validation failed with ${issues.length} issue(s).`,
      issues
    }
  };
}

function normalizeExitCode(value) {
  return Number.isInteger(value) ? value : 1;
}

function normalizeDuration(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}