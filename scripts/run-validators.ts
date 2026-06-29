import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyBaselineFailureSnapshot,
  collectBaselineFindingFingerprints,
  createValidatorFailureEnvelope,
  firstRequiredCommand,
  summarizeBlockingFindings
} from './lib/validator-envelope.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'scripts', 'validators.config.json');
if (!existsSync(configPath)) {
  throw new Error(`validators config missing: ${path.relative(root, configPath)}`);
}
const config: any = JSON.parse(readFileSync(configPath, 'utf8'));
const validatorMap = new Map(config.validators.map((entry: any) => [entry.name, entry]));
const DEFAULT_FAST_VALIDATOR_BUDGET_MS = 10_000;
const DEFAULT_SLOW_VALIDATOR_BUDGET_MS = 90_000;

const parsedCli = parseCliArgs(process.argv.slice(2));
const profileConfig = resolveProfileConfig(parsedCli.profile);
const parallel = resolveParallelSetting(parsedCli, profileConfig);
const selectedNames = applyFilters(resolveProfileValidatorNames(parsedCli.profile), parsedCli.filters);
const baselineSummary = parsedCli.baselinePath ? readBaselineSummary(parsedCli.baselinePath) : null;
const performanceBaselineSummary = parsedCli.performanceBaselinePath ? readBaselineSummary(parsedCli.performanceBaselinePath) : null;
const baselineFingerprints = collectBaselineFindingFingerprints(baselineSummary);
const selectedValidators = selectedNames.map((name: any) => {
  const validator = validatorMap.get(name);
  if (!validator) {
    throw new Error(`Unknown validator in profile "${parsedCli.profile}": ${name}`);
  }
  return validator;
}).filter((validator: any) => parsedCli.skipSlow ? validator.slow !== true : true);

if (selectedValidators.length === 0) {
  const summary = createSummary({
    profile: parsedCli.profile,
    mode: profileConfig.mode,
    filters: parsedCli.filters,
    parallel,
    legacy: parsedCli.legacy,
    cache: parsedCli.cache,
    skipSlow: parsedCli.skipSlow,
    baselinePath: parsedCli.baselinePath,
    performanceBaselinePath: parsedCli.performanceBaselinePath,
    performanceBaselineSummary,
    performanceBudgetOverrides: {
      fastValidatorBudgetMs: parsedCli.fastValidatorBudgetMs,
      slowValidatorBudgetMs: parsedCli.slowValidatorBudgetMs
    },
    baselineFingerprintCount: baselineFingerprints.size,
    startedAt: Date.now(),
    results: []
  });
  writePerformanceOutputIfRequested(summary, parsedCli.performanceOutputPath);
  emitSummary(summary, parsedCli.json);
  process.exitCode = 0;
  process.exit();
}

const startedAt = Date.now();
const results = parallel
  ? await Promise.all(selectedValidators.map((validator: any) => runValidator(validator, profileConfig.mode, { json: parsedCli.json, cache: parsedCli.cache })))
    .then((items) => items.map((item) => markResultAgainstBaseline(item, baselineFingerprints)))
  : await runValidatorsSequential(selectedValidators, profileConfig.mode, {
      json: parsedCli.json,
      cache: parsedCli.cache,
      stopOnFailure: parsedCli.legacy,
      baselineFingerprints
    });

const summary = createSummary({
  profile: parsedCli.profile,
  mode: profileConfig.mode,
  filters: parsedCli.filters,
  parallel,
  legacy: parsedCli.legacy,
  cache: parsedCli.cache,
  skipSlow: parsedCli.skipSlow,
  baselinePath: parsedCli.baselinePath,
  performanceBaselinePath: parsedCli.performanceBaselinePath,
  performanceBaselineSummary,
  performanceBudgetOverrides: {
    fastValidatorBudgetMs: parsedCli.fastValidatorBudgetMs,
    slowValidatorBudgetMs: parsedCli.slowValidatorBudgetMs
  },
  baselineFingerprintCount: baselineFingerprints.size,
  startedAt,
  results
});
writePerformanceOutputIfRequested(summary, parsedCli.performanceOutputPath);
emitSummary(summary, parsedCli.json);
process.exitCode = summary.failed > 0 ? 1 : 0;

