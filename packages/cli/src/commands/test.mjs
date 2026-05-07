import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAtomicSpecFile } from '../../../core/src/spec/parse-spec.mjs';
import { runAtomicTestRunner } from '../../../core/src/manager/test-runner.mjs';
import { runMapIntegrationTest } from '../../../core/src/test-runner/map-integration.ts';
import { runPropagationIntegration } from '../../../core/src/test-runner/propagation.ts';
import { CliError, makeResult, message, parseOptions, relativePathFrom } from './shared.mjs';
import { runValidate } from './validate.mjs';

const helloWorldSpecPath = path.join('examples', 'hello-world', 'atoms', 'hello-world.atom.json');
const helloWorldSourcePath = path.join('examples', 'hello-world', 'src', 'hello-world.atom.mjs');

export async function runHelloWorldSmoke(cwd) {
  const specPath = path.join(cwd, helloWorldSpecPath);
  const sourcePath = path.join(cwd, helloWorldSourcePath);
  const checks = [];

  checks.push({ name: 'spec-exists', passed: existsSync(specPath) });
  checks.push({ name: 'source-exists', passed: existsSync(sourcePath) });

  const validation = runValidate(['--cwd', cwd, '--spec', specPath]);
  checks.push({ name: 'spec-validates', passed: validation.ok === true });

  let smokeResult = null;
  if (existsSync(sourcePath)) {
    const module = await import(`${pathToFileURL(sourcePath).href}?selfHostSmoke=${Date.now()}`);
    smokeResult = module.run({ name: 'ATM' });
  }
  checks.push({ name: 'message-output', passed: smokeResult?.message === 'Hello, ATM!' });
  checks.push({ name: 'atom-id-output', passed: smokeResult?.atomId === 'ATM-EXAMPLE-0001' });

  return {
    ok: checks.every((check) => check.passed),
    checks,
    passCount: checks.filter((check) => check.passed).length,
    total: checks.length,
    specPath: helloWorldSpecPath,
    sourcePath: helloWorldSourcePath,
    smokeResult
  };
}

export async function runTestAsync(argv) {
  const { options } = parseOptions(argv, 'test');
  const selectedModes = [options.spec, options.map, options.propagate, options.atom].filter(Boolean);
  if (selectedModes.length > 1) {
    throw new CliError('ATM_CLI_USAGE', 'test accepts only one of --spec, --map, --propagate, or --atom.', { exitCode: 2 });
  }
  if (options.spec) {
    return runSpecTest(options.cwd, options.spec);
  }
  if (options.map) {
    return runMapTest(options.cwd, options.map);
  }
  if (options.propagate) {
    return runPropagateTest(options.cwd, options.propagate);
  }
  if (options.atom !== 'hello-world') {
    throw new CliError('ATM_CLI_USAGE', 'test requires --atom hello-world, --spec <path>, --map <mapId>, or --propagate <atomId>', { exitCode: 2 });
  }
  const smoke = await runHelloWorldSmoke(options.cwd);
  return makeResult({
    ok: smoke.ok,
    command: 'test',
    cwd: options.cwd,
    messages: [
      smoke.ok
        ? message('info', 'ATM_TEST_HELLO_WORLD_OK', 'hello-world atom smoke validation passed.')
        : message('error', 'ATM_TEST_HELLO_WORLD_FAILED', 'hello-world atom smoke validation failed.', { checks: smoke.checks })
    ],
    evidence: {
      atom: options.atom,
      passCount: smoke.passCount,
      total: smoke.total,
      checks: smoke.checks,
      specPath: relativePathFrom(options.cwd, path.join(options.cwd, smoke.specPath)),
      sourcePath: relativePathFrom(options.cwd, path.join(options.cwd, smoke.sourcePath))
    }
  });
}

function runMapTest(cwd, mapId) {
  const testRun = executeMapRunner(() => runMapIntegrationTest(mapId, { repositoryRoot: cwd }));
  return makeResult({
    ok: testRun.ok,
    command: 'test',
    cwd,
    messages: [
      testRun.ok
        ? message('info', 'ATM_TEST_MAP_OK', 'Atomic map integration test passed.', { mapId })
        : message('error', 'ATM_TEST_MAP_FAILED', 'Atomic map integration test failed.', { mapId, failedDownstream: testRun.report.failedDownstream })
    ],
    evidence: {
      mapId,
      reportPath: relativePathFrom(cwd, path.join(cwd, testRun.reportPath)),
      resolutionMode: testRun.resolutionMode,
      warnings: testRun.warnings,
      specPath: testRun.report.specPath,
      testPath: testRun.report.testPath,
      perMapStatus: testRun.report.perMapStatus,
      failedDownstream: testRun.report.failedDownstream,
      propagationDuration: testRun.report.propagationDuration,
      metrics: testRun.report.metrics
    }
  });
}

function runPropagateTest(cwd, atomId) {
  const propagation = executeMapRunner(() => runPropagationIntegration(atomId, { repositoryRoot: cwd }));
  const infoCode = propagation.ok ? 'ATM_TEST_PROPAGATE_OK' : 'ATM_TEST_PROPAGATE_FAILED';
  const infoText = propagation.ok
    ? (propagation.discoveredMaps.length > 0
      ? 'Atomic map propagation test passed for all downstream maps.'
      : 'No downstream maps referenced this atom; propagation check completed with no work.')
    : 'Atomic map propagation test failed for one or more downstream maps.';
  return makeResult({
    ok: propagation.ok,
    command: 'test',
    cwd,
    messages: [message(propagation.ok ? 'info' : 'error', infoCode, infoText, { atomId, failedDownstream: propagation.failedDownstream })],
    evidence: {
      atomId,
      discoveredMaps: propagation.discoveredMaps,
      perMapStatus: propagation.perMapStatus,
      failedDownstream: propagation.failedDownstream,
      propagationDuration: propagation.propagationDuration,
      metrics: propagation.metrics,
      summary: propagation.summary
    }
  });
}

function executeMapRunner(callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error && typeof error === 'object' && 'code' in error) {
      throw new CliError(error.code, error.message ?? 'Map test runner failed.', {
        details: error.details ?? {}
      });
    }
    throw error;
  }
}

function runSpecTest(cwd, specPath) {
  const parsed = parseAtomicSpecFile(specPath, { cwd });
  if (!parsed.ok) {
    return makeResult({
      ok: false,
      command: 'test',
      cwd,
      messages: [message('error', parsed.promptReport.code, parsed.promptReport.summary, { issues: parsed.promptReport.issues })],
      evidence: {
        specPath,
        validated: []
      }
    });
  }

  const testRun = runAtomicTestRunner(parsed.normalizedModel, { repositoryRoot: cwd });
  return makeResult({
    ok: testRun.ok,
    command: 'test',
    cwd,
    messages: [
      testRun.ok
        ? message('info', 'ATM_TEST_SPEC_OK', 'Atomic spec validation commands passed.', { atomId: testRun.atomId })
        : message('error', 'ATM_TEST_SPEC_FAILED', 'Atomic spec validation commands failed.', { atomId: testRun.atomId })
    ],
    evidence: {
      atomId: testRun.atomId,
      specPath: relativePathFrom(cwd, path.resolve(cwd, specPath)),
      reportPath: relativePathFrom(cwd, testRun.reportPath),
      exitCode: testRun.exitCode,
      commands: testRun.commandResults.map((entry) => ({
        commandId: entry.commandId,
        command: entry.command,
        ok: entry.ok,
        exitCode: entry.exitCode
      }))
    }
  });
}
