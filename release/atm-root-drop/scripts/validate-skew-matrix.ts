import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const configPath = readArg('--config') ?? 'scripts/skew-matrix.config.json';
const caseId = readArg('--case');
const summaryPath = readArg('--summary');

interface SkewAxisEntry {
  id: string;
  packagePath: string;
  version: string;
  kind?: string;
  smoke?: string;
}

interface SkewCase {
  id: string;
  cli: string;
  pluginSdk: string;
  adapter: string;
  expected: 'pass' | 'fail';
}

interface SkewConfig {
  schemaVersion: string;
  description?: string;
  releaseTrain: {
    frameworkVersion: string;
    atmChartVersion: string;
    agentTemplateVersion: string;
  };
  supportedMinorWindow: string[];
  axes: {
    cli: SkewAxisEntry[];
    pluginSdk: SkewAxisEntry[];
    adapters: SkewAxisEntry[];
  };
  cases: SkewCase[];
}

interface SkewSummaryCase {
  id: string;
  cliVersion: string;
  pluginSdkVersion: string;
  adapter: string;
  adapterVersion: string;
  status: 'pass' | 'fail';
  checks: Array<{ name: string; status: 'pass' | 'fail'; detail?: string }>;
}

const failures: Array<{ code: string; message: string }> = [];