function parseCliArgs(argv: any) {
  const positional: string[] = [];
  const options: {
    filters: string[];
    parallel: boolean;
    json: boolean;
    legacy: boolean;
    cache: boolean;
    skipSlow: boolean;
    baselinePath: string | null;
    performanceBaselinePath: string | null;
    performanceOutputPath: string | null;
    fastValidatorBudgetMs: number | null;
    slowValidatorBudgetMs: number | null;
    serial: boolean;
  } = {
    filters: [],
    parallel: false,
    json: false,
    legacy: false,
    cache: false,
    skipSlow: false,
    baselinePath: null,
    performanceBaselinePath: null,
    performanceOutputPath: null,
    fastValidatorBudgetMs: null,
    slowValidatorBudgetMs: null,
    serial: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--filter') {
      const value = argv[index + 1];
      const valueText = String(value ?? '');
      if (!valueText || valueText.startsWith('--')) {
        throw new Error('--filter requires a value');
      }
      options.filters.push(...valueText.split(',').map((entry: any) => entry.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === '--parallel') {
      options.parallel = true;
      continue;
    }
    if (arg === '--serial') {
      options.serial = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--legacy') {
      options.legacy = true;
      continue;
    }
    if (arg === '--cache') {
      options.cache = true;
      continue;
    }
    if (arg === '--skip-slow') {
      options.skipSlow = true;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[index + 1];
      const valueText = String(value ?? '');
      if (!valueText || valueText.startsWith('--')) {
        throw new Error('--baseline requires a validator summary JSON path');
      }
      options.baselinePath = valueText;
      index += 1;
      continue;
    }
    if (arg === '--performance-baseline') {
      const value = argv[index + 1];
      const valueText = String(value ?? '');
      if (!valueText || valueText.startsWith('--')) {
        throw new Error('--performance-baseline requires a validator summary JSON path');
      }
      options.performanceBaselinePath = valueText;
      index += 1;
      continue;
    }
    if (arg === '--performance-output') {
      const value = argv[index + 1];
      const valueText = String(value ?? '');
      if (!valueText || valueText.startsWith('--')) {
        throw new Error('--performance-output requires an output JSON path');
      }
      options.performanceOutputPath = valueText;
      index += 1;
      continue;
    }
    if (arg === '--fast-validator-budget-ms') {
      options.fastValidatorBudgetMs = parsePositiveIntegerOption(argv[index + 1], '--fast-validator-budget-ms');
      index += 1;
      continue;
    }
    if (arg === '--slow-validator-budget-ms') {
      options.slowValidatorBudgetMs = parsePositiveIntegerOption(argv[index + 1], '--slow-validator-budget-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unsupported option: ${arg}`);
    }
    positional.push(arg);
  }

  return {
    profile: positional[0] ?? 'standard',
    ...options
  };
}

function resolveProfileConfig(profileName: any) {
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown validator profile: ${profileName}`);
  }
  return profile;
}

function resolveParallelSetting(parsedCli: any, profileConfig: any): boolean {
  if (parsedCli.legacy) {
    return false;
  }
  if (parsedCli.serial) {
    return false;
  }
  return parsedCli.parallel || profileConfig.parallelByDefault === true;
}

function parsePositiveIntegerOption(value: unknown, flag: string): number {
  const valueText = String(value ?? '');
  if (!valueText || valueText.startsWith('--')) {
    throw new Error(`${flag} requires a positive integer value`);
  }
  const parsed = Number(valueText);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer value`);
  }
  return parsed;
}

function resolveProfileValidatorNames(profileName: any): string[] {
  const profile = resolveProfileConfig(profileName);
  const inherited: string[] = profile.extends ? resolveProfileValidatorNames(profile.extends) : [];
  return [...new Set([...inherited, ...(profile.validators ?? [])])];
}

