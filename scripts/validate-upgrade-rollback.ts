import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

function fail(message: string) {
  console.error(`[upgrade-rollback:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
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
  assert(pattern.test(content), `ATMChart fixture missing ${key}`);
  writeFileSync(filePath, content.replace(pattern, `${key}: ${value}`), 'utf8');
}

function removeFrontmatterLine(filePath: string, key: string) {
  const content = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, content.replace(new RegExp(`^${key}: .*\\r?\\n`, 'm'), ''), 'utf8');
}

const tempRoot = createTempWorkspace('atm-upgrade-rollback-');
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  assert(runAtm(['bootstrap', '--cwd', repo, '--json'], repo).exitCode === 0, 'bootstrap must pass');
  assert(runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo).exitCode === 0, 'atm-chart render must pass');
  assert(runAtm(['agent-pack', 'install', '--id', 'claude-code', '--cwd', repo, '--json'], repo).exitCode === 0, 'agent-pack install must pass');

  const chartPath = path.join(repo, '.atm', 'memory', 'atm-chart.md');
  replaceFrontmatterLine(chartPath, 'atm_chart_version', '0.0.1');
  const entryPath = path.join(repo, '.claude', 'commands', 'atm-next.md');
  writeFileSync(entryPath, `${readFileSync(entryPath, 'utf8')}\nUser local edit preserved by upgrade fixture.\n`, 'utf8');

  const originalChart = readFileSync(chartPath, 'utf8');
  const manifestPath = path.join(repo, '.atm', 'agent-pack', 'claude-code.manifest.json');
  const originalManifest = readFileSync(manifestPath, 'utf8');
  const originalEntry = readFileSync(entryPath, 'utf8');
  const planPath = path.join(repo, '.atm', 'history', 'reports', 'upgrade-plan.json');

  const planResult = runAtm(['upgrade', 'plan', '--cwd', repo, '--out', planPath, '--json'], repo);
  assert(planResult.exitCode === 0, 'upgrade plan must exit 0 even for unsupported old charts');
  assert(existsSync(planPath), 'upgrade plan --out must write a plan file');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  assert(plan.status === 'unsupported', 'old chart plan must report unsupported status');
  assert(plan.readOnlyDiagnostic === true, 'old chart plan must mark readOnlyDiagnostic');
  assert(plan.willModify.includes('.atm/memory/atm-chart.md'), 'plan must list ATMChart as a modified file');
  assert(plan.backupFiles.some((entry: any) => entry.path === '.atm/memory/atm-chart.md'), 'plan must include ATMChart backup');
  assert(plan.backupFiles.some((entry: any) => entry.path === '.atm/agent-pack/claude-code.manifest.json'), 'plan must include agent pack manifest backup');
  assert(plan.backupFiles.some((entry: any) => entry.path === '.claude/commands/atm-next.md' && entry.userModified === true), 'plan must detect user-modified agent-native entry files');
  assert(typeof plan.rollbackPath === 'string' && plan.rollbackPath.includes('/backup-manifest.json'), 'plan must expose rollback path');

  const applyResult = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--json'], repo);
  assert(applyResult.exitCode === 0, 'upgrade apply must exit 0 after explicit plan');
  assert(applyResult.parsed.evidence?.backupPath, 'upgrade apply must report backupPath');
  assert(readFileSync(chartPath, 'utf8').includes('atm_chart_version: 0.1.0'), 'upgrade apply must refresh ATMChart to default supported chart version');
  assert(readFileSync(entryPath, 'utf8') === originalEntry, 'upgrade apply must not overwrite user-modified entry file');
  assert(existsSync(path.join(repo, '.atm', 'runtime', 'compatibility-matrix.snapshot.json')), 'upgrade apply must write compatibility matrix snapshot');

  writeFileSync(entryPath, `${readFileSync(entryPath, 'utf8')}\nPost-apply drift that rollback must remove.\n`, 'utf8');
  const rollbackResult = runAtm(['upgrade', 'rollback', '--cwd', repo, '--backup', applyResult.parsed.evidence.backupPath, '--json'], repo);
  assert(rollbackResult.exitCode === 0, 'upgrade rollback must exit 0');
  assert(readFileSync(chartPath, 'utf8') === originalChart, 'rollback must restore previous ATMChart');
  assert(readFileSync(manifestPath, 'utf8') === originalManifest, 'rollback must restore previous manifest');
  assert(readFileSync(entryPath, 'utf8') === originalEntry, 'rollback must restore previous agent-native entry file');
  assert(!existsSync(path.join(repo, '.atm', 'runtime', 'compatibility-matrix.snapshot.json')), 'rollback must remove snapshot that did not exist before apply');

  const unknownRepo = path.join(tempRoot, 'unknown-repo');
  mkdirSync(unknownRepo, { recursive: true });
  assert(runAtm(['bootstrap', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode === 0, 'unknown repo bootstrap must pass');
  assert(runAtm(['atm-chart', 'render', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode === 0, 'unknown repo render must pass');
  const unknownChartPath = path.join(unknownRepo, '.atm', 'memory', 'atm-chart.md');
  removeFrontmatterLine(unknownChartPath, 'atm_chart_version');
  const beforeUnknownWelcome = readFileSync(unknownChartPath, 'utf8');
  const unknownWelcome = runAtm(['welcome', '--cwd', unknownRepo, '--json'], unknownRepo);
  assert(unknownWelcome.exitCode !== 0, 'welcome must enter read-only diagnostic for unknown chart version');
  assert(readFileSync(unknownChartPath, 'utf8') === beforeUnknownWelcome, 'unknown chart welcome must not auto-modify chart');
  const unknownPlanDenied = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--json'], unknownRepo);
  assert(unknownPlanDenied.exitCode !== 0, 'unknown chart upgrade plan must fail closed without --allow-unknown-chart');
  assert(unknownPlanDenied.parsed.messages?.some((entry: any) => entry.code === 'ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE'), 'unknown chart plan denial must use ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE');
  const unknownPlan = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--allow-unknown-chart', '--json'], unknownRepo);
  assert(unknownPlan.exitCode === 0, 'explicit --allow-unknown-chart upgrade plan must be allowed for unknown chart version');
  assert(unknownPlan.parsed.evidence?.plan?.status === 'unknown', 'unknown chart plan must report unknown status');
  assert(readFileSync(unknownChartPath, 'utf8') === beforeUnknownWelcome, 'upgrade plan must remain dry-run and not modify chart');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[upgrade-rollback:${mode}] ok (dry-run plan, backup, apply, rollback, read-only diagnostics)`);
}
