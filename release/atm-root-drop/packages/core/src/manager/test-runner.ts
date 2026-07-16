import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.ts';
import {
  createAtomicTestReport,
  createAtomicTestRunnerContract,
  defaultTestReportMetricsSchemaPath,
  defaultTestReportMigration,
  defaultTestReportSchemaPath,
  normalizeDuration,
  normalizeExitCode,
  normalizeText,
  toPortablePath,
  validateAtomicTestReportDocument,
  type AtomicTestReportEntry,
  type CommandResultRecord,
  type TestRunnerModel
} from './test-runner/report-support.ts';
import type {
  AtomicConsumerContractCase,
  AtomicDefaultGateConfig,
  AtomicHealthGateId,
  AtomicTestRunnerConfig,
  TestRunnerCommand,
  TestRunnerOutcomeStatus,
  TestRunnerPlugin,
  TestRunnerProfile,
  TestRunnerPluginReference
} from '../../../plugin-sdk/src/test-runner.ts';

export { defaultTestReportFileName, resolveAtomicTestReportPath };
export {
  createAtomicTestReport,
  createAtomicTestRunnerContract,
  defaultTestReportMetricsSchemaPath,
  defaultTestReportMigration,
  defaultTestReportSchemaPath,
  validateAtomicTestReportDocument
};

export function resolveAtomicTestRunnerConfigPath(specPath: string | null) {
  if (!specPath) return null;
  const absoluteSpecPath = path.resolve(specPath);
  if (absoluteSpecPath.endsWith('.atom.json')) {
    return absoluteSpecPath.slice(0, -'.atom.json'.length) + '.test-runner.json';
  }
  const ext = path.extname(absoluteSpecPath);
  if (!ext) return `${absoluteSpecPath}.test-runner.json`;
  return absoluteSpecPath.slice(0, -ext.length) + '.test-runner.json';
}

export function loadAtomicTestRunnerConfig(configPath: string | null) {
  if (!configPath) return null;
  const absolutePath = path.resolve(configPath);
  if (!existsSync(absolutePath)) return null;
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as AtomicTestRunnerConfig;
}

interface ExecuteCommandOutcome {
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  signal?: string | null;
}

interface BasicRunnerOptions {
  repositoryRoot?: string;
  reportPath?: string;
  workbenchPath?: string;
  workbenchRoot?: string;
  now?: string;
  schemaPath?: string;
  writeReport?: boolean;
  executeCommand?: (command: string, context: Record<string, unknown>) => ExecuteCommandOutcome;
  runnerConfigPath?: string;
  runnerConfig?: AtomicTestRunnerConfig | null;
  profile?: unknown;
  suite?: unknown;
  [key: string]: unknown;
}

