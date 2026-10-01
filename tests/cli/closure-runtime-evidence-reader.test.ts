import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClosurePacket } from '../../packages/cli/src/commands/framework-development/closure-packet-schema.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-closure-runtime-reader-'));
const taskId = 'TASK-READER';
const runtime = `.atm/runtime/evidence-ledger/bundles/${taskId}.json`;
const legacy = `.atm/history/evidence/${taskId}.json`;
const digest = `sha256:${'a'.repeat(64)}`;
function evidence(command: string) {
  return { evidence: [{ freshness: 'fresh', validationPasses: ['typecheck'], commandRuns: [{ command, exitCode: 0, stdoutSha256: digest, stderrSha256: digest }] }] };
}
function write(relative: string, value: unknown) {
  mkdirSync(path.dirname(path.join(cwd, relative)), { recursive: true });
  writeFileSync(path.join(cwd, relative), JSON.stringify(value));
}
function packet() {
  return createClosurePacket({ cwd, taskId, actorId: 'fixture', evidencePath: runtime, requiredGates: ['typecheck'], changedFiles: [] });
}
try {
  execFileSync('git', ['init', '--quiet'], { cwd });
  write(runtime, evidence('runtime validation'));
  assert.equal(packet().commandRuns[0]?.command, 'runtime validation');
  assert.deepEqual(packet().validationPasses, ['typecheck']);
  write(legacy, evidence('obsolete validation'));
  assert.equal(packet().commandRuns[0]?.command, 'runtime validation');
  rmSync(path.join(cwd, runtime));
  assert.equal(packet().commandRuns[0]?.command, 'obsolete validation');
  console.log('closure-runtime-evidence-reader: runtime, precedence and legacy cases passed');
} finally {
  rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
}

