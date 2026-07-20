import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  telemetryObservationProducerInventory,
  type TelemetryObservationStatus
} from '../packages/core/src/telemetry/index.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1] ?? 'validate'
  : 'validate';

const allowedStatuses = new Set<TelemetryObservationStatus>([
  'canonical',
  'adapter-backed',
  'legacy-readable',
  'not-yet-migrated'
]);

const requiredProducerIds = [
  'evidence.command-runs',
  'gate.telemetry-events',
  'validator.lifecycle',
  'runner.incremental-build',
  'broker.decision-outcome',
  'plan-executor.phase',
  'test-runner.timing'
];

const failures: string[] = [];

for (const producerId of requiredProducerIds) {
  const entry = telemetryObservationProducerInventory.find((candidate) => candidate.producerId === producerId);
  if (!entry) {
    failures.push(`missing producer inventory entry: ${producerId}`);
    continue;
  }
  if (!allowedStatuses.has(entry.status)) failures.push(`${producerId} has invalid status ${entry.status}`);
  if (!entry.ownerTaskId) failures.push(`${producerId} is missing ownerTaskId`);
  if (!entry.adapterPort) failures.push(`${producerId} is missing adapterPort`);
  if (entry.sourcePaths.length === 0) failures.push(`${producerId} is missing sourcePaths`);
}

const canonical = telemetryObservationProducerInventory.filter((entry) => entry.status === 'canonical');
if (!canonical.some((entry) => entry.producerId === 'evidence.command-runs')) {
  failures.push('evidence.command-runs must be the canonical 0205 canary producer');
}

const observationSource = readText('packages/core/src/telemetry/observation.ts');
for (const required of [
  'schemaId: \'atm.telemetryObservation.v1\'',
  'storagePolicy',
  'sourceAvailability',
  'inputDigest',
  'outputDigest',
  'configDigest',
  'cache',
  'buildTelemetryObservation',
  'telemetryObservationProducerInventory'
]) {
  if (!observationSource.includes(required)) failures.push(`observation contract missing ${required}`);
}

const commandRunsSource = readText('packages/cli/src/commands/evidence/command-runs.ts');
for (const required of [
  'buildCommandRunObservation',
  'canonicalObservation',
  'buildTelemetryObservation',
  'tracked-compact-digest',
  'evidence.command-runs'
]) {
  if (!commandRunsSource.includes(required)) failures.push(`command-run canary missing ${required}`);
}

const privateDurationParsing = [
  ...findPrivateDurationParsing('packages/cli/src/commands/evidence/command-runs.ts')
];
if (privateDurationParsing.length > 0) {
  failures.push(`private duration parsing found outside normalizeTelemetryDurationMs: ${privateDurationParsing.join(', ')}`);
}

const report = {
  schemaId: 'atm.telemetryObservationInterfaceValidation.v1',
  mode,
  ok: failures.length === 0,
  inventory: telemetryObservationProducerInventory.map((entry) => ({
    producerId: entry.producerId,
    ownerTaskId: entry.ownerTaskId,
    status: entry.status,
    adapterPort: entry.adapterPort,
    sourcePaths: entry.sourcePaths
  })),
  failures
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
} else {
  console.log('telemetry observation interface validation ok');
}

if (failures.length > 0) process.exit(1);

function readText(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function findPrivateDurationParsing(relativePath: string): string[] {
  const source = readText(relativePath);
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /duration|elapsed|latency/i.test(line))
    .filter(({ line }) => /Number\(|parseInt|Math\.trunc/.test(line))
    .filter(({ line }) => !line.includes('normalizeTelemetryDurationMs'))
    .map(({ index }) => `${relativePath}:${index}`);
}
