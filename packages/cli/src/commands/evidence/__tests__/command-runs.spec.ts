import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectRecordCommandRuns,
  hashString,
  normalizeEvidenceCommandRuns,
  readCommandRunsInputFile,
  readRecordFreshness
} from '../command-runs.ts';

const record = {
  validationPasses: ['typecheck'],
  evidenceFreshness: 'fresh',
  commandRuns: [{ command: 'npm run typecheck', exitCode: 0, stdoutSha256: 'a', stderrSha256: 'b' }],
  details: { commandRuns: [{ command: 'npm run typecheck', exitCode: 0, stdoutSha256: 'a', stderrSha256: 'b' }] }
};
assert.equal(collectRecordCommandRuns(record).length, 2);
assert.equal(readRecordFreshness(record), 'fresh');
assert.match(hashString('x'), /^sha256:/);

const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-cmd-runs-'));
try {
  const filePath = path.join(temp, 'runs.json');
  writeFileSync(filePath, JSON.stringify({
    commandRuns: [{
      command: 'npm run typecheck',
      exitCode: 0,
      stdoutSha256: 'sha256:' + 'a'.repeat(64),
      stderrSha256: 'sha256:' + 'b'.repeat(64),
      startedAt: '2026-07-20T00:00:00.000Z',
      finishedAt: '2026-07-20T00:00:01.234Z',
      durationMs: 1234
    }]
  }));
  const fileRuns = readCommandRunsInputFile(filePath);
  assert.equal(fileRuns.length, 1);
  const normalized = normalizeEvidenceCommandRuns({
    cwd: process.cwd(),
    taskId: 'TASK-EVIDENCE-0001',
    inlineRun: null,
    fileRuns,
    runnerKind: 'dev-source',
    sourceCommit: null
  });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.runnerKind, 'dev-source');
  assert.equal(normalized[0]?.startedAt, '2026-07-20T00:00:00.000Z');
  assert.equal(normalized[0]?.finishedAt, '2026-07-20T00:00:01.234Z');
  assert.equal(normalized[0]?.durationMs, 1234);
  assert.equal(normalized[0]?.canonicalObservation?.taskId, 'TASK-EVIDENCE-0001');

  const frozenNormalized = normalizeEvidenceCommandRuns({
    cwd: process.cwd(),
    taskId: 'TASK-EVIDENCE-0001',
    inlineRun: null,
    fileRuns,
    runnerKind: 'frozen-runner',
    sourceCommit: null
  });
  assert.equal(frozenNormalized[0]?.runnerKind, 'frozen-runner');
  assert.match(frozenNormalized[0]?.sourceCommit ?? '', /^[0-9a-f]{40}$/);

  const explicitSourceCommit = 'f'.repeat(40);
  const explicitNormalized = normalizeEvidenceCommandRuns({
    cwd: process.cwd(),
    taskId: 'TASK-EVIDENCE-0001',
    inlineRun: { ...fileRuns[0]!, sourceCommit: explicitSourceCommit },
    fileRuns: [],
    runnerKind: 'frozen-runner',
    sourceCommit: null
  });
  assert.equal(explicitNormalized[0]?.sourceCommit, explicitSourceCommit);

  const externalNormalized = normalizeEvidenceCommandRuns({
    cwd: process.cwd(),
    taskId: 'TASK-EVIDENCE-0001',
    inlineRun: null,
    fileRuns,
    runnerKind: 'external',
    sourceCommit: null
  });
  assert.equal(externalNormalized[0]?.sourceCommit, undefined);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('[command-runs.spec] ok');
