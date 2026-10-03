import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closureEvidenceContextForTask } from '../closure-evidence-context.ts';
import { evidencePathForTask } from '../evidence-store.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-closure-evidence-'));
const taskId = 'TASK-EVIDENCE-CASE-0001';
try {
  const evidencePath = evidencePathForTask(cwd, taskId);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const run = { command: 'npm test', cwd: '.', exitCode: 0,
    stdoutSha256: `SHA256:${'Aa'.repeat(32)}`,
    stderrSha256: `sha256:${'B'.repeat(64)}`, runnerVersion: '0.0.0' };
  writeFileSync(evidencePath, JSON.stringify({ evidence: [{ freshness: 'fresh', details: {
    commandRuns: [run, { ...run, stdoutSha256: `sha256:${'G'.repeat(64)}` },
      { ...run, stderrSha256: 'sha256:abc' }]
  } }] }));
  const context = closureEvidenceContextForTask(cwd, taskId);
  assert.equal(context.commandRuns.length, 1, 'invalid hashes remain rejected');
  assert.equal(context.commandRuns[0]?.stdoutSha256, `sha256:${'a'.repeat(64)}`);
  assert.equal(context.commandRuns[0]?.stderrSha256, `sha256:${'b'.repeat(64)}`);
  assert.equal(context.evidenceFreshness, 'fresh');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log('[closure-evidence-context.spec] ok');
