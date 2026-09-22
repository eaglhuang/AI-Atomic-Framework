import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildGateTelemetryRegistryCoverageReport, commandGateCheckId } from '../packages/core/src/telemetry/index.ts';
import { listCommandSpecs } from '../packages/cli/src/commands/command-specs.ts';
import { buildCommandGateLatencyMarkdown, buildCommandGateLatencyReport, validateCommandGateLatencyReport, type CommandGateLatencyOutcome } from '../packages/core/src/telemetry/command-gate-latency-score.ts';

const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

if (mode === 'command-matrix') {
  const receiptIndex = process.argv.indexOf('--receipt');
  const receiptPath = receiptIndex >= 0 ? process.argv[receiptIndex + 1] : undefined;
  assert.ok(receiptPath, '--receipt is required for command-matrix mode');

  if (process.argv.includes('--validate-only')) {
    const receipt = JSON.parse(readFileSync(path.resolve(process.cwd(), receiptPath), 'utf8')) as {
      schemaId?: string;
      runner?: { version?: string; commitSha?: string; entrypoint?: string };
      workload?: { id?: string };
      inventory?: readonly { key: string; command: string; gate: string; mandatory: boolean; applicability: string }[];
      samples?: readonly (Record<string, unknown> & { key?: string; command?: string; durationMs?: number; runnerVersion?: string; workloadId?: string; commitSha?: string })[];
      report?: Parameters<typeof validateCommandGateLatencyReport>[0];
    };
    assert.equal(receipt.schemaId, 'atm.commandGateLatencyMatrixReceipt.v1');
    assert.ok(receipt.runner?.entrypoint && receipt.runner.version && receipt.runner.commitSha);
    assert.ok(receipt.workload?.id);
    assert.ok(Array.isArray(receipt.inventory) && receipt.inventory.length > 0);
    assert.ok(Array.isArray(receipt.samples));
    const inventoryKeys = new Set(receipt.inventory!.map((entry) => entry.key));
    const sampleKeys = new Set(receipt.samples!.map((sample) => sample.key));
    assert.equal(sampleKeys.size, inventoryKeys.size, 'command matrix sample set must be one-to-one with inventory');
    for (const entry of receipt.inventory!) assert.ok(sampleKeys.has(entry.key), `missing command sample: ${entry.key}`);
    for (const sample of receipt.samples!) {
      assert.ok(typeof sample.durationMs === 'number' && sample.durationMs > 0, `durationMs must be real and > 0 for ${String(sample.command)}`);
      assert.equal(sample.runnerVersion, receipt.runner!.version, `runner identity mismatch for ${String(sample.command)}`);
      assert.equal(sample.workloadId, receipt.workload!.id, `workload identity mismatch for ${String(sample.command)}`);
      assert.equal(sample.commitSha, receipt.runner!.commitSha, `commit identity mismatch for ${String(sample.command)}`);
    }
    assert.ok(receipt.report, 'receipt must include a latency report');
    assert.deepEqual(validateCommandGateLatencyReport(receipt.report!), []);
    assert.deepEqual(receipt.report!.uncoveredKeys, []);
    console.log(JSON.stringify({ ok: true, receipt: path.resolve(process.cwd(), receiptPath), schemaId: receipt.schemaId, inventoryCount: receipt.inventory!.length, sampleCount: receipt.samples!.length, coveragePct: receipt.report!.coveragePct }, null, 2));
    process.exit(0);
  }

  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.match(commitSha, /^[0-9a-f]{40}$/);
  const runner = {
    entrypoint: 'packages/cli/src/atm.ts',
    version: packageJson.version ?? 'unknown',
    commitSha
  };
  const workload = {
    id: 'top-level-command-help-matrix-v1',
    args: ['--help', '--json'],
    cwd: root
  };
  const inventory = listCommandSpecs().map((spec) => ({
    key: commandGateCheckId(spec.name),
    command: spec.name,
    gate: spec.name,
    mandatory: spec.name === 'next' || spec.name === 'doctor' || spec.name === 'guard',
    applicability: spec.summary
  }));
  const runnerPath = path.join(root, 'packages', 'cli', 'src', 'atm.ts');
  const samples = inventory.map((entry, index) => {
    const started = process.hrtime.bigint();
    const result = spawnSync(process.execPath, ['--strip-types', runnerPath, entry.command, ...workload.args], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const outcome: CommandGateLatencyOutcome = result.error
      ? 'fail'
      : result.status === 0 ? 'pass' : 'blocked';
    return {
      sampleId: `command-matrix-${index + 1}-${entry.key}`,
      key: entry.key,
      command: entry.command,
      gate: entry.gate,
      mandatory: entry.mandatory,
      applicability: entry.applicability,
      durationMs,
      outcome,
      taskId: 'TASK-PRF-0111',
      runId: `command-matrix-${commitSha.slice(0, 12)}`,
      evidenceRef: `command:${entry.command}`,
      runnerVersion: runner.version,
      workloadId: workload.id,
      commitSha,
      exitCode: result.status ?? null
    };
  });
  for (const sample of samples) {
    assert.ok(sample.durationMs > 0, `durationMs must be real and > 0 for ${sample.command}`);
    assert.equal(sample.runnerVersion, runner.version);
    assert.equal(sample.workloadId, workload.id);
    assert.equal(sample.commitSha, commitSha);
  }
  const report = buildCommandGateLatencyReport({ inventory, samples });
  assert.deepEqual(report.uncoveredKeys, [], 'command matrix must cover every public command');
  assert.deepEqual(validateCommandGateLatencyReport(report), []);
  const receipt = {
    schemaId: 'atm.commandGateLatencyMatrixReceipt.v1',
    generatedAt: new Date().toISOString(),
    taskId: 'TASK-PRF-0111',
    runner,
    workload,
    inventory,
    samples,
    report,
    latencyMarkdown: buildCommandGateLatencyMarkdown(report),
    failClosed: true
  };
  const target = path.resolve(root, receiptPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, receipt: target, schemaId: receipt.schemaId, inventoryCount: inventory.length, sampleCount: samples.length, coveragePct: report.coveragePct }, null, 2));
  process.exit(0);
}