function applyFilters(validatorNames: any, filters: any) {
  if (!filters || filters.length === 0) {
    return validatorNames;
  }
  return validatorNames.filter((name: any) => {
    const entry: any = validatorMap.get(name);
    if (!entry) {
      return false;
    }
    return filters.some((filter: any) => {
      if (filter.startsWith('tag:')) {
        const tag = filter.slice(4).toLowerCase();
        return (entry.tags ?? []).some((candidate: any) => String(candidate).toLowerCase() === tag);
      }
      const needle = filter.toLowerCase();
      const byName = name.toLowerCase().includes(needle);
      const byTag = (entry.tags ?? []).some((candidate: any) => String(candidate).toLowerCase().includes(needle));
      return byName || byTag;
    });
  });
}

async function runValidatorsSequential(validators: any, mode: any, options: any) {
  const results: any[] = [];
  for (const validator of validators) {
    const rawResult = await runValidator(validator, mode, options);
    const result = markResultAgainstBaseline(rawResult, options.baselineFingerprints ?? new Set());
    results.push(result);
    if (options.stopOnFailure && result.ok !== true) {
      break;
    }
  }
  return results;
}

function runValidator(validator: any, mode: any, options: any): Promise<any> {
  return new Promise<any>((resolve) => {
    const startedAt = Date.now();
    const validatorPath = path.join(root, validator.entry);
    const command = `node --strip-types ${normalizeCommandPath(validator.entry)} --mode ${mode}`;
    const cacheKey = buildValidatorCacheKey(validator, mode, command, validatorPath);
    if (options.cache) {
      const cached = readValidatorCache(cacheKey);
      if (cached) {
        resolve({
          ...cached,
          cached: true,
          durationMs: 0,
          envelope: {
            ...cached.envelope,
            durationMs: 0
          }
        });
        return;
      }
    }
    let stdout = '';
    let stderr = '';
    let spawnError: string | null = null;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, ['--strip-types', validatorPath, '--mode', mode], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finalize(1, formatSpawnError(error));
      return;
    }

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      finalize(1, `${error.name}: ${error.message}`);
    });

    child.on('close', (code) => {
      finalize(code ?? 1);
    });

    function finalize(exitCode: number, immediateSpawnError: string | null = null) {
      if (settled) return;
      settled = true;
      spawnError = immediateSpawnError ?? spawnError;
      const durationMs = Date.now() - startedAt;
      const envelope = createValidatorFailureEnvelope({
        validatorName: validator.name,
        command,
        entry: validator.entry,
        mode,
        ok: exitCode === 0,
        exitCode,
        durationMs,
        stdout,
        stderr,
        spawnError
      });
      if (!options.json) {
        if (stdout) {
          process.stdout.write(stdout);
        }
        if (stderr) {
          process.stderr.write(stderr);
        }
        if (!envelope.ok) {
          process.stderr.write(`[validator-envelope:${validator.name}] ${JSON.stringify({
            requiredCommand: envelope.requiredCommand,
            blockingFindings: envelope.blockingFindings,
            repairHints: envelope.repairHints
          }, null, 2)}\n`);
        }
      }
      const result = {
        name: validator.name,
        entry: validator.entry,
        tags: validator.tags ?? [],
        slow: validator.slow === true,
        performanceBudgetMs: Number.isFinite(validator.performanceBudgetMs) ? Number(validator.performanceBudgetMs) : null,
        mode,
        ok: exitCode === 0,
        exitCode,
        durationMs,
        command,
        cacheKey,
        cached: false,
        requiredCommand: envelope.requiredCommand,
        blockingFindings: envelope.blockingFindings,
        envelope
      };
      if (options.cache && result.ok === true) {
        writeValidatorCache(cacheKey, result);
      }
      resolve(result);
    }
  });
}