export function runAtomicTestRunner(normalizedModel: TestRunnerModel | null, options: BasicRunnerOptions = {}) {
  if (!normalizedModel) {
    throw new Error('Normalized model is required.');
  }
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
  const results: CommandResultRecord[] = runnerContract.commands.map((commandContract) => {
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

export async function runAtomicTestRunnerExtended(normalizedModel: TestRunnerModel | null, options: BasicRunnerOptions = {}) {
  if (!normalizedModel) {
    throw new Error('Normalized model is required.');
  }
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const configPath = options.runnerConfigPath
    ? path.resolve(options.runnerConfigPath)
    : resolveAtomicTestRunnerConfigPath(normalizedModel.source?.specPath ?? null);
  const runnerConfig = options.runnerConfig ?? loadAtomicTestRunnerConfig(configPath);
  const plugins = await loadConfiguredPlugins(runnerConfig?.plugins ?? [], configPath);
  const reportPath = resolveAtomicTestReportPath(normalizedModel, {
    repositoryRoot,
    reportPath: options.reportPath,
    workbenchPath: options.workbenchPath,
    workbenchRoot: options.workbenchRoot
  });
  const generatedAt = options.now ?? new Date().toISOString();
  const contractData = await createExtendedRunnerContract(normalizedModel, {
    repositoryRoot,
    runnerConfig,
    plugins,
    profile: normalizeRunnerProfile(options.profile),
    suite: normalizeSuiteOption(options.suite)
  });
  const executeCommand = options.executeCommand ?? defaultExecuteCommand;
  const commandResults: CommandResultRecord[] = contractData.commands.map((commandContract) => {
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
  const gateResults = runDefaultGateSuite(runnerConfig?.defaultGates ?? null, {
    repositoryRoot
  });
  const report = createAtomicTestReport(normalizedModel, {
    repositoryRoot,
    generatedAt,
    reportPath,
    runnerContract: contractData.runnerContract,
    results: commandResults,
    pluginRuns: contractData.pluginRuns,
    gateResults
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
    runnerContract: contractData.runnerContract,
    commandResults,
    pluginRuns: contractData.pluginRuns,
    gateResults,
    report,
    reportValidation,
    runnerConfigPath: configPath ? toPortablePath(configPath) : null
  };
}

function defaultExecuteCommand(command: string, context: { repositoryRoot: string; [key: string]: unknown }) {
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

async function createExtendedRunnerContract(normalizedModel: TestRunnerModel, options: {
  repositoryRoot: string;
  runnerConfig?: AtomicTestRunnerConfig | null;
  plugins?: TestRunnerPlugin[];
  profile?: TestRunnerProfile;
  suite?: string | null;
}) {
  const includeLegacyCommands = options.runnerConfig?.legacyValidation?.includeCommands !== false;
  const legacyCommands = includeLegacyCommands
    ? createAtomicTestRunnerContract(normalizedModel).commands
    : [];
  const pluginRuns: Array<Record<string, unknown>> = [];
  const pluginCommands: TestRunnerCommand[] = [];
  for (const plugin of options.plugins ?? []) {
    const support = plugin.supports?.({
      repositoryRoot: options.repositoryRoot,
      specPath: normalizedModel.source?.specPath ?? null,
      atomId: normalizedModel.identity.atomId,
      normalizedModel,
      profile: options.profile,
      suite: options.suite
    });
    const supported = typeof support === 'boolean'
      ? support
      : support?.supported !== false;
    const reason = typeof support === 'boolean'
      ? null
      : support?.reason ?? null;
    if (!supported) {
      pluginRuns.push({
        pluginId: plugin.pluginId,
        status: 'skipped',
        reason
      });
      continue;
    }
    const plan = await plugin.plan({
      repositoryRoot: options.repositoryRoot,
      specPath: normalizedModel.source?.specPath ?? null,
      atomId: normalizedModel.identity.atomId,
      normalizedModel,
      profile: options.profile,
      suite: options.suite,
      pluginOptions: (options.runnerConfig?.plugins ?? []).find((reference) => reference.pluginId === plugin.pluginId)?.options
    });
    const commands = filterPluginCommands(plan.commands ?? [], {
      profile: options.profile,
      suite: options.suite
    }).map((entry) => ({
      ...entry,
      required: entry.required !== false
    }));
    pluginRuns.push({
      pluginId: plugin.pluginId,
      status: commands.length > 0 ? 'planned' : 'not_applicable',
      commandCount: commands.length,
      suites: plan.suites ?? [],
      requestedProfile: options.profile ?? null,
      requestedSuite: options.suite ?? null,
      family: plan.family ?? null,
      dedupeKeys: plan.dedupeKeys ?? [],
      costBudgetMs: plan.costBudgetMs ?? null,
      evidenceSummary: plan.evidenceSummary ?? null
    });
    pluginCommands.push(...commands);
  }

  return {
    commands: [...legacyCommands, ...pluginCommands],
    pluginRuns,
    runnerContract: {
      executionMode: 'delegated',
      evidenceRequired: normalizedModel.execution.validation.evidenceRequired === true,
      profile: options.profile ?? 'standard',
      suite: options.suite ?? null,
      commands: [...legacyCommands, ...pluginCommands],
      plugins: pluginRuns,
      gates: describeConfiguredGates(options.runnerConfig?.defaultGates ?? null)
    }
  };
}

function filterPluginCommands(commands: TestRunnerCommand[], options: { profile?: TestRunnerProfile; suite?: string | null }) {
  return commands.filter((command) => {
    if (options.profile && Array.isArray(command.tiers) && command.tiers.length > 0 && !command.tiers.includes(options.profile)) {
      return false;
    }
    if (options.suite) {
      const suite = String(command.suite ?? command.family ?? command.key ?? '');
      if (suite !== options.suite) return false;
    }
    return true;
  });
}

function normalizeRunnerProfile(value: unknown): TestRunnerProfile {
  const text = String(value ?? '').toLowerCase();
  if (text === 'quick' || text === 'standard' || text === 'full') {
    return text;
  }
  return 'standard';
}

function normalizeSuiteOption(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

async function loadConfiguredPlugins(references: TestRunnerPluginReference[], configPath: string | null) {
  const plugins: TestRunnerPlugin[] = [];
  for (const reference of references) {
    const baseDir = configPath ? path.dirname(configPath) : process.cwd();
    const modulePath = path.isAbsolute(reference.module)
      ? reference.module
      : path.resolve(baseDir, reference.module);
    const imported = await import(pathToFileURL(modulePath).href);
    const plugin = (imported.default ?? imported.testRunnerPlugin ?? imported.plugin) as TestRunnerPlugin | undefined;
    if (plugin) {
      plugins.push(plugin);
    }
  }
  return plugins;
}

function describeConfiguredGates(defaultGates: AtomicDefaultGateConfig | null) {
  const entries: Array<Record<string, unknown>> = [];
  if (defaultGates?.immutability) {
    entries.push({ gateId: 'immutability', blocking: defaultGates.immutability.blocking !== false });
  }
  if (defaultGates?.sideEffects) {
    entries.push({ gateId: 'side-effects', blocking: defaultGates.sideEffects.blocking !== false });
  }
  if (defaultGates?.consumerContract) {
    entries.push({ gateId: 'consumer-contract', blocking: defaultGates.consumerContract.blocking !== false });
  }
  return entries;
}

function runDefaultGateSuite(defaultGates: AtomicDefaultGateConfig | null, options: { repositoryRoot: string }) {
  if (!defaultGates) return [];
  const results: Array<Record<string, unknown>> = [];
  if (defaultGates.immutability) {
    results.push(runImmutabilityGate(defaultGates.immutability, options.repositoryRoot));
  }
  if (defaultGates.sideEffects) {
    results.push(runSideEffectGate(defaultGates.sideEffects, options.repositoryRoot));
  }
  if (defaultGates.consumerContract) {
    results.push(runConsumerContractGate(defaultGates.consumerContract, options.repositoryRoot));
  }
  return results;
}

function runImmutabilityGate(config: NonNullable<AtomicDefaultGateConfig['immutability']>, repositoryRoot: string) {
  const beforePath = path.resolve(repositoryRoot, config.beforePath);
  const afterPath = path.resolve(repositoryRoot, config.afterPath);
  const before = readFileSync(beforePath, 'utf8');
  const after = readFileSync(afterPath, 'utf8');
  const mutated = before !== after;
  const status: TestRunnerOutcomeStatus = config.allowMutation === true
    ? 'not_applicable'
    : mutated ? 'failed' : 'passed';
  return {
    gateId: 'immutability' satisfies AtomicHealthGateId,
    status,
    blocking: config.blocking !== false,
    summary: mutated
      ? 'Input snapshot changed between before/after fixtures.'
      : 'Input snapshot remained unchanged.'
  };
}

function runSideEffectGate(config: NonNullable<AtomicDefaultGateConfig['sideEffects']>, repositoryRoot: string) {
  const beforeDir = path.resolve(repositoryRoot, config.beforeDir);
  const afterDir = path.resolve(repositoryRoot, config.afterDir);
  const observed = uniqueRelativeFiles(beforeDir, afterDir);
  const changed = observed.filter((relativePath) => readComparableFile(path.join(beforeDir, relativePath)) !== readComparableFile(path.join(afterDir, relativePath)));
  const expectedChanged = new Set(config.expectedChanged ?? []);
  const forbiddenChanged = new Set(config.forbiddenChanged ?? []);
  const missingExpected = [...expectedChanged].filter((entry) => !changed.includes(entry));
  const violatedForbidden = changed.filter((entry) => forbiddenChanged.has(entry));
  const status: TestRunnerOutcomeStatus = missingExpected.length === 0 && violatedForbidden.length === 0 ? 'passed' : 'failed';
  return {
    gateId: 'side-effects' satisfies AtomicHealthGateId,
    status,
    blocking: config.blocking !== false,
    changedPaths: changed,
    summary: status === 'passed'
      ? 'Observed side effects matched the declared fixture expectations.'
      : 'Observed side effects drifted from the declared fixture expectations.',
    failures: {
      missingExpected,
      violatedForbidden
    }
  };
}

function runConsumerContractGate(config: NonNullable<AtomicDefaultGateConfig['consumerContract']>, repositoryRoot: string) {
  const failures = config.cases.flatMap((testCase) => evaluateConsumerContractCase(testCase, repositoryRoot));
  return {
    gateId: 'consumer-contract' satisfies AtomicHealthGateId,
    status: failures.length === 0 ? 'passed' : 'failed',
    blocking: config.blocking !== false,
    summary: failures.length === 0
      ? 'Consumer contract fixtures matched expected outputs.'
      : 'Consumer contract fixtures detected caller-visible drift.',
    failures
  };
}

function evaluateConsumerContractCase(testCase: AtomicConsumerContractCase, repositoryRoot: string) {
  const actualPath = path.resolve(repositoryRoot, testCase.actualPath);
  const expectedPath = path.resolve(repositoryRoot, testCase.expectedPath);
  const actual = readFileSync(actualPath, 'utf8');
  const expected = readFileSync(expectedPath, 'utf8');
  const comparator = testCase.comparator ?? 'json-deep-equal';
  let passed = false;
  if (comparator === 'text-equal') {
    passed = actual === expected;
  } else if (comparator === 'text-contains') {
    passed = actual.includes(expected);
  } else {
    passed = JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(expected));
  }
  return passed ? [] : [{
    caseName: testCase.name,
    comparator,
    actualPath: toPortablePath(actualPath),
    expectedPath: toPortablePath(expectedPath)
  }];
}

function uniqueRelativeFiles(beforeDir: string, afterDir: string) {
  return [...new Set([
    ...listRelativeFiles(beforeDir),
    ...listRelativeFiles(afterDir)
  ])].sort((a, b) => a.localeCompare(b));
}

function listRelativeFiles(root: string, prefix = ''): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function readComparableFile(filePath: string) {
  return existsSync(filePath) && statSync(filePath).isFile()
    ? readFileSync(filePath, 'utf8')
    : null;
}
