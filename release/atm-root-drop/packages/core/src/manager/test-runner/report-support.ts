import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestReportMetrics } from '../../test-runner/metrics-collector.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const require = createRequire(import.meta.url);

export const defaultTestReportSchemaPath = path.join(repoRoot, 'schemas', 'test-report.schema.json');
export const defaultTestReportMetricsSchemaPath = path.join(repoRoot, 'schemas', 'test-report', 'metrics.schema.json');
export const defaultTestReportMigration = Object.freeze({
  strategy: 'none',
  fromVersion: null,
  notes: 'Initial alpha0 test runner report.'
});

export interface TestRunnerModel {
  identity: { atomId: string };
  source: { specPath?: string | null };
  execution: {
    validation: {
      commands: string[];
      evidenceRequired?: boolean;
    };
  };
  hashLock: {
    algorithm: string;
    digest: string;
    canonicalization: string;
  };
}

export interface AtomicTestReportEntry extends Record<string, unknown> {
  ok?: boolean;
  exitCode?: unknown;
  durationMs?: unknown;
  status?: string;
  blocking?: boolean;
  key?: string | null;
  family?: string | null;
  dedupeKeys?: string[] | null;
}

export interface CommandResultRecord extends AtomicTestReportEntry {
  commandId: string;
  commandKind: string;
  command: string;
  required?: boolean;
  stdout: string;
  stderr: string;
  signal: string | null;
}

export interface AtomicTestReportOptions {
  results?: AtomicTestReportEntry[];
  runnerContract?: {
    evidenceRequired?: boolean;
    commands?: unknown[];
    [key: string]: unknown;
  };
  pluginRuns?: Array<Record<string, unknown>>;
  gateResults?: AtomicTestReportEntry[];
  reportPath?: string;
  generatedAt?: string;
  repositoryRoot?: string;
  [key: string]: unknown;
}

export function createAtomicTestRunnerContract(normalizedModel: TestRunnerModel | null) {
  if (!normalizedModel) {
    throw new Error('Normalized model is required.');
  }
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

export function createAtomicTestReport(normalizedModel: TestRunnerModel, options: AtomicTestReportOptions = {}) {
  const results = [...(options.results ?? [])];
  const runnerContract = options.runnerContract ?? createAtomicTestRunnerContract(normalizedModel);
  const pluginRuns = [...(options.pluginRuns ?? [])];
  const gateResults = [...(options.gateResults ?? [])];
  const total = results.length;
  const passed = results.filter((entry) => entry.ok === true).length;
  const failed = results.filter((entry) => entry.ok !== true).length;
  const blockingGateFailures = gateResults.filter((entry) => entry.status === 'failed' && entry.blocking !== false).length;
  const durationMs = results.reduce((sum, entry) => sum + normalizeDuration(entry.durationMs), 0);
  const exitCode = results.find((entry) => entry.exitCode !== 0)?.exitCode ?? (blockingGateFailures > 0 ? 1 : total > 0 || gateResults.length > 0 ? 0 : 1);
  const ok = (total > 0 || gateResults.length > 0) && failed === 0 && blockingGateFailures === 0;
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
      commandCount: Array.isArray(runnerContract.commands) ? runnerContract.commands.length : 0
    },
    runnerContract,
    results,
    pluginRuns,
    gateResults,
    summary: {
      total,
      passed,
      failed,
      durationMs
    },
    metrics: createTestReportMetrics({
      total,
      failed,
      durationMs
    }),
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

export function validateAtomicTestReportDocument(reportDocument: Record<string, unknown>, options: { schemaPath?: string } = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultTestReportSchemaPath);
  let ajv;
  try {
    let Ajv2020, addFormats;
    try {
      Ajv2020 = require('ajv/dist/2020.js');
      addFormats = require('ajv-formats');
    } catch {
      const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
      Ajv2020 = cwdRequire('ajv/dist/2020.js');
      addFormats = cwdRequire('ajv-formats');
    }
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
    ajv.addSchema(JSON.parse(readFileSync(defaultTestReportMetricsSchemaPath, 'utf8')));
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
    return createValidationFailure(schemaPath, 'ATM_TEST_REPORT_INVALID', (validate.errors || []).map((error: Record<string, unknown>) => ({
      code: 'ATM_TEST_REPORT_INVALID',
      keyword: String(error.keyword ?? ''),
      path: typeof error.instancePath === 'string' && error.instancePath.length > 0 ? error.instancePath : '/',
      text: typeof error.message === 'string' ? error.message : 'Invalid test report document.',
      prompt: `Fix the test report field at ${typeof error.instancePath === 'string' && error.instancePath.length > 0 ? error.instancePath : '/'} (${String(error.keyword ?? '')}).`
    })));
  }

  return {
    ok: true,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code: 'ATM_TEST_REPORT_OK',
      summary: `Atomic test report ${String(reportDocument.atomId ?? '')} validated successfully.`,
      issues: []
    }
  };
}

export function normalizeExitCode(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 1;
}

export function normalizeDuration(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function normalizeText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}

function classifyValidationCommandKind(command: string, index: number) {
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

function createValidationFailure(schemaPath: string, code: string, issues: unknown[]) {
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
