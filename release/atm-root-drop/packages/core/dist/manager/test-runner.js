import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultTestReportFileName, resolveAtomicTestReportPath } from './atom-space.js';
import { createTestReportMetrics } from '../test-runner/metrics-collector.js';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);
export const defaultTestReportSchemaPath = path.join(repoRoot, 'schemas', 'test-report.schema.json');
export const defaultTestReportMetricsSchemaPath = path.join(repoRoot, 'schemas', 'test-report', 'metrics.schema.json');
export const defaultTestReportMigration = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'Initial alpha0 test runner report.'
});
export { defaultTestReportFileName, resolveAtomicTestReportPath };
export function resolveAtomicTestRunnerConfigPath(specPath) {
    if (!specPath)
        return null;
    const absoluteSpecPath = path.resolve(specPath);
    if (absoluteSpecPath.endsWith('.atom.json')) {
        return absoluteSpecPath.slice(0, -'.atom.json'.length) + '.test-runner.json';
    }
    const ext = path.extname(absoluteSpecPath);
    if (!ext)
        return `${absoluteSpecPath}.test-runner.json`;
    return absoluteSpecPath.slice(0, -ext.length) + '.test-runner.json';
}
export function loadAtomicTestRunnerConfig(configPath) {
    if (!configPath)
        return null;
    const absolutePath = path.resolve(configPath);
    if (!existsSync(absolutePath))
        return null;
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
}
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
export async function runAtomicTestRunnerExtended(normalizedModel, options = {}) {
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
        plugins
    });
    const executeCommand = options.executeCommand ?? defaultExecuteCommand;
    const commandResults = contractData.commands.map((commandContract) => {
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
export function createAtomicTestReport(normalizedModel, options = {}) {
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
            commandCount: runnerContract.commands.length
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
export function validateAtomicTestReportDocument(reportDocument, options = {}) {
    const schemaPath = path.resolve(options.schemaPath ?? defaultTestReportSchemaPath);
    let ajv;
    try {
        let Ajv2020, addFormats;
        try {
            Ajv2020 = require('ajv/dist/2020.js');
            addFormats = require('ajv-formats');
        }
        catch {
            const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
            Ajv2020 = cwdRequire('ajv/dist/2020.js');
            addFormats = cwdRequire('ajv-formats');
        }
        const AjvConstructor = Ajv2020.default ?? Ajv2020;
        const addFormatsPlugin = addFormats.default ?? addFormats;
        ajv = new AjvConstructor({ allErrors: true, strict: false });
        addFormatsPlugin(ajv);
        ajv.addSchema(JSON.parse(readFileSync(defaultTestReportMetricsSchemaPath, 'utf8')));
    }
    catch (error) {
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
async function createExtendedRunnerContract(normalizedModel, options) {
    const includeLegacyCommands = options.runnerConfig?.legacyValidation?.includeCommands !== false;
    const legacyCommands = includeLegacyCommands
        ? createAtomicTestRunnerContract(normalizedModel).commands
        : [];
    const pluginRuns = [];
    const pluginCommands = [];
    for (const plugin of options.plugins ?? []) {
        const support = plugin.supports?.({
            repositoryRoot: options.repositoryRoot,
            specPath: normalizedModel.source?.specPath ?? null,
            atomId: normalizedModel.identity.atomId,
            normalizedModel
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
            normalizedModel
        });
        const commands = (plan.commands ?? []).map((entry) => ({
            ...entry,
            required: entry.required !== false
        }));
        pluginRuns.push({
            pluginId: plugin.pluginId,
            status: commands.length > 0 ? 'planned' : 'not_applicable',
            commandCount: commands.length,
            suites: plan.suites ?? [],
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
            commands: [...legacyCommands, ...pluginCommands],
            plugins: pluginRuns,
            gates: describeConfiguredGates(options.runnerConfig?.defaultGates ?? null)
        }
    };
}
async function loadConfiguredPlugins(references, configPath) {
    const plugins = [];
    for (const reference of references) {
        const baseDir = configPath ? path.dirname(configPath) : process.cwd();
        const modulePath = path.isAbsolute(reference.module)
            ? reference.module
            : path.resolve(baseDir, reference.module);
        const imported = await import(pathToFileURL(modulePath).href);
        const plugin = (imported.default ?? imported.testRunnerPlugin ?? imported.plugin);
        if (plugin) {
            plugins.push(plugin);
        }
    }
    return plugins;
}
function describeConfiguredGates(defaultGates) {
    const entries = [];
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
function runDefaultGateSuite(defaultGates, options) {
    if (!defaultGates)
        return [];
    const results = [];
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
function runImmutabilityGate(config, repositoryRoot) {
    const beforePath = path.resolve(repositoryRoot, config.beforePath);
    const afterPath = path.resolve(repositoryRoot, config.afterPath);
    const before = readFileSync(beforePath, 'utf8');
    const after = readFileSync(afterPath, 'utf8');
    const mutated = before !== after;
    const status = config.allowMutation === true
        ? 'not_applicable'
        : mutated ? 'failed' : 'passed';
    return {
        gateId: 'immutability',
        status,
        blocking: config.blocking !== false,
        summary: mutated
            ? 'Input snapshot changed between before/after fixtures.'
            : 'Input snapshot remained unchanged.'
    };
}
function runSideEffectGate(config, repositoryRoot) {
    const beforeDir = path.resolve(repositoryRoot, config.beforeDir);
    const afterDir = path.resolve(repositoryRoot, config.afterDir);
    const observed = uniqueRelativeFiles(beforeDir, afterDir);
    const changed = observed.filter((relativePath) => readComparableFile(path.join(beforeDir, relativePath)) !== readComparableFile(path.join(afterDir, relativePath)));
    const expectedChanged = new Set(config.expectedChanged ?? []);
    const forbiddenChanged = new Set(config.forbiddenChanged ?? []);
    const missingExpected = [...expectedChanged].filter((entry) => !changed.includes(entry));
    const violatedForbidden = changed.filter((entry) => forbiddenChanged.has(entry));
    const status = missingExpected.length === 0 && violatedForbidden.length === 0 ? 'passed' : 'failed';
    return {
        gateId: 'side-effects',
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
function runConsumerContractGate(config, repositoryRoot) {
    const failures = config.cases.flatMap((testCase) => evaluateConsumerContractCase(testCase, repositoryRoot));
    return {
        gateId: 'consumer-contract',
        status: failures.length === 0 ? 'passed' : 'failed',
        blocking: config.blocking !== false,
        summary: failures.length === 0
            ? 'Consumer contract fixtures matched expected outputs.'
            : 'Consumer contract fixtures detected caller-visible drift.',
        failures
    };
}
function evaluateConsumerContractCase(testCase, repositoryRoot) {
    const actualPath = path.resolve(repositoryRoot, testCase.actualPath);
    const expectedPath = path.resolve(repositoryRoot, testCase.expectedPath);
    const actual = readFileSync(actualPath, 'utf8');
    const expected = readFileSync(expectedPath, 'utf8');
    const comparator = testCase.comparator ?? 'json-deep-equal';
    let passed = false;
    if (comparator === 'text-equal') {
        passed = actual === expected;
    }
    else if (comparator === 'text-contains') {
        passed = actual.includes(expected);
    }
    else {
        passed = JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(expected));
    }
    return passed ? [] : [{
            caseName: testCase.name,
            comparator,
            actualPath: toPortablePath(actualPath),
            expectedPath: toPortablePath(expectedPath)
        }];
}
function uniqueRelativeFiles(beforeDir, afterDir) {
    return [...new Set([
            ...listRelativeFiles(beforeDir),
            ...listRelativeFiles(afterDir)
        ])].sort((a, b) => a.localeCompare(b));
}
function listRelativeFiles(root, prefix = '') {
    if (!existsSync(root))
        return [];
    const files = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolutePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...listRelativeFiles(absolutePath, relativePath));
        }
        else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files;
}
function readComparableFile(filePath) {
    return existsSync(filePath) && statSync(filePath).isFile()
        ? readFileSync(filePath, 'utf8')
        : null;
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
