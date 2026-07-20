import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildTelemetryObservation,
  telemetryObservationProducerInventory
} from '../../packages/core/src/telemetry/index.ts';
import { buildSharedWriteGateCoverageReport } from '../../packages/core/src/telemetry/shared-write-coverage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-canonical-telemetry-'));

try {
  const observation = buildTelemetryObservation({
    observationId: 'obs-test',
    producerId: 'evidence.command-runs',
    observationKind: 'validator',
    source: 'unit-test',
    sourceAvailability: 'unavailable',
    storagePolicy: 'tracked-compact-digest',
    inputDigest: 'sha256:' + '0'.repeat(64)
  });
  assert.equal(observation.schemaId, 'atm.telemetryObservation.v1');
  assert.equal(observation.sourceAvailability, 'unavailable');
  assert.equal(observation.storagePolicy, 'tracked-compact-digest');

  const canonical = telemetryObservationProducerInventory.filter((entry) => entry.status === 'canonical');
  assert.ok(canonical.some((entry) => entry.producerId === 'evidence.command-runs'));

  const coverage = buildSharedWriteGateCoverageReport(tmp);
  assert.equal(coverage.schemaId, 'atm.sharedWriteGateCoverage.v1');
  assert.equal(coverage.coveragePercentage, 100);
  assert.equal(coverage.observedProducerCount, coverage.producerCount);
  assert.match(coverage.inputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(coverage.sealedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(coverage.producers.every((producer) => producer.sourceAvailability !== 'unavailable' || producer.receiptRef));

  const cli = runAtm(['telemetry', '--cwd', tmp, '--shared-write-coverage', '--json']);
  assert.equal(cli.status, 0, cli.combined);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.evidence.schemaId, 'atm.sharedWriteGateCoverage.v1');
  assert.equal(payload.evidence.coveragePercentage, 100);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/canonical-telemetry-observation.test.ts');

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
