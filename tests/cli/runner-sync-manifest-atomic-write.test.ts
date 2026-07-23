import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeJsonWithRetry } from '../../scripts/runner-sync-incremental-build.ts';

// ATM-BUG-2026-07-20-212: Windows release-manifest writes must be retryable and
// atomic; interruption cannot expose a partial root-drop manifest. writeJsonWithRetry
// writes to a unique `${filePath}.tmp-<pid>-<time>` sibling and only publishes via
// rename, so any interruption before the rename leaves the target file exactly as it
// was (either absent, or the previous valid manifest) and never a truncated payload.

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-manifest-atomic-write-'));

function tmpSiblingsOf(filePath: string): readonly string[] {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return readdirSync(dir).filter((entry) => entry.startsWith(`${base}.tmp-`));
}

try {
  // 1. Happy path: the manifest is published atomically and no temp sibling survives.
  const manifestPath = path.join(repo, 'release-manifest.json');
  writeJsonWithRetry({ filePath: manifestPath, value: { buildInputsTreeHash: 'sha256:aaa', sealedSourceCommit: '1'.repeat(40) } });
  assert.ok(existsSync(manifestPath), 'manifest must exist after a successful write');
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { buildInputsTreeHash: 'sha256:aaa', sealedSourceCommit: '1'.repeat(40) });
  assert.deepEqual(tmpSiblingsOf(manifestPath), [], 'no .tmp-* sibling may survive a successful publish');

  // 2. Re-publish (the cacheHitSkip / rebuild metadata path): the previous content is
  // fully replaced by a single atomic rename, never partially merged or truncated.
  writeJsonWithRetry({ filePath: manifestPath, value: { buildInputsTreeHash: 'sha256:bbb', sealedSourceCommit: '2'.repeat(40) } });
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { buildInputsTreeHash: 'sha256:bbb', sealedSourceCommit: '2'.repeat(40) });
  assert.deepEqual(tmpSiblingsOf(manifestPath), [], 'no .tmp-* sibling may survive a re-publish either');

  // 3. Persistent failure (the interrupted-write case): renaming onto a path that is
  // actually a directory can never succeed on any platform. Every retry attempt must
  // fail the same way, the previously-published sibling manifest must stay untouched
  // (no partial exposure), and no .tmp-* residue may leak out of the failed attempts.
  const blockedManifestDir = path.join(repo, 'blocked-release-manifest.json');
  mkdirSync(blockedManifestDir);
  const siblingManifestPath = path.join(repo, 'sibling-release-manifest.json');
  writeJsonWithRetry({ filePath: siblingManifestPath, value: { buildInputsTreeHash: 'sha256:untouched' } });

  assert.throws(
    () => writeJsonWithRetry({ filePath: blockedManifestDir, value: { buildInputsTreeHash: 'sha256:ccc' }, retries: 2 }),
    'writeJsonWithRetry must exhaust retries and throw rather than silently succeed against an unwritable target'
  );
  assert.deepEqual(
    JSON.parse(readFileSync(siblingManifestPath, 'utf8')),
    { buildInputsTreeHash: 'sha256:untouched' },
    'a persistent failure on one manifest must not corrupt or touch an unrelated sibling manifest'
  );
  assert.deepEqual(tmpSiblingsOf(blockedManifestDir), [], 'failed attempts must not leak .tmp-* residue next to the blocked target');

  // 4. retries: 0 still attempts exactly once and fails closed (no infinite loop, no silent pass).
  assert.throws(
    () => writeJsonWithRetry({ filePath: blockedManifestDir, value: { buildInputsTreeHash: 'sha256:ddd' }, retries: 0 }),
    'retries: 0 must still fail closed on a persistently unwritable target'
  );

  console.log('[runner-sync-manifest-atomic-write.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
