import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordCommandGateTelemetry, runCli } from '../../packages/cli/src/atm.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-mandatory-gate-'));
try {
  const startedAt = process.hrtime.bigint() - 4_000_000n;
  recordCommandGateTelemetry(root, 'doctor', startedAt, {
    ok: false,
    messages: [{ level: 'error' }]
  });

  const eventRoot = path.join(root, '.atm', 'runtime', 'telemetry', 'gate-events');
  const runDirectory = readdirSync(eventRoot)[0];
  const eventFile = readdirSync(path.join(eventRoot, runDirectory))[0];
  const event = JSON.parse(readFileSync(path.join(eventRoot, runDirectory, eventFile), 'utf8').trim()) as Record<string, unknown>;
  assert.equal(event.checkId, 'doctor.readiness');
  assert.equal(event.gate, 'doctor');
  assert.equal(event.result, 'block');
  assert.equal(typeof event.durationMs, 'number');
  assert.ok((event.durationMs as number) >= 3);
  assert.equal(typeof event.runId, 'string');
  assert.equal(typeof event.correlationId, 'string');
  assert.equal(typeof event.runnerVersion, 'string');
  assert.equal(event.workloadId, 'cli-command:doctor');

  const originalCwd = process.cwd();
  process.chdir(root);
  try {
    await runCli(['doctor', '--json'], {
      stdout: { write: () => true },
      stderr: { write: () => true }
    } as any);
  } finally {
    process.chdir(originalCwd);
  }
  const runDirectoriesAfterCommand = readdirSync(eventRoot);
  assert.ok(runDirectoriesAfterCommand.length >= 1);
  const commandEventFiles = runDirectoriesAfterCommand.flatMap((directory) =>
    readdirSync(path.join(eventRoot, directory)).map((file) => path.join(eventRoot, directory, file)));
  const commandEvents = commandEventFiles.flatMap((file) =>
    readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>));
  assert.ok(commandEvents.some((entry) => entry.checkId === 'doctor.readiness' && typeof entry.durationMs === 'number'));

  recordCommandGateTelemetry(root, 'not-registered', startedAt, { ok: true });
  assert.equal(readdirSync(eventRoot).length, runDirectoriesAfterCommand.length);
  const allEvents = readdirSync(eventRoot).flatMap((directory) =>
    readdirSync(path.join(eventRoot, directory)).flatMap((file) =>
      readFileSync(path.join(eventRoot, directory, file), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)));
  assert.ok(allEvents.some((entry) => entry.checkId === 'command.not-registered.execution'));
  console.log('[mandatory-gate-telemetry.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
