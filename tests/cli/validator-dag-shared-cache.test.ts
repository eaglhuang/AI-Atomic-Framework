import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const result = spawnSync(
  process.execPath,
  ['--strip-types', 'scripts/run-validators.ts', 'quick', '--filter', 'audit-hash-placeholders', '--json', '--cache'],
  { cwd: root, encoding: 'utf8' }
);

if (result.status !== 0) {
  throw new Error(`validator runner failed:\n${result.stdout}\n${result.stderr}`);
}

const summary = JSON.parse(result.stdout);
const failures: string[] = [];

if (summary.dag?.schemaId !== 'atm.validatorDag.v1') {
  failures.push('summary.dag is missing atm.validatorDag.v1');
}

if (summary.usageTelemetry?.schemaId !== 'atm.validatorUsageTelemetry.v1') {
  failures.push('summary.usageTelemetry is missing atm.validatorUsageTelemetry.v1');
}

if (summary.usageTelemetry?.selectedCount !== summary.total) {
  failures.push('usageTelemetry.selectedCount must match summary.total');
}

if (!Array.isArray(summary.usageTelemetry?.validators) || summary.usageTelemetry.validators.length !== summary.total) {
  failures.push('usageTelemetry.validators must include one counter row per selected validator');
}

if (summary.usageTelemetry?.demotionPolicy?.scarceUseAction !== 'move-to-full-after-observation-window') {
  failures.push('usageTelemetry must expose the scarce-use demotion policy');
}

if (summary.dag?.nodeCount !== summary.total) {
  failures.push('dag.nodeCount must match selected validators');
}

if (failures.length > 0) {
  throw new Error(`validator DAG/shared-cache telemetry test failed:\n${failures.join('\n')}`);
}

process.stdout.write('[validator-dag-shared-cache] ok\n');
