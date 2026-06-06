import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-longtail-'));

try {
  const downgradeRepo = path.join(tempRoot, 'downgrade-repo');
  mkdirSync(downgradeRepo, { recursive: true });
  assert.equal(runAtm(['bootstrap', '--cwd', downgradeRepo, '--json'], downgradeRepo).exitCode, 0);
  assert.equal(runAtm(['atm-chart', 'render', '--cwd', downgradeRepo, '--json'], downgradeRepo).exitCode, 0);
  const versionCachePath = path.join(downgradeRepo, '.atm', 'runtime', 'version-cache.json');
  mkdirSync(path.dirname(versionCachePath), { recursive: true });
  writeFileSync(versionCachePath, `${JSON.stringify({
    schemaId: 'atm.frameworkVersionCache',
    specVersion: '0.1.0',
    lastSeenFrameworkVersion: '9.0.0',
    lastSeenAt: '2026-05-18T00:00:00.000Z'
  }, null, 2)}\n`, 'utf8');
  const downgradeDoctor = runAtm(['doctor', '--cwd', downgradeRepo, '--json'], downgradeRepo);
  assert.notEqual(downgradeDoctor.exitCode, 0);
  assert.equal(downgradeDoctor.parsed.messages.some((entry: any) => entry.code === 'ATM_FRAMEWORK_DOWNGRADE_DETECTED' && entry.level === 'warning'), true);
  assert.equal(downgradeDoctor.parsed.evidence.versionSummary.compatibility.readOnlyDiagnostic, true);

  const offlineRepo = path.join(tempRoot, 'offline-repo');
  mkdirSync(offlineRepo, { recursive: true });
  assert.equal(runAtm(['bootstrap', '--cwd', offlineRepo, '--json'], offlineRepo).exitCode, 0);
  assert.equal(runAtm(['atm-chart', 'render', '--cwd', offlineRepo, '--json'], offlineRepo).exitCode, 0);
  const offlineDoctor = runAtm(['doctor', '--cwd', offlineRepo, '--json'], offlineRepo, {
    ATM_COMPATIBILITY_MATRIX_PATH: path.join(tempRoot, 'missing-compatibility-matrix.json'),
    ATM_COMPATIBILITY_LEGACY_MATRIX_PATH: path.join(tempRoot, 'missing-compatibility-matrix.legacy.json')
  });
  assert.equal(offlineDoctor.exitCode, 0, `${offlineDoctor.stdout}\n${offlineDoctor.stderr}`);
  assert.equal(offlineDoctor.parsed.messages.some((entry: any) => entry.code === 'ATM_COMPATIBILITY_BUNDLED_SNAPSHOT' && entry.level === 'warning'), true);
  assert.equal(offlineDoctor.parsed.evidence.versionSummary.compatibilityMatrix.source, 'bundled-snapshot');

  const unknownRepo = path.join(tempRoot, 'unknown-chart-repo');
  mkdirSync(unknownRepo, { recursive: true });
  assert.equal(runAtm(['bootstrap', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode, 0);
  assert.equal(runAtm(['atm-chart', 'render', '--cwd', unknownRepo, '--json'], unknownRepo).exitCode, 0);
  const unknownChartPath = path.join(unknownRepo, '.atm', 'memory', 'atm-chart.md');
  replaceFrontmatterLine(unknownChartPath, 'atm_chart_version', '9.9.9');
  const deniedPlan = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--json'], unknownRepo);
  assert.notEqual(deniedPlan.exitCode, 0);
  assert.equal(deniedPlan.parsed.messages.some((entry: any) => entry.code === 'ATM_UPGRADE_UNKNOWN_CHART_REQUIRES_OVERRIDE'), true);
  const allowedPlan = runAtm(['upgrade', 'plan', '--cwd', unknownRepo, '--allow-unknown-chart', '--json'], unknownRepo);
  assert.equal(allowedPlan.exitCode, 0);
  assert.equal(allowedPlan.parsed.evidence.plan.status, 'unknown');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[longtail-user-safeguards:test] ok (downgrade, offline fallback, unknown chart override)');

function runAtm(args: readonly string[], cwd = root, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    parsed: payload ? JSON.parse(payload) : {},
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function replaceFrontmatterLine(filePath: string, key: string, value: string) {
  const content = readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`^${key}: .*$`, 'm');
  assert.equal(pattern.test(content), true);
  writeFileSync(filePath, content.replace(pattern, `${key}: ${value}`), 'utf8');
}
