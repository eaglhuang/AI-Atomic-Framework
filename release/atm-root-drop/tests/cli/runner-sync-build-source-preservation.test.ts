import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { writeJsonWithRetry } from '../../scripts/runner-sync-incremental-build.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-source-preservation-'));
const foreignFile = path.join(repo, 'packages/cli/src/commands/foreign-owned.ts');
const manifestFile = path.join(repo, 'release/atm-root-drop/release-manifest.json');

function digest(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

try {
  mkdirSync(path.dirname(foreignFile), { recursive: true });
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  writeFileSync(foreignFile, 'export const foreignOwned = true;\n', 'utf8');
  writeFileSync(manifestFile, '{}\n', 'utf8');
  const before = digest(foreignFile);

  const blocked = inspectRunnerSyncAdmission({
    cwd: repo,
    stewardActorId: 'release-steward',
    sealedSourceSha: '3'.repeat(40),
    runnerSyncSteward: {
      stewardWorkId: 'runner-sync-source-preservation',
      queuePosition: 1,
      suggestedNextAction: 'run runner sync',
      requests: [{ taskId: 'TASK-RUNNER', actorId: 'release-steward', requestedSurfaces: ['release/atm-root-drop'] }]
    },
    dirtyFiles: ['packages/cli/src/commands/foreign-owned.ts', 'release/atm-root-drop/release-manifest.json'],
    foreignClaims: [{
      taskId: 'TASK-FOREIGN',
      actorId: 'foreign-agent',
      claimedAt: '2026-07-21T00:00:00.000Z',
      files: ['packages/cli/src/commands/foreign-owned.ts']
    }],
    landedFiles: ['packages/cli/src/commands/foreign-owned.ts']
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.foreignNonReleaseWip, ['packages/cli/src/commands/foreign-owned.ts']);
  assert.match(blocked.requiredCommand ?? '', /foreign non-release WIP/);

  writeJsonWithRetry({ filePath: manifestFile, value: { sealedSourceCommit: '3'.repeat(40) } });
  assert.equal(digest(foreignFile), before, 'runner-sync release-surface writes must not mutate foreign non-release WIP');

  console.log('[runner-sync-build-source-preservation.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
