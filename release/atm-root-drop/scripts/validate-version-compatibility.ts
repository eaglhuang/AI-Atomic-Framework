import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const releaseTag = readArg('--release-tag');

function fail(message: string) {
  console.error(`[version-compatibility:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function runAtm(args: readonly string[], cwd = root, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any = {};
  try {
    parsed = payload ? JSON.parse(payload) : {};
  } catch (error: any) {
    fail(`CLI output is not JSON for ${args.join(' ')}: ${payload || error.message}`);
  }
  return {
    exitCode: result.status ?? 0,
    parsed,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function replaceFrontmatterLine(filePath: string, key: string, value: string) {
  const content = readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`^${key}: .*$`, 'm');
  if (!pattern.test(content)) {
    fail(`ATMChart fixture missing frontmatter key: ${key}`);
    return;
  }
  writeFileSync(filePath, content.replace(pattern, `${key}: ${value}`), 'utf8');
}

function formatAjvErrors(errors: any) {
  return (errors ?? [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

const matrix = readJson('compatibility-matrix.json');
const legacyMatrix = readJson('compatibility-matrix.legacy.json');
const compatibilityMatrixSchema = readJson('schemas/governance/compatibility-matrix.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCompatibilityMatrix = ajv.compile(compatibilityMatrixSchema);
assert(validateCompatibilityMatrix(matrix), `compatibility-matrix.json must match schema: ${formatAjvErrors(validateCompatibilityMatrix.errors)}`);
assert(validateCompatibilityMatrix(legacyMatrix), `compatibility-matrix.legacy.json must match schema: ${formatAjvErrors(validateCompatibilityMatrix.errors)}`);
const rootPackage = readJson('package.json');
assert(matrix.schemaVersion === 'atm.compatibilityMatrix.v0.1', 'compatibility-matrix schemaVersion must be atm.compatibilityMatrix.v0.1');
assert(typeof matrix.lastUpdated === 'string' && matrix.lastUpdated.length > 0, 'compatibility-matrix must declare lastUpdated');
assert(matrix.releaseTrain?.frameworkVersion === rootPackage.version, 'releaseTrain.frameworkVersion must match root package version');
assert(matrix.releaseTrain?.defaultChartVersion, 'releaseTrain must declare defaultChartVersion');
assert(matrix.releaseTrain?.defaultTemplateVersion, 'releaseTrain must declare defaultTemplateVersion');
assert(matrix.atmChartVersions.some((entry: any) => entry.version === matrix.releaseTrain.defaultChartVersion && entry.status === 'supported'), 'default chart version must be supported');
assert(matrix.agentTemplateVersions.some((entry: any) => entry.version === matrix.releaseTrain.defaultTemplateVersion && entry.status === 'supported'), 'default template version must be supported');
assert(!matrix.atmChartVersions.some((entry: any) => entry.status === 'unsupported'), 'active compatibility-matrix must not carry unsupported chart entries; move them to compatibility-matrix.legacy.json');
assert(legacyMatrix.schemaVersion === 'atm.compatibilityMatrixLegacy.v0.1', 'legacy matrix schemaVersion must be atm.compatibilityMatrixLegacy.v0.1');
assert(Array.isArray(legacyMatrix.atmChartVersions), 'legacy matrix must declare atmChartVersions');
assert(legacyMatrix.atmChartVersions.every((entry: any) => entry.status === 'unsupported' && typeof entry.removedFromActiveSupportAt === 'string' && typeof entry.reason === 'string'), 'legacy chart entries must be unsupported and include removedFromActiveSupportAt + reason');
assert(legacyMatrix.atmChartVersions.some((entry: any) => entry.version === '0.0.1'), 'legacy matrix must retain the 0.0.1 unsupported chart for offline diagnostics');

if (releaseTag) {
  const expectedVersion = releaseTag.replace(/^v/, '');
  assert(rootPackage.version === expectedVersion, `release tag ${releaseTag} must match root package version ${rootPackage.version}`);
  assert(matrix.releaseTrain.frameworkVersion === expectedVersion, `release tag ${releaseTag} must match releaseTrain.frameworkVersion ${matrix.releaseTrain.frameworkVersion}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-version-compat-'));
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });

  const bootstrap = runAtm(['bootstrap', '--cwd', repo, '--json'], repo);
  assert(bootstrap.exitCode === 0, 'bootstrap must pass before ATMChart version checks');

  const render = runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo);
  assert(render.exitCode === 0, 'atm-chart render must pass');
  assert(render.parsed.evidence?.versionCompatibility?.status === 'supported', 'atm-chart render must emit supported versionCompatibility');

  const verify = runAtm(['atm-chart', 'verify', '--version-check', '--cwd', repo, '--json'], repo);
  assert(verify.exitCode === 0, 'atm-chart verify --version-check must pass for the default chart');
  assert(verify.parsed.evidence?.versionCompatibility?.status === 'supported', 'verify --version-check must report supported status');

  const chartPath = path.join(repo, '.atm', 'memory', 'atm-chart.md');
  replaceFrontmatterLine(chartPath, 'atm_chart_version', '0.0.1');
  const oldChart = runAtm(['atm-chart', 'verify', '--version-check', '--cwd', repo, '--json'], repo);
  assert(oldChart.exitCode !== 0, 'atm-chart verify --version-check must fail for a chart below supported range');
  assert(oldChart.parsed.messages?.some((entry: any) => entry.code === 'ATM_CHART_VERSION_UNSUPPORTED'), 'old chart failure must use ATM_CHART_VERSION_UNSUPPORTED');

  runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo);
  replaceFrontmatterLine(chartPath, 'min_framework_version', '99.0.0');
  const doctor = runAtm(['doctor', '--cwd', repo, '--json'], repo);
  assert(doctor.exitCode !== 0, 'doctor must fail when chart minFrameworkVersion is above framework version');
  assert(doctor.parsed.messages?.some((entry: any) => entry.code === 'ATM_DOCTOR_UNSUPPORTED_CHART_VERSION'), 'doctor must report unsupported chart version');
  assert(doctor.parsed.evidence?.versionSummary?.compatibility?.code === 'unsupported-chart-version', 'doctor evidence must include unsupported-chart-version');

  runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo);
  const welcomeDryRun = runAtm(['welcome', '--cwd', repo, '--dry-run', '--json'], repo);
  assert(welcomeDryRun.exitCode === 0, 'welcome --dry-run must pass for supported versions');
  assert(welcomeDryRun.parsed.evidence?.versions?.frameworkVersion === rootPackage.version, 'welcome --dry-run must include framework version');
  assert(welcomeDryRun.parsed.evidence?.versions?.chartVersion === matrix.releaseTrain.defaultChartVersion, 'welcome --dry-run must include chart version');
  assert(welcomeDryRun.parsed.evidence?.versions?.templateVersion === matrix.releaseTrain.defaultTemplateVersion, 'welcome --dry-run must include template version');

  const downgradeRepo = path.join(tempRoot, 'downgrade-repo');
  mkdirSync(downgradeRepo, { recursive: true });
  assert(runAtm(['bootstrap', '--cwd', downgradeRepo, '--json'], downgradeRepo).exitCode === 0, 'downgrade fixture bootstrap must pass');
  assert(runAtm(['atm-chart', 'render', '--cwd', downgradeRepo, '--json'], downgradeRepo).exitCode === 0, 'downgrade fixture render must pass');
  const versionCachePath = path.join(downgradeRepo, '.atm', 'runtime', 'version-cache.json');
  mkdirSync(path.dirname(versionCachePath), { recursive: true });
  writeFileSync(versionCachePath, `${JSON.stringify({
    schemaId: 'atm.frameworkVersionCache',
    specVersion: '0.1.0',
    lastSeenFrameworkVersion: '9.0.0',
    lastSeenAt: '2026-05-18T00:00:00.000Z'
  }, null, 2)}\n`, 'utf8');
  const downgradeDoctor = runAtm(['doctor', '--cwd', downgradeRepo, '--json'], downgradeRepo);
  assert(downgradeDoctor.exitCode !== 0, 'downgrade fixture must fail into read-only diagnostic mode');
  assert(downgradeDoctor.parsed.messages?.some((entry: any) => entry.code === 'ATM_FRAMEWORK_DOWNGRADE_DETECTED' && entry.level === 'warning'), 'downgrade fixture must emit ATM_FRAMEWORK_DOWNGRADE_DETECTED warning');
  assert(downgradeDoctor.parsed.evidence?.versionSummary?.compatibility?.readOnlyDiagnostic === true, 'downgrade fixture must mark readOnlyDiagnostic');

  const offlineRepo = path.join(tempRoot, 'offline-repo');
  mkdirSync(offlineRepo, { recursive: true });
  assert(runAtm(['bootstrap', '--cwd', offlineRepo, '--json'], offlineRepo).exitCode === 0, 'offline fixture bootstrap must pass');
  assert(runAtm(['atm-chart', 'render', '--cwd', offlineRepo, '--json'], offlineRepo).exitCode === 0, 'offline fixture render must pass');
  const offlineDoctor = runAtm(['doctor', '--cwd', offlineRepo, '--json'], offlineRepo, {
    ATM_COMPATIBILITY_MATRIX_PATH: path.join(tempRoot, 'missing-compatibility-matrix.json'),
    ATM_COMPATIBILITY_LEGACY_MATRIX_PATH: path.join(tempRoot, 'missing-compatibility-matrix.legacy.json')
  });
  assert(offlineDoctor.exitCode === 0, 'offline bundled snapshot fixture must continue successfully');
  assert(offlineDoctor.parsed.messages?.some((entry: any) => entry.code === 'ATM_COMPATIBILITY_BUNDLED_SNAPSHOT' && entry.level === 'warning'), 'offline bundled snapshot fixture must warn about bundled snapshot');
  assert(offlineDoctor.parsed.evidence?.versionSummary?.compatibilityMatrix?.source === 'bundled-snapshot', 'offline fixture must report bundled-snapshot source');

  const unknownRepo = path.join(tempRoot, 'unknown-chart-repo');
  mkdirSync(unknownRepo, { recursive: true });
  assert(runAtm(['bootstrap', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode === 0, 'unknown chart fixture bootstrap must pass');
  assert(runAtm(['atm-chart', 'render', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode === 0, 'unknown chart fixture render must pass');
  const unknownChartPath = path.join(unknownRepo, '.atm', 'memory', 'atm-chart.md');
  replaceFrontmatterLine(unknownChartPath, 'atm_chart_version', '9.9.9');
  const unknownPlanDenied = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--json'], unknownRepo);
  assert(unknownPlanDenied.exitCode !== 0, 'unknown chart upgrade plan must fail without --allow-unknown-chart');
  assert(unknownPlanDenied.parsed.messages?.some((entry: any) => entry.code === 'ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE'), 'unknown chart denial must use ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE');
  const unknownPlanAllowed = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--allow-unknown-chart', '--json'], unknownRepo);
  assert(unknownPlanAllowed.exitCode === 0, 'unknown chart upgrade plan must pass with --allow-unknown-chart');
  assert(unknownPlanAllowed.parsed.evidence?.plan?.status === 'unknown', 'unknown chart allowed plan must report unknown status');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[version-compatibility:${mode}] ok (release train matrix, legacy matrix, downgrade/offline/unknown-chart safeguards)`);
}
