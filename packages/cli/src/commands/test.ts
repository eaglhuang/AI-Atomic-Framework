import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAtomicSpecFile } from '../../../core/src/spec/parse-spec.ts';
import { runAtomicTestRunner } from '../../../core/src/manager/test-runner.ts';
import { runMapEquivalence } from '../../../core/src/equivalence/run-map-equivalence.ts';
import { runMapIntegrationTest } from '../../../core/src/test-runner/map-integration.ts';
import { createPropagationReport, runPropagationIntegration } from '../../../core/src/test-runner/propagation.ts';
import { CliError, makeResult, message, parseOptions, quoteCliValue, relativePathFrom } from './shared.ts';
import { runValidate } from './validate.ts';

const helloWorldSpecPath = path.join('examples', 'hello-world', 'atoms', 'hello-world.atom.json');
const helloWorldSourcePath = path.join('examples', 'hello-world', 'src', 'hello-world.atom.ts');

export async function runHelloWorldSmoke(cwd: any) {
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

export async function runTestAsync(argv: any) {
  const { options } = parseOptions(argv, 'test');
  const selectedModes = [options.spec, options.map, options.propagate, options.atom].filter(Boolean);
  if (selectedModes.length > 1) {
    throw new CliError('ATM_CLI_USAGE', 'test accepts only one of --spec, --map, --propagate, or --atom.', { exitCode: 2 });
  }
  if (options.equivalenceFixtures && !options.map) {
    throw new CliError('ATM_CLI_USAGE', 'test option --equivalence-fixtures must be paired with --map.', { exitCode: 2 });
  }
  if (options.spec) {
    return runSpecTest(options.cwd, options.spec);
  }
  if (options.map) {
    return runMapTest(options.cwd, options.map, options.equivalenceFixtures);
  }
  if (options.propagate) {
    return runPropagateTest(options.cwd, options.propagate);
  }
  if (options.atom !== 'hello-world') {
    throw new CliError('ATM_CLI_USAGE', 'test requires --atom hello-world, --spec <path>, --map <mapId>, or --propagate <atomId>; --equivalence-fixtures must be paired with --map.', { exitCode: 2 });
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

async function runMapTest(cwd: any, mapId: any, equivalenceFixtures?: any) {
  if (equivalenceFixtures) {
    const testRun = await executeMapRunner(() => runMapEquivalence(mapId, equivalenceFixtures, { repositoryRoot: cwd }));
    return makeResult({
      ok: testRun.ok,
      command: 'test',
      cwd,
      messages: [
        testRun.ok
          ? message('info', 'ATM_TEST_MAP_EQUIVALENCE_OK', 'Atomic map equivalence test passed.', { mapId, acceptedKnownDivergenceIds: testRun.acceptedKnownDivergenceIds })
          : message('error', 'ATM_TEST_MAP_EQUIVALENCE_FAILED', 'Atomic map equivalence test failed.', { mapId, failedCaseIds: testRun.failedCaseIds })
      ],
      evidence: {
        mapId,
        fixturePath: testRun.fixturePath,
        reportPath: testRun.reportPath,
        nextActionHint: testRun.ok ? buildMapEquivalenceNextActionHint(cwd, mapId, testRun.reportPath) : null,
        resolutionMode: testRun.resolutionMode,
        warnings: testRun.warnings,
        legacyUris: testRun.legacyUris,
        acceptedKnownDivergenceIds: testRun.acceptedKnownDivergenceIds,
        failedCaseIds: testRun.failedCaseIds,
        summary: testRun.report.summary,
        metrics: testRun.report.metrics,
        cases: testRun.report.cases,
        knownDivergences: testRun.report.knownDivergences ?? [],
        passed: testRun.report.passed
      }
    });
  }
  const testRun = await executeMapRunner(() => runMapIntegrationTest(mapId, { repositoryRoot: cwd }));
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
      nextActionHint: testRun.ok ? buildMapIntegrationNextActionHint(cwd, mapId, testRun.reportPath) : null,
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

function buildMapIntegrationNextActionHint(cwd: string, mapId: string, reportPath: string) {
  const relativeReportPath = relativePathFrom(cwd, path.join(cwd, reportPath));
  return {
    status: 'ready',
    route: 'replacement-lane-shadow',
    reason: 'Integration evidence is ready; promote the replacement lane to shadow.',
    command: `node atm.mjs replacement-lane transition --cwd ${quoteCliValue(cwd)} --map ${quoteCliValue(mapId)} --to shadow --evidence ${quoteCliValue(relativeReportPath)} --json`,
    consumesEvidenceKind: 'map-integration'
  };
}

function buildMapEquivalenceNextActionHint(cwd: string, mapId: string, reportPath: string) {
  const relativeReportPath = relativePathFrom(cwd, path.join(cwd, reportPath));
  return {
    status: 'ready',
    route: 'replacement-lane-canary',
    reason: 'Equivalence evidence is ready; promote the replacement lane to canary or feed it into map upgrade review.',
    command: `node atm.mjs replacement-lane transition --cwd ${quoteCliValue(cwd)} --map ${quoteCliValue(mapId)} --to canary --evidence ${quoteCliValue(relativeReportPath)} --json`,
    consumesEvidenceKind: 'map-equivalence'
  };
}

async function runPropagateTest(cwd: any, atomId: any) {
  const propagation = await executeMapRunner(() => runPropagationIntegration(atomId, { repositoryRoot: cwd }));
  const propagationReport = createPropagationReport(propagation, { atomId });
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
      summary: propagation.summary,
      propagationReport
    }
  });
}

async function executeMapRunner(callback: any) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error && typeof error === 'object' && 'code' in error) {
      const typedError = error as { code: string; message?: string; details?: Record<string, unknown> };
      throw new CliError(typedError.code, typedError.message ?? 'Map test runner failed.', {
        details: typedError.details ?? {}
      });
    }
    throw error;
  }
}

function runSpecTest(cwd: any, specPath: any) {
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

  const testRun = runAtomicTestRunner(parsed.normalizedModel!, { repositoryRoot: cwd });
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
      commands: testRun.commandResults.map((entry: any) => ({
        commandId: entry.commandId,
        command: entry.command,
        ok: entry.ok,
        exitCode: entry.exitCode
      }))
    }
  });
}