function createSummary({ profile, mode, filters, parallel, legacy, cache, skipSlow, baselinePath, performanceBaselinePath, performanceBaselineSummary, performanceBudgetOverrides, baselineFingerprintCount, startedAt, results }: any) {
  const durationMs = Date.now() - startedAt;
  const passed = results.filter((entry: any) => entry.ok === true).length;
  const failed = results.length - passed;
  const envelopes = results.map((entry: any) => entry.envelope).filter(Boolean);
  const blockingFindings = summarizeBlockingFindings(envelopes);
  const baselineFailures = dedupeFindings(envelopes.flatMap((envelope: any) => envelope.baselineFailures ?? []));
  const currentTaskFailures = dedupeFindings(envelopes.flatMap((envelope: any) => envelope.currentTaskFailures ?? []));
  const environmentFindings = blockingFindings.filter(isEnvironmentFinding);
  const currentTaskFindings = currentTaskFailures.length > 0
    ? currentTaskFailures
    : blockingFindings.filter((finding: any) => !isEnvironmentFinding(finding) && !isBaselineFinding(finding));
  const performance = createPerformanceReport({
    profile,
    durationMs,
    results,
    profileConfig,
    performanceBudgetOverrides,
    performanceBaselineSummary
  });
  return {
    schemaId: 'atm.validatorRunSummary.v1',
    profile,
    mode,
    total: results.length,
    passed,
    failed,
    durationMs,
    filters,
    parallel,
    legacy,
    cache,
    skipSlow,
    baselinePath: baselinePath ?? null,
    performanceBaselinePath: performanceBaselinePath ?? null,
    baselineFingerprintCount: baselineFingerprintCount ?? 0,
    cached: results.filter((entry: any) => entry.cached === true).length,
    performance,
    requiredCommand: firstRequiredCommand(envelopes),
    blockingFindings,
    baselineFailures,
    currentTaskFailures,
    environmentFindings,
    currentTaskFindings,
    currentTaskOk: currentTaskFindings.length === 0 && environmentFindings.length === 0,
    taskLevelOk: currentTaskFindings.length === 0 && environmentFindings.length === 0,
    focusedValidatorCommand: buildFocusedValidatorCommand(results),
    validators: results
  };
}

function emitSummary(summary: any, jsonMode: any) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const status = summary.failed === 0 ? 'ok' : 'failed';
  process.stdout.write(`[validators:${summary.profile}] ${status} (passed=${summary.passed}, failed=${summary.failed}, total=${summary.total}, cached=${summary.cached}, durationMs=${summary.durationMs})\n`);
  for (const warning of summary.performance?.warnings ?? []) {
    process.stderr.write(`[validators:${summary.profile}:performance] ${warning.code} ${warning.message}\n`);
  }
}

function normalizeCommandPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function formatSpawnError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof (error as any).code === 'string'
      ? ` (${(error as any).code})`
      : '';
    return `${error.name}: ${error.message}${code}`;
  }
  return String(error);
}

function buildValidatorCacheKey(validator: any, mode: string, command: string, validatorPath: string): string {
  const fingerprint = {
    schemaId: 'atm.validatorCacheKey.v1',
    validator: validator.name,
    entry: validator.entry,
    mode,
    command,
    sourceMtimeMs: safeMtimeMs(validatorPath)
  };
  return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function validatorCachePath(cacheKey: string): string {
  return path.join(root, '.atm', 'runtime', 'validator-cache', `${cacheKey}.json`);
}

function readValidatorCache(cacheKey: string): any | null {
  const filePath = validatorCachePath(cacheKey);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const result = parsed?.schemaId === 'atm.validatorRunCache.v1' ? parsed.result ?? null : null;
    return result?.ok === true ? result : null;
  } catch {
    return null;
  }
}

