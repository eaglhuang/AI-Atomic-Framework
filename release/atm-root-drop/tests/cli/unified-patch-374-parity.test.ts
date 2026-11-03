// #374: exact issue strings, core/composer/new-kit parity, and git byte oracle.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyUnifiedPatch } from '../../packages/core/src/broker/unified-patch.ts';
import { composeTextPatchesAgainstBase } from '../../packages/core/src/broker/steward-base-composer.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const generated = await import(pathToFileURL(path.join(repo, 'research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367/bin/unified-patch.generated.mjs')).href);
const marker = '\\ No newline at end of file\n';
const cases = [
  { id: 'lf-eof-insertion', before: 'a\n', patch: '@@ -1,0 +2 @@\n+x\n' + marker, expected: 'a\nx' },
  { id: 'crlf-eof-insertion', before: 'a\r\n', patch: '@@ -1,0 +2 @@\n+x\n' + marker, expected: 'a\r\nx' },
  { id: 'empty-eof-insertion', before: '', patch: '@@ -0,0 +1 @@\n+x\n' + marker, expected: 'x' },
  { id: 'inner-output-marker', before: '', patch: '@@ -0,0 +1 @@\n+x\n' + marker + '@@ -0,0 +2 @@\n+y\n', error: 'eof-marker' },
  { id: 'region-fallback-marker', before: '<region:r>\na\n</region:r>\n', patch: '@@ -3 +3,2 @@\n-</region:r>\n+x\n' + marker + '+</region:r>\r\n', error: 'eof-marker' },
  { id: 'relocated-then-insert', before: 'pad\na\nb\nc\n', patch: '@@ -1 +1 @@\n-a\n+A\n@@ -2,0 +3 @@\n+X\n', expected: 'pad\nA\nX\nb\nc\n' }
];

function proposal(id: string, patch: string): PatchProposal {
  return { schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'issue 374 fixture' },
    proposalId: id, taskId: 'fixture', actorId: 'fixture', baseCommit: 'fixture',
    fileBeforeHash: 'fixture', targetFile: 'file.txt', atomRefs: [], anchors: [],
    intent: id, patch, validators: [], rollback: 'discard fixture' };
}
const parent = process.env.TMPDIR?.startsWith(repo + path.sep) ? process.env.TMPDIR : path.join(repo, 'node_modules');
const scratch = mkdtempSync(path.join(parent, 'atm-374-'));
try {
  for (const test of cases) {
    for (const [name, apply] of [['core', applyUnifiedPatch], ['generated', generated.applyUnifiedPatch]] as const) {
      if (test.error) {
        assert.throws(() => apply(test.before, test.patch), (error: unknown) =>
          (error as { reason?: string }).reason === test.error, `${test.id}: ${name} must reject`);
      } else {
        assert.equal(apply(test.before, test.patch), test.expected, `${test.id}: ${name}`);
      }
    }
    const composed = composeTextPatchesAgainstBase('file.txt', test.before, [proposal(test.id, test.patch)]);
    if (test.error) {
      assert.equal(composed.ok, false, `${test.id}: composer must reject, including anchors:[] fallback`);
      if (!composed.ok) {
        assert.equal(composed.block.code, 'compose-context-mismatch');
        assert.match(composed.block.detail, /no-newline marker is not at end of file/);
      }
      continue;
    }
    assert.equal(composed.ok, true, `${test.id}: composer`);
    if (composed.ok) assert.equal(composed.content, test.expected, test.id);
    const file = path.join(scratch, 'file.txt');
    writeFileSync(file, test.before);
    assert.equal(spawnSync('git', ['init', '-q', scratch]).status, 0);
    assert.equal(spawnSync('git', ['-C', scratch, 'add', 'file.txt']).status, 0);
    const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n' + test.patch;
    const applied = spawnSync('git', ['-C', scratch, 'apply', '--unidiff-zero', '--whitespace=nowarn'], { input: patch, encoding: 'utf8' });
    assert.equal(applied.status, 0, `${test.id}: ${applied.stderr}`);
    assert.equal(readFileSync(file, 'utf8'), test.expected, `${test.id}: exact git bytes`);
  }
  console.log('[unified-patch-374-parity] six cases passed; item 4 retains git placement');
} finally {
  // Only this newly created clone-local scratch directory is removed.
  rmSync(scratch, { recursive: true, force: true });
}
