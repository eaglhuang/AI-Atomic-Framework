import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { runOrient } = await import('../../packages/cli/src/commands/orient.ts');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-orient-compact-'));
try {
  const scripts = Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`validate:${String(index).padStart(2, '0')}`, `node check-${index}.mjs`]));
  writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ scripts })}\n`, 'utf8');
  const compact = (runOrient(['--cwd', repo, '--json']) as any).evidence.orientation;
  assert.equal(compact.testEntrypoints.length, 8);
  assert.equal(compact.testEntrypointsTruncated, true);
  assert.equal(compact.testEntrypointsTotalCount, 24);
  assert.equal(compact.testEntrypointsInventoryMode, 'compact');

  const full = (runOrient(['--cwd', repo, '--full', '--json']) as any).evidence.orientation;
  assert.equal(full.testEntrypoints.length, 24);
  assert.equal(full.testEntrypointsTruncated, undefined);
  console.log('[orient-compact-output.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
