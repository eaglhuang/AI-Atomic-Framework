import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-gate-telemetry-'));

try {
  const registry = runAtm(['telemetry', '--cwd', tmp, '--gate-registry', '--json']);
  assert.equal(registry.status, 0, registry.combined);
  const registryJson = JSON.parse(registry.stdout);
  assert.equal(registryJson.evidence.schemaId, 'atm.gateTelemetryRegistryReport.v1');
  assert.ok(registryJson.evidence.checks.some((check: { checkId: string }) => check.checkId === 'next.route-resolution'));

  const fixture = runAtm([
    'telemetry',
    '--cwd',
    tmp,
    '--emit-fixture',
    '--task',
    'ATM-GOV-0193',
    '--gate',
    'next',
    '--check-id',
    'next.route-resolution',
    '--result',
    'block',
    '--reason',
    'fixture-block',
    '--duration-ms',
    '7',
    '--actor',
    'test-actor',
    '--json'
  ]);
  assert.equal(fixture.status, 0, fixture.combined);
  const fixtureJson = JSON.parse(fixture.stdout);
  assert.equal(fixtureJson.evidence.ok, true);
  assert.match(fixtureJson.evidence.path, /[\\/]\.atm[\\/]runtime[\\/]telemetry[\\/]gate-events[\\/]/);

  const seal = runAtm(['telemetry', '--cwd', tmp, '--seal', '--task', 'ATM-GOV-0193', '--window', 'test-window', '--json']);
  assert.equal(seal.status, 0, seal.combined);
  const sealJson = JSON.parse(seal.stdout);
  assert.equal(sealJson.evidence.schemaId, 'atm.gateTelemetrySealDigest.v1');
  assert.equal(sealJson.evidence.taskId, 'ATM-GOV-0193');
  assert.equal(sealJson.evidence.eventCount, 1);

  const historyText = readFileSync(path.join(tmp, sealJson.evidence.historyPath), 'utf8');
  assert.match(historyText, /"specVersion":"atm.gateTelemetry.v1"/);

  const report = runAtm(['telemetry', '--cwd', tmp, '--report', '--json']);
  assert.equal(report.status, 0, report.combined);
  const reportJson = JSON.parse(report.stdout);
  assert.equal(reportJson.evidence.schemaId, 'atm.gateTelemetryReport.v1');
  assert.equal(reportJson.evidence.eventCount, 1);
  assert.equal(reportJson.evidence.byCheckId['next.route-resolution'].eligible, 1);
  assert.equal(reportJson.evidence.byCheckId['next.route-resolution'].resultCounts.block, 1);
  assert.equal(reportJson.evidence.byCheckId['next.route-resolution'].durationP50, 7);
  assert.equal(reportJson.evidence.uniqueBlocks.length, 1);

  const status = runAtm(['telemetry', '--cwd', tmp, '--status', '--json']);
  assert.equal(status.status, 0, status.combined);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.evidence.enabled, false);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/gate-telemetry-v1.test.ts');

function runAtm(args: readonly string[]): { status: number | null; stdout: string; stderr: string; combined: string } {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: { ...process.env, NO_COLOR: '1' }
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    combined: `${result.stdout ?? ''}\n--- STDERR ---\n${result.stderr ?? ''}`
  };
}