function writeValidatorCache(cacheKey: string, result: any): void {
  const filePath = validatorCachePath(cacheKey);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    schemaId: 'atm.validatorRunCache.v1',
    cacheKey,
    generatedAt: new Date().toISOString(),
    result
  }, null, 2)}\n`, 'utf8');
}

function markResultAgainstBaseline(result: any, baselineFingerprints: ReadonlySet<string>): any {
  if (!result?.envelope || baselineFingerprints.size === 0) return result;
  const envelope = applyBaselineFailureSnapshot(result.envelope, baselineFingerprints);
  return {
    ...result,
    requiredCommand: envelope.requiredCommand,
    blockingFindings: envelope.blockingFindings,
    envelope
  };
}

function readBaselineSummary(baselinePath: string): unknown {
  const resolved = path.resolve(root, baselinePath);
  if (!existsSync(resolved)) {
    throw new Error(`Baseline validator summary not found: ${baselinePath}`);
  }
  return JSON.parse(readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
}

function writePerformanceOutputIfRequested(summary: any, outputPath: string | null): void {
  if (!outputPath) return;
  const resolved = path.resolve(root, outputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function createPerformanceReport({ profile, durationMs, results, profileConfig, performanceBudgetOverrides, performanceBaselineSummary }: any) {
  const budgetMs = Number.isFinite(profileConfig?.performanceBudgetMs) ? Number(profileConfig.performanceBudgetMs) : null;
  const performanceDefaults = resolvePerformanceDefaults();
  const fastValidatorBudgetMs = Number.isFinite(performanceBudgetOverrides?.fastValidatorBudgetMs)
    ? Number(performanceBudgetOverrides.fastValidatorBudgetMs)
    : performanceDefaults.fastValidatorBudgetMs;
  const slowValidatorBudgetMs = Number.isFinite(performanceBudgetOverrides?.slowValidatorBudgetMs)
    ? Number(performanceBudgetOverrides.slowValidatorBudgetMs)
    : performanceDefaults.slowValidatorBudgetMs;
  const slowestValidators = [...results]
    .sort((left: any, right: any) => Number(right.durationMs ?? 0) - Number(left.durationMs ?? 0))
    .slice(0, 10)
    .map((entry: any) => ({
      name: entry.name,
      durationMs: entry.durationMs,
      durationBudgetMs: resolveValidatorDurationBudget(entry, fastValidatorBudgetMs, slowValidatorBudgetMs),
      overBudgetMs: Math.max(0, Number(entry.durationMs ?? 0) - resolveValidatorDurationBudget(entry, fastValidatorBudgetMs, slowValidatorBudgetMs)),
      cached: entry.cached === true,
      slow: entry.slow === true,
      command: entry.command
    }));
  const baselineByName = new Map(
    Array.isArray((performanceBaselineSummary as any)?.validators)
      ? (performanceBaselineSummary as any).validators.map((entry: any) => [String(entry.name ?? ''), entry])
      : []
  );
  const warnings: any[] = [];
  if (budgetMs !== null && durationMs > budgetMs) {
    warnings.push({
      code: 'ATM_VALIDATOR_PROFILE_BUDGET_EXCEEDED',
      message: `profile ${profile} took ${durationMs}ms, over budget ${budgetMs}ms`,
      profile,
      durationMs,
      budgetMs,
      remediation: 'Inspect performance.slowestValidators and split or narrow heavyweight validators before adding more cases.'
    });
  }
  const budgetViolations = results
    .filter((entry: any) => entry.cached !== true)
    .flatMap((entry: any) => {
      const durationBudgetMs = resolveValidatorDurationBudget(entry, fastValidatorBudgetMs, slowValidatorBudgetMs);
      const durationMsValue = Number(entry.durationMs ?? 0);
      if (!Number.isFinite(durationMsValue) || durationMsValue <= durationBudgetMs) return [];
      return [{
        code: 'ATM_VALIDATOR_DURATION_BUDGET_EXCEEDED',
        validatorName: entry.name,
        durationMs: durationMsValue,
        durationBudgetMs,
        overBudgetMs: durationMsValue - durationBudgetMs,
        slow: entry.slow === true,
        command: entry.command,
        message: `${entry.name} took ${durationMsValue}ms, over budget ${durationBudgetMs}ms`,
        remediation: 'Reduce fixture scope, split broad assertions, use focused regressions, or explicitly raise the validator budget with justification.'
      }];
    });
  warnings.push(...budgetViolations);
  const regressions = results
    .filter((entry: any) => entry.cached !== true)
    .flatMap((entry: any) => {
      const baseline = baselineByName.get(String(entry.name ?? '')) as any;
      const baselineDurationMs = Number(baseline?.durationMs ?? 0);
      const currentDurationMs = Number(entry.durationMs ?? 0);
      if (!Number.isFinite(baselineDurationMs) || baselineDurationMs <= 0 || !Number.isFinite(currentDurationMs)) return [];
      const deltaMs = currentDurationMs - baselineDurationMs;
      const ratio = currentDurationMs / baselineDurationMs;
      if (deltaMs < 1000 || ratio < 1.5) return [];
      return [{
        code: 'ATM_VALIDATOR_DURATION_REGRESSION',
        validatorName: entry.name,
        baselineDurationMs,
        durationMs: currentDurationMs,
        deltaMs,
        ratio: Number(ratio.toFixed(2)),
        message: `${entry.name} grew from ${baselineDurationMs}ms to ${currentDurationMs}ms`,
        remediation: 'Check fixture size, temp-repo setup, broad scans, and duplicated validator coverage before raising the budget.'
      }];
    });
  warnings.push(...regressions);
  return {
    schemaId: 'atm.validatorPerformanceReport.v1',
    profile,
    durationMs,
    budgetMs,
    fastValidatorBudgetMs,
    slowValidatorBudgetMs,
    baselinePresent: performanceBaselineSummary !== null && performanceBaselineSummary !== undefined,
    warningCount: warnings.length,
    slowestValidators,
    budgetViolations,
    regressions,
    warnings
  };
}

function resolveValidatorDurationBudget(entry: any, fastValidatorBudgetMs: number, slowValidatorBudgetMs: number): number {
  if (Number.isFinite(entry?.performanceBudgetMs)) {
    return Number(entry.performanceBudgetMs);
  }
  const configEntry: any = validatorMap.get(entry?.name);
  if (Number.isFinite(configEntry?.performanceBudgetMs)) {
    return Number(configEntry.performanceBudgetMs);
  }
  return entry?.slow === true ? slowValidatorBudgetMs : fastValidatorBudgetMs;
}

function resolvePerformanceDefaults() {
  const defaults = config.performanceDefaults ?? {};
  return {
    fastValidatorBudgetMs: Number.isFinite(defaults.fastValidatorBudgetMs)
      ? Number(defaults.fastValidatorBudgetMs)
      : DEFAULT_FAST_VALIDATOR_BUDGET_MS,
    slowValidatorBudgetMs: Number.isFinite(defaults.slowValidatorBudgetMs)
      ? Number(defaults.slowValidatorBudgetMs)
      : DEFAULT_SLOW_VALIDATOR_BUDGET_MS
  };
}

function buildFocusedValidatorCommand(results: readonly any[]): string | null {
  const failingCurrentTask = results.find((entry) => (entry.envelope?.currentTaskFailures ?? []).length > 0);
  if (failingCurrentTask?.command) {
    return String(failingCurrentTask.command);
  }
  const firstFailed = results.find((entry) => entry.ok !== true);
  if (firstFailed?.command) {
    return String(firstFailed.command);
  }
  return null;
}

function safeMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function isEnvironmentFinding(finding: any): boolean {
  const code = String(finding?.code ?? '');
  const source = String(finding?.source ?? '');
  const classification = String(finding?.classification ?? '');
  return classification === 'environment'
    || source === 'environment'
    || source === 'git-index'
    || code.startsWith('ATM_ENV_')
    || code.startsWith('ATM_GIT_INDEX_');
}

function isBaselineFinding(finding: any): boolean {
  return String(finding?.classification ?? '') === 'baseline' || String(finding?.source ?? '') === 'baseline';
}

function dedupeFindings(findings: readonly any[]): readonly any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const finding of findings) {
    const key = `${finding?.code ?? ''}\0${finding?.source ?? ''}\0${finding?.detail ?? ''}\0${finding?.requiredCommand ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