const report = buildGateTelemetryRegistryCoverageReport(process.cwd());

assert.equal(report.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
assert.ok(report.configDigest.startsWith('sha256:'));
assert.ok(report.historyDigest.startsWith('sha256:'));
assert.equal(report.rawDataPolicy.runtimeStorage, '.atm/runtime/telemetry/**');
assert.equal(report.rawDataPolicy.trackedEvidence, 'compact-digest-only');
assert.equal(report.rawDataPolicy.rawTelemetryCommitted, false);

const requiredFamilies = [
  'claim/reservation/lane presence',
  'next/preflight/guard/doctor',
  'validator queue/execution/cache/fan-out',
  'task import/task close/taskflow close/checkpoint',
  'evidence seal/readback/handoff',
  'git governance/pre-commit/pre-push/branch queue',
  'runner-sync/release mirror/generated projection',
  'batch/broker/team/worker lifecycle',
  'telemetry seal/report/self-health'
];

for (const family of requiredFamilies) {
  const node = report.requiredNodes.find((entry) => entry.nodeFamily === family);
  assert.ok(node, `missing required node family: ${family}`);
  assert.ok(['instrumented', 'read-only-summary', 'out-of-scope', 'not-yet-covered'].includes(node.coverageStatus));
  assert.ok(['available', 'unavailable', 'partial'].includes(node.sourceAvailability));
  assert.ok(node.requiredCorrelationKeys.includes('runId'));
  assert.ok(node.requiredCorrelationKeys.includes('taskId'));
}

const incompleteNodes = report.requiredNodes.filter((node) => !node.m2Comparable);
if (incompleteNodes.length > 0) {
  assert.equal(report.m2PreflightVerdict, 'inconclusive');
} else {
  assert.equal(report.m2PreflightVerdict, 'ready');
}

if (mode === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`ok - gate telemetry coverage report (${report.m2PreflightVerdict})`);
}
