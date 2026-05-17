import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.ts';

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

function runAtm(args: readonly string[], cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
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

const matrix = readJson('compatibility-matrix.json');
const rootPackage = readJson('package.json');
assert(matrix.schemaVersion === 'atm.compatibilityMatrix.v0.1', 'compatibility-matrix schemaVersion must be atm.compatibilityMatrix.v0.1');
assert(matrix.releaseTrain?.frameworkVersion === rootPackage.version, 'releaseTrain.frameworkVersion must match root package version');
assert(matrix.releaseTrain?.defaultChartVersion, 'releaseTrain must declare defaultChartVersion');
assert(matrix.releaseTrain?.defaultTemplateVersion, 'releaseTrain must declare defaultTemplateVersion');
assert(matrix.atmChartVersions.some((entry: any) => entry.version === matrix.releaseTrain.defaultChartVersion && entry.status === 'supported'), 'default chart version must be supported');
assert(matrix.agentTemplateVersions.some((entry: any) => entry.version === matrix.releaseTrain.defaultTemplateVersion && entry.status === 'supported'), 'default template version must be supported');

if (releaseTag) {
  const expectedVersion = releaseTag.replace(/^v/, '');
  assert(rootPackage.version === expectedVersion, `release tag ${releaseTag} must match root package version ${rootPackage.version}`);
  assert(matrix.releaseTrain.frameworkVersion === expectedVersion, `release tag ${releaseTag} must match releaseTrain.frameworkVersion ${matrix.releaseTrain.frameworkVersion}`);
}

const tempRoot = createTempWorkspace('atm-version-compat-');
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
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[version-compatibility:${mode}] ok (release train matrix, atm-chart version-check, doctor/welcome diagnostics)`);
}