function fail(code: string, message: string) {
  failures.push({ code, message });
  console.error(`[skew-matrix:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.resolve(root, relativePath), 'utf8'));
}

const config = readJson(configPath) as SkewConfig;
const validationErrors = validateConfig(config, configPath);
for (const error of validationErrors) {
  fail(error.code, error.message);
}

if (mode === 'matrix') {
  if (validationErrors.length > 0) process.exit(1);
  console.log(JSON.stringify({ include: config.cases.map((entry) => ({ caseId: entry.id })) }, null, 2));
  process.exit(0);
}

let summaryCases: SkewSummaryCase[] = [];
if (!process.exitCode) {
  const selectedCases = caseId ? config.cases.filter((entry) => entry.id === caseId) : config.cases;
  if (selectedCases.length === 0) {
    fail('SKEW_CASE_NOT_FOUND', `case not found: ${caseId}`);
  } else {
    summaryCases = selectedCases.map((entry) => runSmokeCase(config, entry));
    for (const entry of summaryCases) {
      if (entry.status !== 'pass') {
        fail('SKEW_SMOKE_FAILED', `${entry.id} failed: ${entry.checks.filter((check) => check.status === 'fail').map((check) => `${check.name}: ${check.detail ?? 'failed'}`).join('; ')}`);
      }
    }
  }
}

const summary = {
  schemaVersion: 'atm.skewMatrixSummary.v0.1',
  generatedAt: new Date().toISOString(),
  configPath,
  ok: process.exitCode ? false : true,
  failures,
  cases: summaryCases
};

if (summaryPath) {
  const resolvedSummaryPath = path.resolve(root, summaryPath);
  mkdirSync(path.dirname(resolvedSummaryPath), { recursive: true });
  writeFileSync(resolvedSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

if (!process.exitCode) {
  console.log(`[skew-matrix:${mode}] ok — verified ${summaryCases.length} CLI × Plugin SDK × Adapter combination(s)`);
}

function validateConfig(input: SkewConfig, label: string) {
  const errors: Array<{ code: string; message: string }> = [];
  const add = (code: string, message: string) => errors.push({ code, message });
  const compatibility = readJson('compatibility-matrix.json');

  if (input.schemaVersion !== 'atm.skewMatrix.v0.1') {
    add('SKEW_SCHEMA_VERSION_INVALID', `${label}: schemaVersion must be atm.skewMatrix.v0.1`);
  }
  if (input.releaseTrain?.frameworkVersion !== compatibility.releaseTrain?.frameworkVersion) {
    add('SKEW_FRAMEWORK_VERSION_MISMATCH', `${label}: releaseTrain.frameworkVersion must match compatibility-matrix.json`);
  }
  if (input.releaseTrain?.atmChartVersion !== compatibility.releaseTrain?.defaultChartVersion) {
    add('SKEW_CHART_VERSION_MISMATCH', `${label}: releaseTrain.atmChartVersion must match defaultChartVersion`);
  }
  if (input.releaseTrain?.agentTemplateVersion !== compatibility.releaseTrain?.defaultTemplateVersion) {
    add('SKEW_TEMPLATE_VERSION_MISMATCH', `${label}: releaseTrain.agentTemplateVersion must match defaultTemplateVersion`);
  }
  if (!Array.isArray(input.supportedMinorWindow) || input.supportedMinorWindow.length === 0 || input.supportedMinorWindow.length > 2) {
    add('SKEW_MINOR_WINDOW_INVALID', `${label}: supportedMinorWindow must contain 1 or 2 minor keys`);
  }

  const cliEntries = axisEntries(input.axes?.cli);
  const sdkEntries = axisEntries(input.axes?.pluginSdk);
  const adapterEntries = axisEntries(input.axes?.adapters);
  const caseEntries = Array.isArray(input.cases) ? input.cases : [];

  if (cliEntries.length === 0) add('SKEW_AXIS_EMPTY', `${label}: axes.cli must not be empty`);
  if (sdkEntries.length === 0) add('SKEW_AXIS_EMPTY', `${label}: axes.pluginSdk must not be empty`);
  if (adapterEntries.length === 0) add('SKEW_AXIS_EMPTY', `${label}: axes.adapters must not be empty`);
  if (caseEntries.length === 0) add('SKEW_CASES_EMPTY', `${label}: cases must not be empty`);

  const ids = new Set<string>();
  for (const entry of [...cliEntries, ...sdkEntries, ...adapterEntries]) {
    if (!entry.id || ids.has(entry.id)) add('SKEW_AXIS_ID_INVALID', `${label}: duplicate or missing axis id ${entry.id}`);
    ids.add(entry.id);
    const packageJsonPath = path.join(root, entry.packagePath ?? '', 'package.json');
    if (!existsSync(packageJsonPath)) {
      add('SKEW_PACKAGE_MISSING', `${label}: missing package.json for ${entry.id} at ${entry.packagePath}`);
      continue;
    }
    const actualVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
    if (actualVersion !== entry.version) {
      add('SKEW_PACKAGE_VERSION_MISMATCH', `${label}: ${entry.id} config version ${entry.version} must match package.json ${actualVersion}`);
    }
    if (!input.supportedMinorWindow?.includes(minorKey(entry.version))) {
      add('SKEW_VERSION_OUTSIDE_WINDOW', `${label}: ${entry.id} version ${entry.version} is outside supportedMinorWindow`);
    }
  }

  const cliIds = new Set(cliEntries.map((entry) => entry.id));
  const sdkIds = new Set(sdkEntries.map((entry) => entry.id));
  const adapterIds = new Set(adapterEntries.map((entry) => entry.id));
  const caseIds = new Set<string>();
  for (const entry of caseEntries) {
    if (!entry.id || caseIds.has(entry.id)) add('SKEW_CASE_ID_INVALID', `${label}: duplicate or missing case id ${entry.id}`);
    caseIds.add(entry.id);
    if (!cliIds.has(entry.cli)) add('SKEW_CASE_CLI_UNKNOWN', `${label}: case ${entry.id} references unknown cli ${entry.cli}`);
    if (!sdkIds.has(entry.pluginSdk)) add('SKEW_CASE_SDK_UNKNOWN', `${label}: case ${entry.id} references unknown pluginSdk ${entry.pluginSdk}`);
    if (!adapterIds.has(entry.adapter)) add('SKEW_CASE_ADAPTER_UNKNOWN', `${label}: case ${entry.id} references unknown adapter ${entry.adapter}`);
    if (entry.expected !== 'pass') add('SKEW_EXPECTED_INVALID', `${label}: committed skew cases must expect pass; incompatible cases belong in fixtures/skew`);
  }

  return errors;
}

function axisEntries(value: unknown): SkewAxisEntry[] {
  return Array.isArray(value) ? value as SkewAxisEntry[] : [];
}

function minorKey(version: string) {
  const match = version.match(/^v?(\d+)\.(\d+)\./);
  return match ? `${match[1]}.${match[2]}` : 'invalid';
}

function runSmokeCase(input: SkewConfig, entry: SkewCase): SkewSummaryCase {
  const cli = input.axes.cli.find((axis) => axis.id === entry.cli)!;
  const pluginSdk = input.axes.pluginSdk.find((axis) => axis.id === entry.pluginSdk)!;
  const adapter = input.axes.adapters.find((axis) => axis.id === entry.adapter)!;
  const checks: SkewSummaryCase['checks'] = [];

  checks.push(runDoctorCheck());
  checks.push(runCheck('plugin-sdk-contract', [path.join(root, 'scripts', 'validate-plugin-sdk.ts'), '--mode', 'test']));

  if (adapter.smoke === 'validate-local-git-adapter') {
    checks.push(runCheck('adapter-local-git', [path.join(root, 'scripts', 'validate-local-git-adapter.ts'), '--mode', 'test']));
  } else if (adapter.smoke === 'validate-integration-adapter') {
    checks.push(runCheck(`integration-${adapter.id}`, [path.join(root, 'scripts', 'validate-integration-adapter.ts'), '--mode', 'test', '--filter', adapter.id]));
  } else {
    checks.push({ name: 'adapter-smoke', status: 'fail', detail: `unsupported smoke command: ${adapter.smoke}` });
  }

  return {
    id: entry.id,
    cliVersion: cli.version,
    pluginSdkVersion: pluginSdk.version,
    adapter: adapter.id,
    adapterVersion: adapter.version,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks
  };
}

function runCheck(name: string, args: string[]) {
  const [scriptPath, ...scriptArgs] = args;
  const result = spawnSync(process.execPath, ['--strip-types', scriptPath, ...scriptArgs], {
    cwd: root,
    encoding: 'utf8'
  });
  if ((result.status ?? 1) === 0) {
    return { name, status: 'pass' as const };
  }
  return {
    name,
    status: 'fail' as const,
    detail: `${(result.stdout || '').trim()} ${(result.stderr || '').trim()} ${result.error?.message ?? ''}`.trim()
  };
}

function runDoctorCheck() {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'atm.mjs'), 'doctor', '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any = null;
  try {
    parsed = payload ? JSON.parse(payload) : null;
  } catch {
    return {
      name: 'cli-doctor',
      status: 'fail' as const,
      detail: `${payload} ${result.error?.message ?? ''}`.trim()
    };
  }
  const failedChecks = Array.isArray(parsed?.evidence?.checks)
    ? parsed.evidence.checks.filter((check: any) => check?.ok === false).map((check: any) => String(check?.name ?? 'unknown'))
    : [];
  const actionableFailures = failedChecks.filter((name: string) => name !== 'git-head-evidence');
  if ((result.status ?? 1) === 0 || actionableFailures.length === 0) {
    return {
      name: 'cli-doctor',
      status: 'pass' as const,
      detail: failedChecks.includes('git-head-evidence')
        ? 'ignored local governance-only git-head-evidence signal for skew compatibility smoke'
        : undefined
    };
  }
  return {
    name: 'cli-doctor',
    status: 'fail' as const,
    detail: `doctor failed checks: ${actionableFailures.join(', ')}`
  };
}
