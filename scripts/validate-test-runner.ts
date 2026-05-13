import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.ts';
import { runAtomicTestRunner, validateAtomicTestReportDocument } from '../packages/core/src/manager/test-runner.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/test-runner.fixture.json');

function fail(message: any) {
  console.error(`[test-runner:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function stageFixtureFiles(tempRoot: any) {
  const relativePaths = [
    fixture.passCase.specPath,
    fixture.passCase.commandPath,
    fixture.failCase.specPath,
    fixture.failCase.commandPath
  ];

  for (const relativePath of relativePaths) {
    const sourcePath = path.join(root, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function assertProtectedFilesStayNeutral() {
  const protectedFiles = [
    'packages/core/src/manager/test-runner.ts',
    'schemas/test-report.schema.json',
    'scripts/validate-test-runner.ts',
    'tests/test-runner.fixture.json',
    fixture.passCase.specPath,
    fixture.failCase.specPath,
    fixture.passCase.commandPath,
    fixture.failCase.commandPath
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
    ['doc', '-id-', 'registry'].join(''),
    ['vi', 'test'].join('')
  ];
  for (const relativePath of protectedFiles) {
    const content = readFileSync(path.join(root, relativePath), 'utf8').toLowerCase();
    for (const term of bannedTerms) {
      check(!content.includes(term.toLowerCase()), `${relativePath} contains forbidden hard-coded term: ${term}`);
    }
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-test-runner-'));
try {
  stageFixtureFiles(tempRoot);

  const passParsed = parseAtomicSpecFile(fixture.passCase.specPath, { cwd: tempRoot });
  check(passParsed.ok === true, 'pass fixture spec must parse before running tests');
  const passResult = runAtomicTestRunner(passParsed.normalizedModel!, {
    repositoryRoot: tempRoot,
    now: fixture.generatedAt
  });
  check(passResult.ok === true, 'pass fixture must succeed');
  check(passResult.exitCode === fixture.passCase.expectedExitCode, 'pass fixture exit code mismatch');
  check(passResult.reportPath.endsWith(fixture.passCase.expectedReportPath), 'pass fixture must default report path under atom workbench folder');
  check(path.basename(path.dirname(passResult.reportPath)) === passParsed.normalizedModel!.identity.atomId, 'pass fixture report folder must equal the Atomic ID exactly');
  check(existsSync(path.join(tempRoot, fixture.passCase.expectedReportPath)), 'pass fixture report file must be written');
  check(passResult.report.runnerContract.executionMode === 'delegated', 'runner contract must stay delegated');
  check(passResult.report.results[0]?.command === fixture.passCase.expectedCommand, 'pass fixture command must be preserved exactly');
  check(passResult.report.results[0]?.stdout.includes(fixture.passCase.expectedStdoutSnippet), 'pass fixture stdout evidence missing');
  check(passResult.report.metrics?.latency === passResult.report.summary.durationMs, 'pass fixture metrics latency must mirror summary duration');
  check(passResult.report.metrics?.errorRate === 0, 'pass fixture metrics must report zero error rate');
  check(passResult.report.metrics?.coverage === null, 'pass fixture metrics coverage must default to null when not provided');
  check(passResult.report.metrics?.edgeCaseCount === 0, 'pass fixture metrics edgeCaseCount must default to zero');
  check(validateAtomicTestReportDocument(passResult.report).ok === true, 'pass fixture report must validate against schema');

  const failParsed = parseAtomicSpecFile(fixture.failCase.specPath, { cwd: tempRoot });
  check(failParsed.ok === true, 'fail fixture spec must parse before running tests');
  const failResult = runAtomicTestRunner(failParsed.normalizedModel!, {
    repositoryRoot: tempRoot,
    reportPath: fixture.failCase.customReportPath,
    now: fixture.generatedAt
  });
  check(failResult.ok === false, 'fail fixture must fail overall result');
  check(failResult.exitCode === fixture.failCase.expectedExitCode, 'fail fixture must preserve non-zero exit code');
  check(failResult.report.results[0]?.exitCode === fixture.failCase.expectedExitCode, 'fail fixture command result must preserve non-zero exit code');
  check(failResult.report.summary.failed === 1, 'fail fixture must count one failed command');
  check(failResult.report.results[0]?.stderr.includes(fixture.failCase.expectedStderrSnippet), 'fail fixture stderr evidence missing');
  check(failResult.reportPath.endsWith(fixture.failCase.customReportPath), 'custom report path must be honored');
  check(existsSync(path.join(tempRoot, fixture.failCase.customReportPath)), 'custom report path file must be written');
  check(failResult.report.metrics?.latency === failResult.report.summary.durationMs, 'fail fixture metrics latency must mirror summary duration');
  check(failResult.report.metrics?.errorRate === 1, 'fail fixture metrics must report full error rate for a single failing command');
  check(failResult.report.metrics?.coverage === null, 'fail fixture metrics coverage must default to null when not provided');
  check(failResult.report.metrics?.edgeCaseCount === 0, 'fail fixture metrics edgeCaseCount must default to zero');
  check(validateAtomicTestReportDocument(failResult.report).ok === true, 'fail fixture report must still validate against schema');

  assertProtectedFilesStayNeutral();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[test-runner:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}
